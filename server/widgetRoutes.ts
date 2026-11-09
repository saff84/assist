import type { Express, Request, Response } from "express";
import { z } from "zod";
import * as documentDb from "./documentDb";
import * as faqDb from "./faqDb";
import * as ragModule from "./ragModule";
import { applyWidgetCors } from "./_core/widgetCors";
import { trackWidgetOrigin } from "./widgetSitesDb";
import { readChatGreeting } from "./chatGreetingStore";
import { readWidgetAppearance } from "./widgetAppearanceStore";
import { readWidgetConsent } from "./widgetConsentStore";
import { hasWidgetConsent, recordWidgetConsent } from "./widgetConsentReceipt";
import { clientIp, consumeLimit, withRagCapacity } from "./_core/requestLimits";
import { signDocumentUrl } from "./_core/documentAccess";

const chatInputSchema = z.object({
  query: z.string().min(1).max(4000),
  sessionId: z.string().max(200).optional(),
  consentToken: z.string().max(2000).optional(),
  forceDocumentType: z
    .enum([
      "catalog",
      "instruction",
      "general",
      "certificate",
      "passport",
      "warranty_faq",
      "installation",
      "company",
    ])
    .optional(),
  includeSources: z.boolean().optional(),
});

export function registerWidgetRoutes(app: Express) {
  app.post("/api/widget/consent/accept", async (req, res) => {
    if (!consumeLimit(`consent:${clientIp(req)}`, 10)) { res.status(429).json({ error: "Too many requests" }); return; }
    const parsed = z.object({ sessionId: z.string().min(1).max(200), version: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
    try {
      const consent = await readWidgetConsent();
      if (!consent.enabled || consent.version !== parsed.data.version) { res.status(409).json({ error: "CONSENT_REQUIRED", consent }); return; }
      res.setHeader("Cache-Control", "no-store");
      res.json(await recordWidgetConsent(consent, parsed.data.sessionId, req.headers.origin || ""));
    } catch { res.status(503).json({ error: "Не удалось сохранить согласие" }); }
  });
  app.get("/api/widget/consent", async (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try { res.json(await readWidgetConsent()); }
    catch { res.status(503).json({ error: "Не удалось загрузить настройки согласия" }); }
  });
  app.get("/api/widget/appearance", async (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try { res.json(await readWidgetAppearance()); }
    catch { res.status(500).json({ error: "Не удалось загрузить оформление виджета" }); }
  });
  app.get("/api/widget/greeting",async(req:Request,res:Response)=>{
    if(!applyWidgetCors(req,res)&&req.headers.origin){res.status(403).json({error:"Origin is not allowed"});return;}
    res.setHeader("Cache-Control","no-store");
    try{res.json(await readChatGreeting());}
    catch(error){console.error("[Widget] Greeting settings failed",error);res.status(500).json({error:"Failed to load greeting"});}
  });
  app.get("/api/widget/topics", async (req: Request, res: Response) => {
    if (!applyWidgetCors(req, res) && req.headers.origin) {
      res.status(403).json({ error: "Origin is not allowed" });
      return;
    }

    void trackWidgetOrigin(req.headers.origin, "topics");

    try {
      const availability = await documentDb.getDocTypeAvailability([
        "instruction",
        "certificate",
        "passport",
        "warranty_faq",
        "installation",
      ]);
      const hasFaqChunks = await faqDb.hasAnyFaqEntries().catch(() => false);

      res.json({
        hasInstructions: availability.instruction,
        hasCertificates: availability.certificate,
        hasPassports: availability.passport,
        hasWarrantyFaq: availability.warranty_faq || hasFaqChunks,
        hasInstallation: availability.installation,
      });
    } catch (error) {
      console.error("[Widget] Failed to load topics:", error);
      res.json({
        hasInstructions: false,
        hasCertificates: false,
        hasPassports: false,
        hasWarrantyFaq: false,
        hasInstallation: false,
      });
    }
  });

  app.post("/api/widget/chat", async (req: Request, res: Response) => {
    if (!applyWidgetCors(req, res) && req.headers.origin) {
      res.status(403).json({ error: "Origin is not allowed" });
      return;
    }

    if (!consumeLimit(`widget:${clientIp(req)}`)) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({
        error: "Too many requests. Please wait and try again.",
        retryAfterSec: 60,
      });
      return;
    }

    const parsed = chatInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    try {
      const consent = await readWidgetConsent();
      if (consent.enabled && !(await hasWidgetConsent(parsed.data.consentToken, consent.version, parsed.data.sessionId, req.headers.origin || ""))) {
        res.status(409).json({ error: "CONSENT_REQUIRED", consent });
        return;
      }
      void trackWidgetOrigin(req.headers.origin, "chat");
      const response = await withRagCapacity(() => ragModule.processRAGQuery(
        {
          query: parsed.data.query,
          sessionId: parsed.data.sessionId,
          source: "website",
          topK: 12,
        },
        {
          topK: 12,
          forceDocumentType: parsed.data.forceDocumentType,
        }
      ));

      const attachments = await Promise.all((response.attachments ?? []).map(async attachment => ({
        ...attachment, previewUrl: await signDocumentUrl(attachment.previewUrl), downloadUrl: await signDocumentUrl(attachment.downloadUrl),
      })));

      const sources =
        parsed.data.includeSources === false
          ? undefined
          : (response.sources ?? []).slice(0, 8).map((s) => ({
              documentId: s.documentId,
              filename: s.filename,
              chunkIndex: s.chunkIndex,
              relevance: s.relevance,
              pageNumber: s.pageNumber,
              sectionPath: s.sectionPath,
            }));

      res.json({
        response: response.response,
        attachments,
        sources: sources ?? [],
        suggestedTopics: response.suggestedTopics ?? [],
        mode: response.mode ?? (parsed.data.forceDocumentType ? "scoped" : "company"),
        responseTime: response.responseTime,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "RAG_CAPACITY_EXCEEDED") { res.status(429).json({ error: "Ассистент занят. Повторите запрос позже." }); return; }
      console.error("[Widget] Failed to process chat:", error);
      res.status(500).json({ error: "Failed to process query" });
    }
  });
}
