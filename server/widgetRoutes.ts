import type { Express, Request, Response } from "express";
import { z } from "zod";
import * as documentDb from "./documentDb";
import * as faqDb from "./faqDb";
import * as ragModule from "./ragModule";
import { applyWidgetCors } from "./_core/widgetCors";

const chatInputSchema = z.object({
  query: z.string().min(1),
  sessionId: z.string().optional(),
  forceDocumentType: z
    .enum(["catalog", "instruction", "general", "certificate", "passport", "warranty_faq"])
    .optional(),
});

export function registerWidgetRoutes(app: Express) {
  app.get("/api/widget/topics", async (req: Request, res: Response) => {
    if (!applyWidgetCors(req, res) && req.headers.origin) {
      res.status(403).json({ error: "Origin is not allowed" });
      return;
    }

    try {
      const availability = await documentDb.getDocTypeAvailability([
        "certificate",
        "passport",
        "warranty_faq",
      ]);
      const hasFaqChunks = await faqDb.hasAnyFaqEntries().catch(() => false);

      res.json({
        hasCertificates: availability.certificate,
        hasPassports: availability.passport,
        hasWarrantyFaq: availability.warranty_faq || hasFaqChunks,
      });
    } catch (error) {
      console.error("[Widget] Failed to load topics:", error);
      res.json({
        hasCertificates: false,
        hasPassports: false,
        hasWarrantyFaq: false,
      });
    }
  });

  app.post("/api/widget/chat", async (req: Request, res: Response) => {
    if (!applyWidgetCors(req, res) && req.headers.origin) {
      res.status(403).json({ error: "Origin is not allowed" });
      return;
    }

    const parsed = chatInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    try {
      const response = await ragModule.processRAGQuery(
        {
          query: parsed.data.query,
          sessionId: parsed.data.sessionId,
          source: "website",
          topK: 5,
        },
        {
          topK: 5,
          forceDocumentType: parsed.data.forceDocumentType,
        }
      );

      res.json({
        response: response.response,
        attachments: response.attachments ?? [],
        responseTime: response.responseTime,
      });
    } catch (error) {
      console.error("[Widget] Failed to process chat:", error);
      res.status(500).json({ error: "Failed to process query" });
    }
  });
}
