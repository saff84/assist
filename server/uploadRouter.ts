import type { Express, Request, Response } from "express";
import multer from "multer";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as documentDb from "./documentDb";
import * as documentProcessor from "./documentProcessor";
import type { InsertDocumentChunk, InsertSection, InsertProduct } from "../drizzle/schema";
import { getRagConfig } from "./rag/config";
import { createStopwordSet, tokenize } from "./rag/textProcessing";
import { getDb } from "./db";
import { sections } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { requireKnowledgeAuth } from "./_core/httpAuth";
import { applyWidgetCors } from "./_core/widgetCors";
import { generateEmbeddingVector } from "./embeddingClient";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "bge-m3";
const ragConfig = getRagConfig();
const lexicalStopwords = createStopwordSet(ragConfig.retrieval.stopwords.extra ?? []);

/**
 * Generate embedding for a text chunk using Ollama (shared client).
 */
async function generateChunkEmbedding(text: string): Promise<number[]> {
  const result = await generateEmbeddingVector(text, {
    model: EMBEDDING_MODEL,
    maxChars: 4000,
    retries: 2,
  });
  if (!result.embedding) {
    throw new Error(result.error || "embedding_failed");
  }
  return result.embedding;
}

/**
 * Export for use in other modules
 */
export { generateChunkEmbedding };

export function buildLexicalTerms(text: string): string {
  if (!text) return "";
  try {
    const tokens = tokenize(text, lexicalStopwords);
    return tokens.join(" ");
  } catch (error) {
    console.warn("[UploadRouter] Failed to tokenize for bm25Terms:", error);
    return text
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9а-яё\s]/gi, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3 && token.length <= 40)
      .join(" ");
  }
}

function inferDocumentType(
  filename: string,
  processingType:
    | "general"
    | "instruction"
    | "catalog"
    | "certificate"
    | "passport"
    | "warranty_faq"
    | "installation"
): "catalog" | "instruction" | "general" | "certificate" | "passport" | "warranty_faq" | "installation" {
  if (processingType === "catalog") return "catalog";
  if (processingType === "instruction") return "instruction";
  if (processingType === "certificate") return "certificate";
  if (processingType === "passport") return "passport";
  if (processingType === "warranty_faq") return "warranty_faq";
  if (processingType === "installation") return "installation";

  const normalized = filename.toLowerCase();
  if (normalized.includes("каталог")) return "catalog";
  if (normalized.includes("инструк") || normalized.includes("пособ")) return "instruction";
  if (normalized.includes("сертифик")) return "certificate";
  if (normalized.includes("паспорт")) return "passport";
  if (normalized.includes("гарант") && (normalized.includes("вопрос") || normalized.includes("faq"))) {
    return "warranty_faq";
  }

  return "general";
}

function ensureDocumentUploadsDir(): string {
  const uploadsDir = path.join(process.cwd(), "uploads", "documents");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log(`[Upload] Created uploads directory: ${uploadsDir}`);
  }
  return uploadsDir;
}

function saveDocumentOriginalFile(
  sourcePath: string,
  documentId: number,
  filename: string
): string {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file does not exist: ${sourcePath}`);
  }

  const uploadsDir = ensureDocumentUploadsDir();
  const permanentPath = path.resolve(uploadsDir, `${documentId}_${filename}`);

  fs.copyFileSync(sourcePath, permanentPath);
  if (!fs.existsSync(permanentPath)) {
    throw new Error("File copy verification failed");
  }

  return permanentPath;
}

function saveDocumentCompanionFile(
  sourcePath: string,
  documentId: number,
  filename: string
): string {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Companion source file does not exist: ${sourcePath}`);
  }
  const uploadsDir = ensureDocumentUploadsDir();
  const permanentPath = path.resolve(uploadsDir, `${documentId}_download_${filename}`);
  fs.copyFileSync(sourcePath, permanentPath);
  if (!fs.existsSync(permanentPath)) {
    throw new Error("Companion file copy verification failed");
  }
  return permanentPath;
}

function resolveDocumentFilePath(
  documentId: number,
  filename: string,
  kind: "original" | "download" = "original"
): string | null {
  const uploadsDir = path.join(process.cwd(), "uploads", "documents");
  const preferred =
    kind === "download"
      ? path.resolve(uploadsDir, `${documentId}_download_${filename}`)
      : path.resolve(uploadsDir, `${documentId}_${filename}`);

  if (fs.existsSync(preferred)) return preferred;
  if (!fs.existsSync(uploadsDir)) return null;

  const files = fs.readdirSync(uploadsDir);
  if (kind === "download") {
    const matching = files.find((f) => f.startsWith(`${documentId}_download_`));
    return matching ? path.resolve(uploadsDir, matching) : null;
  }

  const matching = files.find(
    (f) => f.startsWith(`${documentId}_`) && !f.startsWith(`${documentId}_download_`)
  );
  return matching ? path.resolve(uploadsDir, matching) : null;
}

// Configure multer for file uploads (project-local tmp — portable on Windows/Linux)
const uploadTmpDir = path.join(process.cwd(), "uploads", "tmp");
if (!fs.existsSync(uploadTmpDir)) {
  fs.mkdirSync(uploadTmpDir, { recursive: true });
}

const upload = multer({
  dest: uploadTmpDir,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
});

/**
 * Register upload routes
 */
export function registerUploadRoutes(app: Express) {
  // Get document file endpoint
  app.get("/api/documents/:id/file", async (req: Request, res: Response) => {
    try {

      const documentId = parseInt(req.params.id, 10);
      if (isNaN(documentId)) {
        return res.status(400).json({ error: "Invalid document ID" });
      }

      const document = await documentDb.getDocumentById(documentId);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Try to find file in permanent location first
      const uploadsDir = path.join(process.cwd(), "uploads", "documents");
      
      // List all files in uploads directory for debugging
      if (fs.existsSync(uploadsDir)) {
        const files = fs.readdirSync(uploadsDir);
        console.log(`[File Serve] Files in uploads directory (${files.length} files):`, files.slice(0, 10));
      } else {
        console.log(`[File Serve] Uploads directory does not exist: ${uploadsDir}`);
      }
      
      const permanentPath = path.resolve(uploadsDir, `${documentId}_${document.filename}`);
      
      console.log(`[File Serve] Document ID: ${documentId}, Filename: ${document.filename}`);
      console.log(`[File Serve] Looking for file: ${permanentPath}`);
      console.log(`[File Serve] File exists: ${fs.existsSync(permanentPath)}`);
      
      let filePath = resolveDocumentFilePath(documentId, document.filename, "original");
      if (filePath) {
        console.log(`[File Serve] Using path: ${filePath}`);
      } else {
        // Try temp location as fallback
        const tempPath = `/tmp/uploads/${documentId}_${document.filename}`;
        console.log(`[File Serve] Trying temp path: ${tempPath}`);
        if (fs.existsSync(tempPath)) {
          filePath = tempPath;
          console.log(`[File Serve] Using temp path: ${filePath}`);
        }
      }

      if (!filePath || !fs.existsSync(filePath)) {
        console.error(`[File Serve] File not found. Document ID: ${documentId}, Filename: ${document.filename}`);
        return res.status(404).json({ 
          error: "File not found",
          details: {
            documentId,
            filename: document.filename,
          }
        });
      }

      // Determine content type
      const ext = path.extname(document.filename).toLowerCase();
      const contentTypeMap: Record<string, string> = {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
        ".md": "text/markdown; charset=utf-8",
        ".markdown": "text/markdown; charset=utf-8",
      };
      const contentType = contentTypeMap[ext] || "application/octet-stream";

      console.log(`[File Serve] Serving file: ${filePath}, Content-Type: ${contentType}`);
      console.log(`[File Serve] File size: ${fs.statSync(filePath).size} bytes`);
      
      const download = String(req.query.download ?? "").toLowerCase();
      const asAttachment = download === "1" || download === "true" || download === "yes";

      res.setHeader("Content-Type", contentType);
      const encodedName = encodeURIComponent(document.filename);
      // Add both filename and RFC5987 filename* for better Unicode support in browsers.
      res.setHeader(
        "Content-Disposition",
        `${asAttachment ? "attachment" : "inline"}; filename="${encodedName}"; filename*=UTF-8''${encodedName}`
      );
      res.setHeader("Cache-Control", "no-cache");
      applyWidgetCors(req, res);
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      
      // Use absolute path for sendFile
      const absolutePath = path.resolve(filePath);
      console.log(`[File Serve] Absolute path: ${absolutePath}`);
      
      res.sendFile(absolutePath, (err) => {
        if (err) {
          console.error(`[File Serve] Error sending file:`, err);
          if (!res.headersSent) {
            res.status(500).json({ error: "Failed to send file", details: err.message });
          }
        } else {
          console.log(`[File Serve] File sent successfully`);
        }
      });
    } catch (error) {
      console.error("Error serving document file:", error);
      res.status(500).json({ error: "Failed to serve document file" });
    }
  });

  // Companion PDF (or other) file for download alongside MD knowledge docs
  app.get("/api/documents/:id/companion", async (req: Request, res: Response) => {
    try {
      const documentId = parseInt(req.params.id, 10);
      if (isNaN(documentId)) {
        return res.status(400).json({ error: "Invalid document ID" });
      }

      const document = await documentDb.getDocumentById(documentId);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      const downloadFilename =
        typeof (document as any).downloadFilename === "string"
          ? ((document as any).downloadFilename as string)
          : null;
      if (!downloadFilename) {
        return res.status(404).json({ error: "Companion download file not configured" });
      }

      const filePath = resolveDocumentFilePath(documentId, downloadFilename, "download");
      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Companion file not found on disk" });
      }

      const ext = path.extname(downloadFilename).toLowerCase();
      const contentTypeMap: Record<string, string> = {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
      };
      const contentType = contentTypeMap[ext] || "application/octet-stream";
      const download = String(req.query.download ?? "").toLowerCase();
      const asAttachment = download === "1" || download === "true" || download === "yes" || ext === ".pdf";
      const encodedName = encodeURIComponent(downloadFilename);

      res.setHeader("Content-Type", contentType);
      res.setHeader(
        "Content-Disposition",
        `${asAttachment ? "attachment" : "inline"}; filename="${encodedName}"; filename*=UTF-8''${encodedName}`
      );
      res.setHeader("Cache-Control", "no-cache");
      applyWidgetCors(req, res);
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.sendFile(path.resolve(filePath));
    } catch (error) {
      console.error("Error serving companion file:", error);
      res.status(500).json({ error: "Failed to serve companion file" });
    }
  });

  // Upload document endpoint (admin/editor only; optional companionPdf for MD → PDF download)
  app.post(
    "/api/upload/document",
    requireKnowledgeAuth,
    upload.fields([
      { name: "file", maxCount: 1 },
      { name: "companionPdf", maxCount: 1 },
    ]),
    async (req: Request, res: Response) => {
    try {
      const files = req.files as
        | { [fieldname: string]: Express.Multer.File[] }
        | undefined;
      const file = files?.file?.[0] ?? (req as any).file;
      if (!file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const companion = files?.companionPdf?.[0];

      // Decode filename properly for UTF-8 (Russian characters)
      const filename = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const fileSize = file.size;
      const fileExt = path.extname(filename).toLowerCase();
      let fileType = fileExt.substring(1);
      if (fileType === "markdown") fileType = "md";

      // Get processing type from request (default: general)
      const processingType = (req.body.processingType || "general") as
        | "general"
        | "instruction"
        | "catalog"
        | "certificate"
        | "passport"
        | "warranty_faq"
        | "installation";
      const titleRaw = typeof req.body.title === "string" ? req.body.title : undefined;
      const title = titleRaw?.toString().trim();
      const skuRaw = typeof req.body.sku === "string" ? req.body.sku : undefined;
      const sku = skuRaw?.toString().trim();
      const skipFullProcessingRaw =
        req.body.skipFullProcessing === "true" || req.body.skipFullProcessing === true;
      // Markdown catalog/product cards are auto-indexed (no manual PDF regions)
      const isMarkdownCatalog =
        (fileType === "md" || fileType === "markdown") && processingType === "catalog";
      const skipFullProcessing = skipFullProcessingRaw && !isMarkdownCatalog;
      
      // Log for debugging
      console.log(
        `📤 Uploading: ${filename}, type: ${fileType}, size: ${fileSize}, processing: ${processingType}, skipFullProcessing: ${skipFullProcessing}${isMarkdownCatalog ? " (md catalog auto)" : ""}, sku: ${sku || "-"}, companion: ${companion ? "yes" : "no"}`
      );

      // Validate file
      const validation = documentProcessor.validateFile(filename, fileSize);
      if (!validation.valid) {
        console.error(`❌ Validation failed: ${validation.error}`);
        // Clean up uploaded file
        fs.unlinkSync(file.path);
        if (companion?.path && fs.existsSync(companion.path)) fs.unlinkSync(companion.path);
        res.status(400).json({ error: validation.error });
        return;
      }

      if (companion) {
        const companionName = Buffer.from(companion.originalname, "latin1").toString("utf8");
        const companionExt = path.extname(companionName).toLowerCase();
        if (companionExt !== ".pdf") {
          fs.unlinkSync(file.path);
          fs.unlinkSync(companion.path);
          res.status(400).json({ error: "Companion file must be a PDF" });
          return;
        }
      }

      // Create document record
      const documentId = await documentDb.createDocument({
        filename,
        fileType,
        fileSize,
        uploadedBy: 0,
        status: "processing",
        chunksCount: 0,
        processingType,
        docType: inferDocumentType(filename, processingType),
        title: title && title.length > 0 ? title : null,
      });

      if (companion) {
        try {
          const companionName = Buffer.from(companion.originalname, "latin1").toString("utf8");
          saveDocumentCompanionFile(companion.path, documentId, companionName);
          await documentDb.updateDocumentDownloadFilename(documentId, companionName);
          fs.unlinkSync(companion.path);
        } catch (error) {
          console.error(`[Upload] Failed to store companion PDF for doc ${documentId}:`, error);
          try {
            fs.unlinkSync(file.path);
          } catch {
            // ignore
          }
          if (companion?.path && fs.existsSync(companion.path)) {
            try {
              fs.unlinkSync(companion.path);
            } catch {
              // ignore
            }
          }
          await documentDb.updateDocumentStatus(
            documentId,
            "failed",
            `Не удалось сохранить PDF для скачивания: ${error instanceof Error ? error.message : String(error)}`
          );
          res.status(500).json({ error: "Failed to store companion PDF" });
          return;
        }
      }

      // Process document in background
      processDocumentAsync(
        documentId,
        file.path,
        filename,
        fileType,
        processingType,
        skipFullProcessing,
        {
          title: title && title.length > 0 ? title : null,
          sku: sku && sku.length > 0 ? sku : null,
        }
      ).catch((error) => {
        console.error(`Background processing failed for document ${documentId}:`, error);
      });

      res.json({
        success: true,
        documentId,
        message: "Document uploaded successfully. Processing in background.",
      });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Failed to upload document" });
    }
  });
}

/**
 * Seed product group + items for a catalog document that already has product rows
 * (typical MD product card: one group, many SKUs).
 */
async function seedCatalogGroupFromExtractedProducts(
  documentId: number,
  meta: {
    title?: string | null;
    filename: string;
    products: Array<{
      sku: string;
      name?: string | null;
      sectionId?: number | null;
      pageNumber?: number | null;
      attributes?: Record<string, string | number | null> | null;
    }>;
  }
) {
  const unique = new Map<
    string,
    {
      sku: string;
      name?: string | null;
      sectionId?: number | null;
      pageNumber?: number | null;
      attributes?: Record<string, string | number | null> | null;
    }
  >();
  for (const p of meta.products) {
    const sku = (p.sku || "").trim();
    if (!sku || unique.has(sku)) continue;
    unique.set(sku, p);
  }
  if (unique.size === 0) return;

  const displayName =
    (meta.title && meta.title.trim()) ||
    meta.filename.replace(/\.[^.]+$/, "").trim() ||
    `Товар ${documentId}`;

  await documentDb.updateDocumentTitle(documentId, displayName);

  const groupId = await documentDb.createProductGroup({
    documentId,
    name: displayName,
    description:
      unique.size > 1
        ? `Автосоздано из MD: ${unique.size} артикулов`
        : "Автосоздано из MD-карточки товара",
    createdBy: 0,
  });

  let sortOrder = 0;
  const productRecords: Array<{
    documentId: number;
    sku: string;
    name: string | null;
    groupId: number;
    sectionId: number | null;
    attributes: Record<string, string | number | null>;
    pageNumber: number | null;
  }> = [];

  for (const p of unique.values()) {
    const itemName =
      (p.name && String(p.name).trim()) || `${displayName} (${p.sku})`;
    await documentDb.createProductItem({
      documentId,
      groupId,
      name: itemName,
      description: `SKU: ${p.sku}`,
      sortOrder: sortOrder++,
      createdBy: 0,
    });
    productRecords.push({
      documentId,
      sku: p.sku,
      name: itemName,
      groupId,
      sectionId: p.sectionId ?? null,
      attributes: {
        ...(p.attributes ?? {}),
        source: "catalog_md",
      },
      pageNumber: p.pageNumber ?? null,
    });
  }

  await documentDb.replaceDocumentProducts(documentId, productRecords);
  console.log(
    `[Upload] Seeded catalog MD group for doc ${documentId}: groupId=${groupId}, skus=${productRecords.length}`
  );
}

/**
 * Seed RAG quality signals for one-file-one-product catalog uploads:
 * - products.sku row (document-level SKU boost)
 * - one product_group + one product_item (ready for manual region binding)
 */
async function seedSingleProductCatalogScaffold(
  documentId: number,
  meta: { title?: string | null; sku?: string | null; filename: string }
) {
  const displayName =
    (meta.title && meta.title.trim()) ||
    meta.filename.replace(/\.[^.]+$/, "").trim() ||
    `Товар ${documentId}`;
  const sku =
    (meta.sku && meta.sku.trim()) ||
    displayName.replace(/\s+/g, "-").slice(0, 64) ||
    `SKU-${documentId}`;

  if (meta.title && meta.title.trim()) {
    await documentDb.updateDocumentTitle(documentId, meta.title.trim());
  } else {
    await documentDb.updateDocumentTitle(documentId, displayName);
  }

  const groupId = await documentDb.createProductGroup({
    documentId,
    name: displayName,
    description: "Автосоздано для режима «1 файл = 1 товар»",
    createdBy: 0,
  });

  await documentDb.createProductItem({
    documentId,
    groupId,
    name: displayName,
    description: sku ? `SKU: ${sku}` : null,
    sortOrder: 0,
    createdBy: 0,
  });

  await documentDb.replaceDocumentProducts(documentId, [
    {
      documentId,
      sku,
      name: displayName,
      groupId,
      sectionId: null,
      attributes: { source: "catalog_single" },
      pageNumber: null,
    },
  ]);

  console.log(
    `[Upload] Seeded single-product catalog scaffold for doc ${documentId}: sku=${sku}, groupId=${groupId}`
  );
}

/**
 * Process document in background
 */
async function processDocumentAsync(
  documentId: number,
  filePath: string,
  filename: string,
  fileType: string,
  processingType:
    | "general"
    | "instruction"
    | "catalog"
    | "certificate"
    | "passport"
    | "warranty_faq"
    | "installation" = "general",
  skipFullProcessing: boolean = false,
  meta: { title?: string | null; sku?: string | null } = {}
) {
  try {
    console.log(`🔄 Processing document ${documentId}: ${filename} (type: ${fileType}, processing: ${processingType})`);
    await documentDb.updateDocumentProgress(documentId, "parsing", 5, "Извлечение структуры документа");
    
    // Rename temp file to include extension for proper processing
    const tempFileWithExt = `${filePath}.${fileType}`;
    fs.renameSync(filePath, tempFileWithExt);
    
    // Process document with specified processing type
    if (skipFullProcessing) {
      console.log(`⏭️ Manual annotation mode for document ${documentId} — skipping automated parsing/chunking`);
      await documentDb.updateDocumentProgress(documentId, "saving", 40, "Подготовка файла для ручной разметки");

      try {
        const permanentPath = saveDocumentOriginalFile(tempFileWithExt, documentId, filename);
        console.log(`[Upload] File copied for manual annotation: ${permanentPath}`);
      } catch (error) {
        console.error(`[Upload] Failed to copy file:`, error);
        await documentDb.updateDocumentStatus(
          documentId,
          "failed",
          `Ошибка сохранения файла: ${error instanceof Error ? error.message : String(error)}`
        );
        await documentDb.updateDocumentProgress(documentId, "failed", 0, "Ошибка сохранения файла");
        return;
      }

      // One-file-one-product catalog: keep docType=catalog quality signals for RAG
      if (processingType === "catalog") {
        try {
          await seedSingleProductCatalogScaffold(documentId, {
            title: meta.title ?? null,
            sku: meta.sku ?? null,
            filename,
          });
        } catch (error) {
          console.warn(`[Upload] Failed to seed single-product catalog scaffold:`, error);
        }
      }

      await documentDb.updateDocumentStatus(documentId, "indexed");
      await documentDb.updateDocumentChunksCount(documentId, 0);
      await documentDb.updateDocumentProgress(
        documentId,
        "completed",
        100,
        processingType === "catalog"
          ? "Готово: разметьте области товара и сгенерируйте чанки"
          : "Готово для ручной разметки — выделите области вручную"
      );

      try {
        fs.unlinkSync(tempFileWithExt);
      } catch (error) {
        console.warn(`Failed to delete temp file ${tempFileWithExt}:`, error);
      }

      console.log(`✅ Document ${documentId} ready for manual annotation (auto processing skipped)`);
      return;
    }

    const processed = await documentProcessor.processDocument(tempFileWithExt, processingType);
    await documentDb.updateDocumentProgress(documentId, "chunking", 30, `Создано чанков: ${processed.chunks.length}`);
    

    // Generate embeddings and insert chunks into database with batching
    console.log(`📊 Generating embeddings for ${processed.chunks.length} chunks (batched for performance)...`);
    const chunkRecords: Array<InsertDocumentChunk> = [];
    
    // Batch processing: процессируем по 5 чанков параллельно для снижения нагрузки на CPU
    const BATCH_SIZE = 5;
    let processedCount = 0;
    const totalChunks = processed.chunks.length || 1;
    
    for (let i = 0; i < processed.chunks.length; i += BATCH_SIZE) {
      const batch = processed.chunks.slice(i, i + BATCH_SIZE);
      
      // Генерируем эмбеддинги параллельно в рамках батча
      const batchResults = await Promise.all(
        batch.map(async (chunk) => {
          if (chunk.chunkIndex === 0) {
            console.log("[UploadRouter] Sample chunk content:", chunk.content.slice(0, 200));
          }
          try {
            const embedding = await generateChunkEmbedding(chunk.content);
            const bm25Terms = buildLexicalTerms(chunk.content);
            
            // Преобразование tableRows: поддерживаем оба формата
            let tableJson: Array<Record<string, string | number | null>> | null = null;
            if (chunk.tableRows && chunk.tableRows.length > 0) {
              tableJson = chunk.tableRows.map((row) => {
                // Если row уже в формате Record, используем его
                if (row && typeof row === 'object' && !Array.isArray(row)) {
                  if ('cells' in row && Array.isArray(row.cells)) {
                    // Формат { cells: string[] } - преобразуем в Record
                    const record: Record<string, string | number | null> = {};
                    row.cells.forEach((cell, index) => {
                      record[`Column${index + 1}`] = cell || null;
                    });
                    return record;
                  } else {
                    // Уже в формате Record<string, string | number | null>
                    return row as Record<string, string | number | null>;
                  }
                }
                return {} as Record<string, string | number | null>;
              });
              
              // Debug logging for table data
              console.log(`[UploadRouter] Saving chunk ${chunk.chunkIndex} with ${tableJson.length} table rows`);
              if (tableJson[0]) {
                console.log(`[UploadRouter] First table row:`, JSON.stringify(tableJson[0]));
              }
            }
            
            // Преобразование elementType: "mixed" -> "table" (так как в схеме БД нет "mixed")
            let normalizedElementType: "text" | "table" | "figure" | "list" | "header" = "text";
            const rawElementType = chunk.elementType ?? chunk.metadata?.elementType ?? "text";
            if (rawElementType === "mixed" || rawElementType === "table") {
              normalizedElementType = tableJson && tableJson.length > 0 ? "table" : "text";
            } else if (rawElementType === "figure") {
              normalizedElementType = "figure";
            } else if (rawElementType === "list") {
              normalizedElementType = "list";
            } else if (rawElementType === "header") {
              normalizedElementType = "header";
            }
            
            // Преобразование chunkMetadata: pageRange -> pageNumber, нормализация структуры
            let normalizedMetadata: any = null;
            if (chunk.metadata) {
              normalizedMetadata = {
                section: chunk.metadata.section,
                subsection: chunk.metadata.subsection,
                pageNumber: chunk.pageNumber ?? chunk.metadata.pageNumber ?? 
                  (chunk.metadata.pageRange ? parseInt(chunk.metadata.pageRange.split('-')[0]) : undefined),
                heading: chunk.metadata.heading,
                category: chunk.metadata.category,
                tags: chunk.metadata.tags,
                importance: chunk.metadata.importance,
                sectionPath: chunk.sectionPath ?? chunk.metadata.sectionPath ?? chunk.metadata.section,
                elementType: normalizedElementType,
              };
              // Удаляем undefined полей
              Object.keys(normalizedMetadata).forEach(key => {
                if (normalizedMetadata[key] === undefined) {
                  delete normalizedMetadata[key];
                }
              });
            }
            
            return {
              documentId,
              chunkIndex: chunk.chunkIndex,
              content: chunk.content,
              tokenCount: chunk.tokenCount,
              embedding: JSON.stringify(embedding),
              pageNumber: chunk.pageNumber ?? chunk.metadata?.pageNumber ?? 
                (chunk.metadata?.pageRange ? parseInt(chunk.metadata.pageRange.split('-')[0]) : null),
              sectionPath: chunk.sectionPath ?? chunk.metadata?.sectionPath ?? chunk.metadata?.section ?? null,
              elementType: normalizedElementType,
              tableJson,
              language: chunk.language ?? "ru",
              bm25Terms,
              chunkMetadata: normalizedMetadata,
            };
          } catch (error) {
            console.error(`Failed to generate embedding for chunk ${chunk.chunkIndex}:`, error);
            const bm25Terms = buildLexicalTerms(chunk.content);
            
            // Преобразование tableRows: поддерживаем оба формата
            let tableJson: Array<Record<string, string | number | null>> | null = null;
            if (chunk.tableRows && chunk.tableRows.length > 0) {
              tableJson = chunk.tableRows.map((row) => {
                // Если row уже в формате Record, используем его
                if (row && typeof row === 'object' && !Array.isArray(row)) {
                  if ('cells' in row && Array.isArray(row.cells)) {
                    // Формат { cells: string[] } - преобразуем в Record
                    const record: Record<string, string | number | null> = {};
                    row.cells.forEach((cell, index) => {
                      record[`Column${index + 1}`] = cell || null;
                    });
                    return record;
                  } else {
                    // Уже в формате Record<string, string | number | null>
                    return row as Record<string, string | number | null>;
                  }
                }
                return {} as Record<string, string | number | null>;
              });
            }
            
            // Преобразование elementType: "mixed" -> "table" (так как в схеме БД нет "mixed")
            let normalizedElementType: "text" | "table" | "figure" | "list" | "header" = "text";
            const rawElementType = chunk.elementType ?? chunk.metadata?.elementType ?? "text";
            if (rawElementType === "mixed" || rawElementType === "table") {
              normalizedElementType = tableJson && tableJson.length > 0 ? "table" : "text";
            } else if (rawElementType === "figure") {
              normalizedElementType = "figure";
            } else if (rawElementType === "list") {
              normalizedElementType = "list";
            } else if (rawElementType === "header") {
              normalizedElementType = "header";
            }
            
            // Преобразование chunkMetadata: pageRange -> pageNumber, нормализация структуры
            let normalizedMetadata: any = null;
            if (chunk.metadata) {
              normalizedMetadata = {
                section: chunk.metadata.section,
                subsection: chunk.metadata.subsection,
                pageNumber: chunk.pageNumber ?? chunk.metadata.pageNumber ?? 
                  (chunk.metadata.pageRange ? parseInt(chunk.metadata.pageRange.split('-')[0]) : undefined),
                heading: chunk.metadata.heading,
                category: chunk.metadata.category,
                tags: chunk.metadata.tags,
                importance: chunk.metadata.importance,
                sectionPath: chunk.sectionPath ?? chunk.metadata.sectionPath ?? chunk.metadata.section,
                elementType: normalizedElementType,
              };
              // Удаляем undefined полей
              Object.keys(normalizedMetadata).forEach(key => {
                if (normalizedMetadata[key] === undefined) {
                  delete normalizedMetadata[key];
                }
              });
            }
            
            return {
              documentId,
              chunkIndex: chunk.chunkIndex,
              content: chunk.content,
              tokenCount: chunk.tokenCount,
              embedding: null,
              pageNumber: chunk.pageNumber ?? chunk.metadata?.pageNumber ?? 
                (chunk.metadata?.pageRange ? parseInt(chunk.metadata.pageRange.split('-')[0]) : null),
              sectionPath: chunk.sectionPath ?? chunk.metadata?.sectionPath ?? chunk.metadata?.section ?? null,
              elementType: normalizedElementType,
              tableJson,
              language: chunk.language ?? "ru",
              bm25Terms,
              chunkMetadata: normalizedMetadata,
            };
          }
        })
      );
      
      chunkRecords.push(...batchResults);
      processedCount += batch.length;
      console.log(`  Progress: ${processedCount}/${processed.chunks.length} chunks`);

      const embeddingProgress = 30 + Math.round((processedCount / totalChunks) * 50);
      await documentDb.updateDocumentProgress(
        documentId,
        "embedding",
        embeddingProgress,
        `Генерируем эмбеддинги: ${processedCount}/${totalChunks}`
      );
    }

    const sectionRecords: InsertSection[] = (processed.sections ?? []).map((section, index) => {
      const rawPath = section.sectionPath?.trim() || `${index + 1}`;
      const normalizedPath = rawPath.length > 512 ? rawPath.slice(0, 512) : rawPath;

      const normalizedTitleRaw = (section.title ?? "")
        .toString()
        .replace(/\s+/g, " ")
        .trim();
      let normalizedTitle = normalizedTitleRaw.length > 0 ? normalizedTitleRaw : `Раздел ${normalizedPath}`;
      if (normalizedTitle.length > 500) {
        normalizedTitle = `${normalizedTitle.slice(0, 497)}...`;
      }

      const parentPath = section.parentPath?.toString().trim();
      const normalizedParentPath =
        parentPath && parentPath.length > 512 ? parentPath.slice(0, 512) : parentPath ?? null;

      return {
        documentId,
        sectionPath: normalizedPath,
        title: normalizedTitle,
        level: section.level ?? 1,
        parentPath: normalizedParentPath,
        pageStart: section.pageStart ?? null,
        pageEnd: section.pageEnd ?? null,
      };
    });

    // First save sections to get their IDs, then link products to sections
    await documentDb.replaceDocumentSections(documentId, sectionRecords);
    
    // Get saved sections with IDs for linking products
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    const savedSections = await db
      .select()
      .from(sections)
      .where(eq(sections.documentId, documentId));
    
    const sectionIdMap = new Map<string, number>();
    savedSections.forEach((section) => {
      if (section.sectionPath) {
        sectionIdMap.set(section.sectionPath, section.id);
      }
    });

    const productRecords: InsertProduct[] = (processed.products ?? []).map((product) => {
      // Try to extract product name if not already set
      let productName = product.name;
      if (!productName && product.sectionPath) {
        // Find section by path and extract name from title
        const section = processed.sections?.find(s => s.sectionPath === product.sectionPath);
        if (section) {
          // Try to extract product name from section title
          const titleMatchQuotes = section.title.match(/[«"']([А-ЯЁA-Z][а-яёa-z\s]+?)[»"']/);
          if (titleMatchQuotes && titleMatchQuotes[1]) {
            productName = titleMatchQuotes[1].trim();
          } else {
            const titleMatchNoQuotes = section.title.match(/^\d+(?:\.\d+)*\.\s+(?:Труба|Фитинг|Крепёж|Изделие|Станция|Радиатор|Коллектор)\s+([А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)*)/);
            if (titleMatchNoQuotes && titleMatchNoQuotes[1]) {
              productName = titleMatchNoQuotes[1].trim();
            }
          }
        }
      }

      return {
        documentId,
        sectionId: product.sectionPath ? (sectionIdMap.get(product.sectionPath) ?? null) : null,
        groupId: null, // Explicitly set to null for nullable field
        sku: product.sku,
        name: productName ?? null,
        attributes: product.attributes ?? null,
        pageNumber: product.pageNumber ?? null,
      };
    });

    console.log(`✅ Generated ${chunkRecords.filter(c => c.embedding).length}/${chunkRecords.length} embeddings`);
    const withEmbedding = chunkRecords.filter((c) => c.embedding).length;
    if (chunkRecords.length > 0 && withEmbedding === 0) {
      throw new Error(
        `Не удалось сгенерировать эмбеддинги ни для одного чанка (${chunkRecords.length}). Проверьте Ollama/bge-m3 и повторите загрузку.`
      );
    }
    if (chunkRecords.length > 0 && withEmbedding / chunkRecords.length < 0.5) {
      throw new Error(
        `Слишком мало эмбеддингов: ${withEmbedding}/${chunkRecords.length} (<50%). Документ не помечен как indexed — исправьте Ollama и повторите загрузку.`
      );
    }

    await documentDb.insertDocumentChunks(chunkRecords);
    // Sections already saved above, now save products
    await documentDb.replaceDocumentProducts(documentId, productRecords);

    // MD product card: build product_group + product_items from extracted SKUs
    const isMd =
      filename.toLowerCase().endsWith(".md") ||
      filename.toLowerCase().endsWith(".markdown") ||
      fileType === "md";
    if (processingType === "catalog" && isMd) {
      try {
        if (productRecords.length > 0) {
          await seedCatalogGroupFromExtractedProducts(documentId, {
            title: meta.title ?? processed.title ?? null,
            filename,
            products: productRecords.map((p) => ({
              sku: p.sku,
              name: p.name,
              sectionId: p.sectionId ?? null,
              pageNumber: p.pageNumber ?? null,
              attributes: p.attributes ?? null,
            })),
          });
        } else if (meta.sku || meta.title) {
          // Fallback: form fields when MD has no nomenclature table
          await seedSingleProductCatalogScaffold(documentId, {
            title: meta.title ?? processed.title ?? null,
            sku: meta.sku ?? null,
            filename,
          });
        }
      } catch (error) {
        console.warn(`[Upload] Failed to seed catalog MD group for doc ${documentId}:`, error);
      }
    }

    await documentDb.updateDocumentProgress(
      documentId,
      "saving",
      90,
      withEmbedding < chunkRecords.length
        ? `Сохраняем данные (${withEmbedding}/${chunkRecords.length} с эмбеддингами)`
        : "Сохраняем данные и обновляем индекс"
    );

    // Update document status and metadata
    await documentDb.updateDocumentChunksCount(documentId, processed.chunks.length);
    await documentDb.updateDocumentMetadata(
      documentId,
      processed.documentMetadata || {},
      {
        toc: (processed.toc ?? []).map((section) => ({
          sectionPath: section.sectionPath,
          title: section.title,
          level: section.level,
          page: section.pageStart,
          pageStart: section.pageStart,
          pageEnd: section.pageEnd,
        })),
        title: meta.title ?? processed.title,
        pages: processed.numPages,
        docType: inferDocumentType(filename, processingType),
      }
    );
    await documentDb.updateDocumentStatus(documentId, "indexed");

    const archivedFilePath = saveDocumentOriginalFile(tempFileWithExt, documentId, filename);
    console.log(`[Upload] Original file archived at: ${archivedFilePath}`);

    // Clean up temporary file
    try {
      fs.unlinkSync(tempFileWithExt);
    } catch (e) {
      console.warn("Failed to delete temp file:", tempFileWithExt);
    }

    console.log(`✅ Document ${documentId} processed successfully with ${processed.chunks.length} chunks`);
  } catch (error) {
    console.error(`❌ Failed to process document ${documentId}:`, error);
    await documentDb.updateDocumentProgress(
      documentId,
      "failed",
      100,
      error instanceof Error ? error.message : String(error)
    );
    
    // Update document status to failed
    await documentDb.updateDocumentStatus(
      documentId,
      "failed",
      error instanceof Error ? error.message : String(error)
    );

    // Clean up temporary file (both with and without extension)
    const tempWithExt = `${filePath}.${fileType}`;
    try {
      if (fs.existsSync(tempWithExt)) {
        fs.unlinkSync(tempWithExt);
      }
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      console.warn("Failed to delete temp file");
    }
  }
}

