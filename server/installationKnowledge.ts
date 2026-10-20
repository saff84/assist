import fs from "fs";
import crypto from "crypto";
import path from "path";
import * as documentDb from "./documentDb";
import { pdfToMarkdown, PDF_MARKDOWN_VERSION } from "./pdfMarkdown";
import { processDocument } from "./documentProcessor";
import { generateEmbeddingVector } from "./embeddingClient";
import { tokenize, createStopwordSet } from "./rag/textProcessing";
import { getRagConfig } from "./rag/config";

export function installationPath(id: number, filename: string) {
  return path.resolve(
    "uploads",
    "documents",
    `${id}_${path.basename(filename)}`
  );
}

export function passportKnowledgeHash(pdfHash: string | null) {
  return crypto
    .createHash("sha256")
    .update(`${PDF_MARKDOWN_VERSION}:${pdfHash ?? ""}`)
    .digest("hex");
}

/** One derived MD per passport; original PDF remains searchable in Passports. */
export async function preparePassportKnowledge(passportId: number) {
  const passport = await documentDb.getDocumentById(passportId);
  if (!passport || passport.docType !== "passport")
    throw new Error("Паспорт не найден");
  const filename = `passport-${passportId}.md`;
  const conversionHash = passportKnowledgeHash(passport.contentHash);
  const derived = (await documentDb.getAllDocuments()).find(
    d => d.docType === "installation" && d.filename === filename
  );
  if (
    derived?.contentHash === conversionHash &&
    derived.status !== "failed" &&
    fs.existsSync(installationPath(derived.id, filename))
  ) {
    return {
      id: derived.id,
      state: derived.status === "indexed" ? "indexed" : "review",
    };
  }
  if (derived && indexing.has(derived.id))
    throw new Error(
      "Документ индексируется. Повторите синхронизацию после завершения."
    );
  if (derived)
    await documentDb.updateDocumentStatus(
      derived.id,
      "failed",
      "Ожидается повторная обработка PDF обновлённым конвертером."
    );
  const markdown = await pdfToMarkdown(
    installationPath(passport.id, passport.filename),
    passport.title || passport.filename
  );
  const id =
    derived?.id ??
    (await documentDb.createDocument({
      filename,
      fileType: "md",
      fileSize: Buffer.byteLength(markdown),
      uploadedBy: passport.uploadedBy,
      processingType: "installation",
      docType: "installation",
      status: "processing",
      title: passport.title,
      syncSourceId: passport.syncSourceId,
    }));
  // Invalidate old content before publishing a changed draft.
  await documentDb.updateDocumentStatus(id, "processing");
  await documentDb.deleteDocumentChunks(id);
  await documentDb.updateDocumentChunksCount(id, 0);
  fs.writeFileSync(installationPath(id, filename), markdown, "utf8");
  fs.copyFileSync(
    installationPath(passport.id, passport.filename),
    installationPath(id, `download_${passport.filename}`)
  );
  await documentDb.updateDocumentDownloadFilename(id, passport.filename);
  await documentDb.updateDocumentSyncRecord(id, {
    contentHash: conversionHash,
    title: passport.title,
    fileSize: Buffer.byteLength(markdown),
    syncSourceId: passport.syncSourceId,
    status: "processing",
    errorMessage: null,
    processingMessage:
      "Markdown готов. Проверьте текст и нажмите «Индексировать».",
  });
  await documentDb.updateDocumentProgress(
    id,
    "chunking",
    40,
    "Ожидает проверки Markdown"
  );
  return { id, state: "review" };
}

const indexing = new Set<number>();
export async function indexInstallationMarkdown(id: number, markdown?: string) {
  if (indexing.has(id)) throw new Error("Документ уже индексируется");
  indexing.add(id);
  try {
    const doc = await documentDb.getDocumentById(id);
    if (!doc || doc.docType !== "installation" || doc.fileType !== "md")
      throw new Error("Документ Markdown не найден");
    const passportMatch = /^passport-(\d+)\.md$/.exec(doc.filename);
    if (passportMatch && doc.syncSourceId != null) {
      const source = await documentDb.getDocumentById(Number(passportMatch[1]));
      if (!source || source.status !== "indexed")
        throw new Error(
          "Исходный паспорт недоступен. Сначала выполните синхронизацию источника."
        );
    }
    await documentDb.updateDocumentStatus(id, "processing");
    await documentDb.updateDocumentProgress(
      id,
      "embedding",
      50,
      "Индексация проверенного Markdown"
    );
    const filePath = installationPath(id, doc.filename);
    if (markdown !== undefined) fs.writeFileSync(filePath, markdown, "utf8");
    const processed = await processDocument(filePath, "installation");
    if (!processed.chunks.length)
      throw new Error("В Markdown нет данных для индексации");
    const records = [];
    const stopwords = createStopwordSet(
      getRagConfig().retrieval.stopwords.extra ?? []
    );
    for (const chunk of processed.chunks) {
      const vector = await generateEmbeddingVector(chunk.content, {
        model: process.env.EMBEDDING_MODEL || "bge-m3",
        maxChars: 4000,
        retries: 2,
      });
      if (!vector.embedding)
        throw new Error(
          `Эмбеддинг фрагмента ${chunk.chunkIndex}: ${vector.error || "пустой результат"}`
        );
      records.push({
        documentId: id,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        embedding: JSON.stringify(vector.embedding),
        pageNumber: Number.parseInt(chunk.metadata.pageRange, 10) || null,
        sectionPath: chunk.sectionPath,
        elementType:
          chunk.elementType === "table"
            ? ("table" as const)
            : ("text" as const),
        tableJson: chunk.tableRows ?? null,
        chunkMetadata: chunk.metadata,
        bm25Terms: tokenize(chunk.content, stopwords).join(" "),
        language: "ru",
      });
    }
    await documentDb.deleteDocumentChunks(id);
    await documentDb.insertDocumentChunks(records);
    await documentDb.replaceDocumentSections(
      id,
      (processed.sections ?? []).map(section => ({
        documentId: id,
        sectionPath: section.sectionPath.slice(0, 512),
        title: section.title.slice(0, 500),
        level: section.level,
        pageStart: section.pageStart ?? null,
        pageEnd: section.pageEnd ?? null,
      }))
    );
    await documentDb.updateDocumentMetadata(
      id,
      processed.documentMetadata ?? {},
      {
        docType: "installation",
        pages: processed.numPages,
        toc: processed.sections ?? [],
      }
    );
    await documentDb.updateDocumentChunksCount(id, records.length);
    await documentDb.updateDocumentSyncRecord(id, {
      status: "indexed",
      errorMessage: null,
      fileSize: fs.statSync(filePath).size,
      processingMessage: `Проиндексировано фрагментов: ${records.length}`,
    });
    return { chunks: records.length };
  } catch (error) {
    await documentDb.updateDocumentStatus(
      id,
      "failed",
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  } finally {
    indexing.delete(id);
  }
}
