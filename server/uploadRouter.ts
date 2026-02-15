import type { Express, Request, Response } from "express";
import multer from "multer";
import * as path from "path";
import * as fs from "fs";
import * as documentDb from "./documentDb";
import * as documentProcessor from "./documentProcessor";
import type { InsertDocumentChunk, InsertSection, InsertProduct } from "../drizzle/schema";
import { getRagConfig } from "./rag/config";
import { createStopwordSet, tokenize } from "./rag/textProcessing";
import { getDb } from "./db";
import { sections } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "bge-m3";
const ragConfig = getRagConfig();
const lexicalStopwords = createStopwordSet(ragConfig.retrieval.stopwords.extra ?? []);

/**
 * Generate embedding for a text chunk using Ollama
 */
async function generateChunkEmbedding(text: string): Promise<number[]> {
  try {
    const ollamaUrl =
      process.env.OLLAMA_URL ||
      process.env.OLLAMA_BASE_URL ||
      "http://ollama:11434";
    const input = text.substring(0, 2000); // Limit for performance

    const request = async (endpoint: string, body: any) => {
      const response = await fetch(`${ollamaUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return response;
    };

    // Ollama versions differ:
    // - newer: POST /api/embed { model, input }
    // - older: POST /api/embeddings { model, prompt }
    let response = await request("/api/embed", { model: EMBEDDING_MODEL, input });
    if (response.status === 404) {
      response = await request("/api/embeddings", { model: EMBEDDING_MODEL, prompt: input });
    }
    // Model can still be downloading on first boot; retry once after a short delay.
    if (response.status === 404) {
      await new Promise((r) => setTimeout(r, 2000));
      response = await request("/api/embed", { model: EMBEDDING_MODEL, input });
      if (response.status === 404) {
        response = await request("/api/embeddings", { model: EMBEDDING_MODEL, prompt: input });
      }
    }

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data: any = await response.json();
    if (Array.isArray(data?.embedding)) {
      return data.embedding as number[];
    }
    if (Array.isArray(data?.embeddings) && Array.isArray(data.embeddings[0])) {
      return data.embeddings[0] as number[];
    }

    throw new Error("Invalid embedding response format");
  } catch (error) {
    console.error("[Embeddings] Error:", error);
    throw error;
  }
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
): "catalog" | "instruction" | "general" | "certificate" | "passport" | "warranty_faq" {
  if (processingType === "catalog") return "catalog";
  if (processingType === "instruction") return "instruction";
  if (processingType === "certificate") return "certificate";
  if (processingType === "passport") return "passport";
  if (processingType === "warranty_faq") return "warranty_faq";

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

// Configure multer for file uploads
const upload = multer({
  dest: "/tmp/uploads",
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
      
      let filePath: string | null = null;
      if (fs.existsSync(permanentPath)) {
        filePath = permanentPath;
        console.log(`[File Serve] Using permanent path: ${filePath}`);
      } else {
        // Try to find any file with documentId prefix
        if (fs.existsSync(uploadsDir)) {
          const files = fs.readdirSync(uploadsDir);
          const matchingFile = files.find(f => f.startsWith(`${documentId}_`));
          if (matchingFile) {
            filePath = path.resolve(uploadsDir, matchingFile);
            console.log(`[File Serve] Found matching file by prefix: ${filePath}`);
          }
        }
        
        if (!filePath) {
          // Try temp location as fallback
          const tempPath = `/tmp/uploads/${documentId}_${document.filename}`;
          console.log(`[File Serve] Trying temp path: ${tempPath}`);
          if (fs.existsSync(tempPath)) {
            filePath = tempPath;
            console.log(`[File Serve] Using temp path: ${filePath}`);
          }
        }
      }

      if (!filePath || !fs.existsSync(filePath)) {
        console.error(`[File Serve] File not found. Document ID: ${documentId}, Filename: ${document.filename}`);
        console.error(`[File Serve] Checked paths:`);
        console.error(`  - ${permanentPath}`);
        console.error(`  - /tmp/uploads/${documentId}_${document.filename}`);
        return res.status(404).json({ 
          error: "File not found",
          details: {
            documentId,
            filename: document.filename,
            checkedPaths: [permanentPath, `/tmp/uploads/${documentId}_${document.filename}`]
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
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET");
      // Allow embedding/preview from other origins (e.g., widget on a different site).
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

  // Upload document endpoint
  app.post("/api/upload/document", upload.single("file"), async (req: Request, res: Response) => {
    try {

      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const file = req.file;
      // Decode filename properly for UTF-8 (Russian characters)
      const filename = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const fileSize = file.size;
      const fileExt = path.extname(filename).toLowerCase(); // e.g., ".pdf"
      const fileType = fileExt.substring(1); // Remove leading dot

      // Get processing type from request (default: general)
      const processingType = (req.body.processingType || "general") as
        | "general"
        | "instruction"
        | "catalog"
        | "certificate"
        | "passport"
        | "warranty_faq";
      const titleRaw = typeof req.body.title === "string" ? req.body.title : undefined;
      const title = titleRaw?.toString().trim();
      // Get skip processing flag (for manual annotation)
      const skipFullProcessing = req.body.skipFullProcessing === "true" || req.body.skipFullProcessing === true;
      
      // Log for debugging
      console.log(`📤 Uploading: ${filename}, type: ${fileType}, size: ${fileSize}, processing: ${processingType}, skipFullProcessing: ${skipFullProcessing}`);

      // Validate file
      const validation = documentProcessor.validateFile(filename, fileSize);
      if (!validation.valid) {
        console.error(`❌ Validation failed: ${validation.error}`);
        // Clean up uploaded file
        fs.unlinkSync(file.path);
        res.status(400).json({ error: validation.error });
        return;
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

      // Process document in background
      processDocumentAsync(documentId, file.path, filename, fileType, processingType, skipFullProcessing).catch((error) => {
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
    | "warranty_faq" = "general",
  skipFullProcessing: boolean = false
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

      await documentDb.updateDocumentStatus(documentId, "indexed");
      await documentDb.updateDocumentChunksCount(documentId, 0);
      await documentDb.updateDocumentProgress(
        documentId,
        "completed",
        100,
        "Готово для ручной разметки — выделите области вручную"
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
    await documentDb.insertDocumentChunks(chunkRecords);
    // Sections already saved above, now save products
    await documentDb.replaceDocumentProducts(documentId, productRecords);
    await documentDb.updateDocumentProgress(documentId, "saving", 90, "Сохраняем данные и обновляем индекс");

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
        title: processed.title,
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

