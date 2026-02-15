import type { Express, Request, Response } from "express";
import multer from "multer";
import * as path from "path";
import * as fs from "fs";
import crypto from "crypto";

function ensureFaqImagesDir(): string {
  const uploadsDir = path.join(process.cwd(), "uploads", "faq-images");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log(`[FAQ Images] Created uploads directory: ${uploadsDir}`);
  }
  return uploadsDir;
}

function safeKey(raw: string): string {
  const key = raw.replace(/[/\\]+/g, "_").replace(/\.\.+/g, ".");
  return key;
}

const upload = multer({
  dest: "/tmp/uploads",
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB
  },
});

export function registerFaqImageRoutes(app: Express) {
  app.post(
    "/api/faq-images/upload",
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const file = (req as any).file as
          | {
              path: string;
              originalname: string;
              mimetype: string;
              size: number;
            }
          | undefined;

        if (!file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const uploadsDir = ensureFaqImagesDir();
        const ext = path.extname(file.originalname || "").slice(0, 10) || "";
        const random = crypto.randomBytes(8).toString("hex");
        const key = safeKey(`${Date.now()}_${random}${ext}`);
        const permanentPath = path.resolve(uploadsDir, key);

        fs.renameSync(file.path, permanentPath);

        const url = `/api/faq-images/${encodeURIComponent(key)}`;
        return res.json({
          key,
          filename: file.originalname || key,
          mimeType: file.mimetype || "application/octet-stream",
          url,
        });
      } catch (error) {
        console.error("[FAQ Images] Upload error:", error);
        return res.status(500).json({ error: "Failed to upload image" });
      }
    }
  );

  app.get("/api/faq-images/:key", async (req: Request, res: Response) => {
    try {
      const rawKey = req.params.key;
      const decoded = safeKey(decodeURIComponent(rawKey || ""));
      if (!decoded || decoded.includes("..")) {
        return res.status(400).json({ error: "Invalid key" });
      }

      const uploadsDir = ensureFaqImagesDir();
      const absolute = path.resolve(uploadsDir, decoded);
      if (!absolute.startsWith(path.resolve(uploadsDir))) {
        return res.status(400).json({ error: "Invalid key" });
      }

      if (!fs.existsSync(absolute)) {
        return res.status(404).json({ error: "Not found" });
      }

      return res.sendFile(absolute);
    } catch (error) {
      console.error("[FAQ Images] Serve error:", error);
      return res.status(500).json({ error: "Failed to serve image" });
    }
  });
}

