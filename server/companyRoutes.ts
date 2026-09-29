import type { Express, Request, Response } from "express";
import multer from "multer";
import * as path from "path";
import * as fs from "fs";
import { z } from "zod";
import { requireKnowledgeAuth } from "./_core/httpAuth";
import * as companyKnowledge from "./companyKnowledge";

const uploadTmpDir = path.join(process.cwd(), "uploads", "tmp");
if (!fs.existsSync(uploadTmpDir)) {
  fs.mkdirSync(uploadTmpDir, { recursive: true });
}

const upload = multer({
  dest: uploadTmpDir,
  limits: { fileSize: 50 * 1024 * 1024 },
});

const pasteSchema = z.object({
  title: z.string().min(1).max(200),
  text: z.string().min(1).max(500_000),
});

export function registerCompanyRoutes(app: Express) {
  app.get("/api/company/sections", requireKnowledgeAuth, async (_req, res) => {
    try {
      const sections = companyKnowledge.listSections();
      const stats = companyKnowledge.getAssembledStats();
      res.json({ sections, stats });
    } catch (error) {
      console.error("[Company] list sections failed:", error);
      res.status(500).json({ error: "Failed to list company sections" });
    }
  });

  app.get("/api/company/assembled", requireKnowledgeAuth, async (req, res) => {
    try {
      const download = String(req.query.download ?? "").toLowerCase();
      const md = companyKnowledge.readAssembledMarkdown();
      if (download === "1" || download === "true") {
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="company_knowledge.md"'
        );
        res.send(md);
        return;
      }
      res.json({
        markdown: md,
        stats: companyKnowledge.getAssembledStats(),
      });
    } catch (error) {
      console.error("[Company] assembled failed:", error);
      res.status(500).json({ error: "Failed to read assembled markdown" });
    }
  });

  app.post(
    "/api/company/upload",
    requireKnowledgeAuth,
    upload.single("file"),
    async (req: Request, res: Response) => {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "file is required" });
        return;
      }

      const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
      const ext = path.extname(originalName).toLowerCase();
      const allowed = [".pdf", ".docx", ".md", ".markdown", ".txt", ".xlsx"];
      if (!allowed.includes(ext)) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* ignore */
        }
        res.status(400).json({
          error: `Unsupported format. Allowed: ${allowed.join(", ")}`,
        });
        return;
      }

      const title =
        (typeof req.body.title === "string" && req.body.title.trim()) ||
        originalName.replace(/\.[^.]+$/, "");

      // Ensure processor sees extension
      const withExt = `${file.path}${ext}`;
      try {
        fs.renameSync(file.path, withExt);
      } catch {
        fs.copyFileSync(file.path, withExt);
      }

      try {
        const markdown = await companyKnowledge.fileToMarkdown(withExt, originalName);
        if (!markdown.trim()) {
          res.status(400).json({ error: "Не удалось извлечь текст из файла" });
          return;
        }

        const section = await companyKnowledge.appendMarkdownSection({
          title,
          filename: originalName,
          sourceType: "upload",
          markdown,
          uploadedBy: (req as any).user?.id ?? 1,
        });

        res.json({ ok: true, section });
      } catch (error) {
        console.error("[Company] upload failed:", error);
        res.status(500).json({
          error: error instanceof Error ? error.message : "Upload failed",
        });
      } finally {
        for (const p of [file.path, withExt]) {
          try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
          } catch {
            /* ignore */
          }
        }
      }
    }
  );

  app.post("/api/company/paste", requireKnowledgeAuth, async (req, res) => {
    const parsed = pasteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    try {
      const section = await companyKnowledge.appendMarkdownSection({
        title: parsed.data.title,
        filename: "paste.txt",
        sourceType: "paste",
        markdown: parsed.data.text,
        uploadedBy: (req as any).user?.id ?? 1,
      });
      res.json({ ok: true, section });
    } catch (error) {
      console.error("[Company] paste failed:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Paste failed",
      });
    }
  });

  app.delete(
    "/api/company/sections/:id",
    requireKnowledgeAuth,
    async (req, res) => {
      try {
        const ok = await companyKnowledge.deleteSection(req.params.id);
        if (!ok) {
          res.status(404).json({ error: "Section not found" });
          return;
        }
        res.json({ ok: true });
      } catch (error) {
        console.error("[Company] delete failed:", error);
        res.status(500).json({ error: "Failed to delete section" });
      }
    }
  );
}
