import fs from "fs";
import crypto from "crypto";
import path from "path";
import * as documentDb from "./documentDb";
import { pdfToMarkdown, PDF_MARKDOWN_VERSION } from "./pdfMarkdown";
import { processDocument } from "./documentProcessor";
import { generateEmbeddingVector } from "./embeddingClient";
import { tokenize, createStopwordSet } from "./rag/textProcessing";
import { getRagConfig } from "./rag/config";
import {
  saveInstallationReview,
  type ReviewKind,
} from "./installationReviewStore";

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

/** Converter upgrades must not erase a reviewed MD or the user's draft edits. */
export function hasSamePassportSource(
  derived: {
    contentHash: string | null;
    documentMetadata?: { customFields?: Record<string, any> } | null;
  },
  pdfHash: string | null
) {
  if (!pdfHash) return false;
  const savedSource =
    derived.documentMetadata?.customFields?.installationSourceHash;
  if (typeof savedSource === "string") return savedSource === pdfHash;
  return (
    derived.contentHash === pdfHash ||
    ["layout-v1", "layout-v2", "layout-v3", "layout-v4", PDF_MARKDOWN_VERSION].some(
      version =>
        derived.contentHash ===
        crypto
          .createHash("sha256")
          .update(`${version}:${pdfHash}`)
          .digest("hex")
    )
  );
}

const convertingPassports = new Set<number>();

/** One derived MD per passport; original PDF remains searchable in Passports. */
export async function preparePassportKnowledge(
  passportId: number,
  options: { force?: boolean } = {}
) {
  if (convertingPassports.has(passportId))
    throw new Error("Этот паспорт уже преобразуется в Markdown");
  convertingPassports.add(passportId);
  try {
    return await buildPassportKnowledge(passportId, options);
  } finally {
    convertingPassports.delete(passportId);
  }
}

async function buildPassportKnowledge(
  passportId: number,
  options: { force?: boolean }
) {
  const passport = await documentDb.getDocumentById(passportId);
  if (!passport || passport.docType !== "passport")
    throw new Error("Паспорт не найден");
  const filename = `passport-${passportId}.md`;
  const conversionHash = passportKnowledgeHash(passport.contentHash);
  const derived = (await documentDb.getAllDocuments()).find(
    d => d.docType === "installation" && d.filename === filename
  );
  if (
    !options.force &&
    derived &&
    hasSamePassportSource(derived, passport.contentHash) &&
    fs.existsSync(installationPath(derived.id, filename))
  ) {
    if (derived.status === "failed")
      throw new Error(
        `MD сохранён; требуется исправить ошибку обработки: ${derived.errorMessage || "ошибка индексации"}`
      );
    if (!derived.documentMetadata?.customFields?.installationSourceHash) {
      const metadata = derived.documentMetadata ?? {};
      const markdown = fs.readFileSync(
        installationPath(derived.id, filename),
        "utf8"
      );
      const converter =
        /pdf-markdown:([^\s>]+)/.exec(markdown)?.[1] ?? "legacy";
      const review =
        derived.status === "indexed"
          ? saveInstallationReview(
              derived.id,
              markdown,
              passport.contentHash,
              converter,
              "legacy"
            )
          : metadata.customFields?.installationReview;
      await documentDb.updateDocumentMetadata(derived.id, {
        ...metadata,
        customFields: {
          ...metadata.customFields,
          installationSourceHash: passport.contentHash,
          installationReview: review,
        },
      });
    }
    return {
      id: derived.id,
      state: derived.status === "indexed" ? "indexed" : "review",
    };
  }
  if (derived && indexing.has(derived.id))
    throw new Error(
      "Документ индексируется. Повторите синхронизацию после завершения."
    );
  let previousReview =
    derived?.documentMetadata?.customFields?.installationReview ??
    derived?.documentMetadata?.customFields?.previousInstallationReview;
  if (
    derived &&
    (derived.status === "indexed" ||
      derived.documentMetadata?.customFields?.installationReview) &&
    fs.existsSync(installationPath(derived.id, filename))
  ) {
    previousReview = saveInstallationReview(
      derived.id,
      fs.readFileSync(installationPath(derived.id, filename), "utf8"),
      derived.documentMetadata?.customFields?.installationSourceHash ??
        (hasSamePassportSource(derived, passport.contentHash)
          ? passport.contentHash
          : null),
      derived.documentMetadata?.customFields?.installationConverterVersion ??
        "legacy",
      "legacy"
    );
  }
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
  const metadata = derived?.documentMetadata ?? {};
  await documentDb.updateDocumentMetadata(id, {
    ...metadata,
    customFields: {
      ...metadata.customFields,
      installationSourceHash: passport.contentHash,
      installationConverterVersion: PDF_MARKDOWN_VERSION,
      installationRequiresReview: true,
      installationReview: undefined,
      previousInstallationReview: previousReview,
    },
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
export async function indexInstallationMarkdown(
  id: number,
  markdown?: string,
  options: { reviewKind?: ReviewKind } = {}
) {
  if (indexing.has(id)) throw new Error("Документ уже индексируется");
  indexing.add(id);
  try {
    const doc = await documentDb.getDocumentById(id);
    if (!doc || doc.docType !== "installation" || doc.fileType !== "md")
      throw new Error("Документ Markdown не найден");
    const passportMatch = /^passport-(\d+)\.md$/.exec(doc.filename);
    let sourcePdfHash: string | null =
      doc.documentMetadata?.customFields?.installationSourceHash ?? null;
    if (passportMatch && doc.syncSourceId != null) {
      if (convertingPassports.has(Number(passportMatch[1])))
        throw new Error(
          "Паспорт ещё преобразуется в Markdown. Дождитесь завершения."
        );
      const source = await documentDb.getDocumentById(Number(passportMatch[1]));
      sourcePdfHash = source?.contentHash ?? sourcePdfHash;
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
    const indexedMarkdown = fs.readFileSync(filePath, "utf8");
    const review = saveInstallationReview(
      id,
      indexedMarkdown,
      sourcePdfHash,
      /pdf-markdown:([^\s>]+)/.exec(indexedMarkdown)?.[1] ?? "legacy",
      options.reviewKind ?? (markdown === undefined ? "repair" : "manual")
    );
    const reviewedMetadata = {
      ...doc.documentMetadata,
      ...processed.documentMetadata,
      customFields: {
        ...doc.documentMetadata?.customFields,
        installationSourceHash: sourcePdfHash,
        installationReview: review,
        installationRequiresReview: false,
      },
    };
    // Approval is durable independently of embedding-service availability.
    await documentDb.updateDocumentMetadata(id, reviewedMetadata);
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
    await documentDb.updateDocumentMetadata(id, reviewedMetadata, {
      docType: "installation",
      pages: processed.numPages,
      toc: processed.sections ?? [],
    });
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
