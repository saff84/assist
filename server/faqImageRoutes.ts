import type { Express, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { requireKnowledgeAuth } from "./_core/httpAuth";
import { rasterImageType } from "./_core/rasterImage";

const MAX_IMAGE_SIZE = 15 * 1024 * 1024;
const imagesDir = path.resolve("uploads", "faq-images");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_SIZE, files: 1, fields: 0, parts: 2 } });

export function registerFaqImageRoutes(app: Express) {
  app.post("/api/faq-images/upload", requireKnowledgeAuth, (req, res) => {
    upload.single("file")(req, res, async error => {
      if (error) { res.status(400).json({ error: "Допустимо одно изображение до 15 МБ" }); return; }
      try {
        const file = req.file;
        const type = file && rasterImageType(file.buffer);
        if (!file || !type) { res.status(400).json({ error: "Допустимы PNG, JPEG, WebP или GIF" }); return; }
        await fs.mkdir(imagesDir, { recursive: true });
        const key = `${Date.now()}_${crypto.randomBytes(16).toString("hex")}${type.extension}`;
        await fs.writeFile(path.join(imagesDir, key), file.buffer, { flag: "wx", mode: 0o600 });
        res.json({ key, filename: file.originalname, mimeType: type.mimeType, url: `/api/faq-images/${key}` });
      } catch (error) {
        console.error("[FAQ Images] Upload failed", error);
        res.status(500).json({ error: "Не удалось сохранить изображение" });
      }
    });
  });

  app.get("/api/faq-images/:key", async (req: Request, res: Response) => {
    const key = req.params.key;
    if (!/^[a-zA-Z0-9_.-]+$/.test(key) || key.includes("..")) { res.status(400).end(); return; }
    const filePath = path.resolve(imagesDir, key);
    if (path.dirname(filePath) !== imagesDir) { res.status(400).end(); return; }
    try {
      const file = await fs.open(filePath, "r");
      let type: ReturnType<typeof rasterImageType> = null;
      try {
        const stats = await file.stat();
        if (!stats.isFile() || stats.size > MAX_IMAGE_SIZE) { res.status(404).end(); return; }
        const header = Buffer.alloc(12);
        const { bytesRead } = await file.read(header, 0, 12, 0);
        type = rasterImageType(header.subarray(0, bytesRead));
      } finally { await file.close(); }
      if (!type) { res.status(404).end(); return; }
      res.setHeader("Content-Type", type.mimeType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.sendFile(filePath);
    } catch { res.status(404).end(); }
  });
}
