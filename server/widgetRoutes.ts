import type { Express, Request, Response } from "express";
import { z } from "zod";
import * as documentDb from "./documentDb";
import * as faqDb from "./faqDb";
import * as ragModule from "./ragModule";
import { applyWidgetCors } from "./_core/widgetCors";
import { trackWidgetOrigin } from "./widgetSitesDb";

const chatInputSchema = z.object({
  query: z.string().min(1),
  sessionId: z.string().optional(),
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

/** Simple in-memory rate limit for public widget chat (per IP). */
const WIDGET_RATE_WINDOW_MS = 60_000;
const WIDGET_RATE_MAX = 30;
type RateBucket = { timestamps: number[] };
const widgetChatRate = new Map<string, RateBucket>();

function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]!.trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

function consumeWidgetRateLimit(ip: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const bucket = widgetChatRate.get(ip) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < WIDGET_RATE_WINDOW_MS);
  if (bucket.timestamps.length >= WIDGET_RATE_MAX) {
    const oldest = bucket.timestamps[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((WIDGET_RATE_WINDOW_MS - (now - oldest)) / 1000));
    widgetChatRate.set(ip, bucket);
    return { ok: false, retryAfterSec };
  }
  bucket.timestamps.push(now);
  widgetChatRate.set(ip, bucket);
  return { ok: true };
}

// Periodic cleanup to avoid unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of widgetChatRate.entries()) {
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < WIDGET_RATE_WINDOW_MS);
    if (!bucket.timestamps.length) widgetChatRate.delete(key);
  }
}, 5 * 60_000).unref?.();

export function registerWidgetRoutes(app: Express) {
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

    const rate = consumeWidgetRateLimit(clientIp(req));
    if (!rate.ok) {
      res.setHeader("Retry-After", String(rate.retryAfterSec));
      res.status(429).json({
        error: "Too many requests. Please wait and try again.",
        retryAfterSec: rate.retryAfterSec,
      });
      return;
    }

    const parsed = chatInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    void trackWidgetOrigin(req.headers.origin, "chat");

    try {
      const response = await ragModule.processRAGQuery(
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
      );

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
        attachments: response.attachments ?? [],
        sources: sources ?? [],
        suggestedTopics: response.suggestedTopics ?? [],
        mode: response.mode ?? (parsed.data.forceDocumentType ? "scoped" : "company"),
        responseTime: response.responseTime,
      });
    } catch (error) {
      console.error("[Widget] Failed to process chat:", error);
      res.status(500).json({ error: "Failed to process query" });
    }
  });
}
