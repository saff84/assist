/**
 * Company knowledge store: sections on disk + assembled Markdown + DB docs for RAG.
 */
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import * as documentDb from "./documentDb";
import * as documentProcessor from "./documentProcessor";
import { generateEmbeddingVector } from "./embeddingClient";
import { getRagConfig } from "./rag/config";
import { createStopwordSet, tokenize } from "./rag/textProcessing";
import type { InsertDocumentChunk } from "../drizzle/schema";

const COMPANY_DIR = path.join(process.cwd(), "uploads", "company");
const SECTIONS_DIR = path.join(COMPANY_DIR, "sections");
const MANIFEST_PATH = path.join(COMPANY_DIR, "sections.json");
const ASSEMBLED_PATH = path.join(COMPANY_DIR, "company_knowledge.md");

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "bge-m3";
const TOKEN_CHAR_RATIO = 4;

export type CompanySectionMeta = {
  id: string;
  title: string;
  filename: string;
  sourceType: "upload" | "paste";
  documentId: number | null;
  createdAt: string;
  charCount: number;
};

type Manifest = { sections: CompanySectionMeta[] };

function ensureDirs() {
  for (const dir of [COMPANY_DIR, SECTIONS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(MANIFEST_PATH)) {
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ sections: [] }, null, 2), "utf-8");
  }
  if (!fs.existsSync(ASSEMBLED_PATH)) {
    fs.writeFileSync(ASSEMBLED_PATH, "", "utf-8");
  }
}

function readManifest(): Manifest {
  ensureDirs();
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Manifest;
    if (!parsed || !Array.isArray(parsed.sections)) return { sections: [] };
    return parsed;
  } catch {
    return { sections: [] };
  }
}

function writeManifest(manifest: Manifest) {
  ensureDirs();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
}

function sectionContentPath(id: string) {
  return path.join(SECTIONS_DIR, `${id}.md`);
}

export function getAssembledPath(): string {
  ensureDirs();
  return ASSEMBLED_PATH;
}

export function readAssembledMarkdown(): string {
  ensureDirs();
  if (!fs.existsSync(ASSEMBLED_PATH)) return "";
  return fs.readFileSync(ASSEMBLED_PATH, "utf-8");
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / TOKEN_CHAR_RATIO));
}

export function getCompanyFullMdMaxTokens(): number {
  const fromEnv = Number(process.env.COMPANY_FULL_MD_MAX_TOKENS);
  if (Number.isFinite(fromEnv) && fromEnv > 500) return fromEnv;
  return 8000;
}

export function listSections(): CompanySectionMeta[] {
  return readManifest().sections.slice().sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1
  );
}

function rebuildAssembled(manifest: Manifest): string {
  const parts: string[] = [
    "# База знаний: о компании\n",
    "> Автосборный файл. Секции добавляются при загрузке файлов и вставке текста.\n",
  ];

  for (const section of manifest.sections) {
    const contentPath = sectionContentPath(section.id);
    const body = fs.existsSync(contentPath)
      ? fs.readFileSync(contentPath, "utf-8").trim()
      : "";
    parts.push(
      `\n---\n\n<!-- SECTION id="${section.id}" title="${escapeAttr(section.title)}" filename="${escapeAttr(section.filename)}" createdAt="${section.createdAt}" -->\n\n## ${section.title}\n\n_Источник: ${section.filename}_\n\n${body}\n\n<!-- /SECTION id="${section.id}" -->\n`
    );
  }

  const assembled = parts.join("\n").trim() + "\n";
  fs.writeFileSync(ASSEMBLED_PATH, assembled, "utf-8");
  return assembled;
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, "'").replace(/\n/g, " ").slice(0, 200);
}

function chunkMarkdown(content: string, maxChars = 1200): string[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    if ((buf + "\n\n" + p).length > maxChars && buf) {
      chunks.push(buf.trim());
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.length ? chunks : content.trim() ? [content.trim()] : [];
}

function buildLexicalTerms(text: string): string {
  try {
    const stopwords = createStopwordSet(getRagConfig().retrieval.stopwords.extra ?? []);
    return tokenize(text, stopwords).join(" ");
  } catch {
    return "";
  }
}

async function indexSectionDocument(
  section: CompanySectionMeta,
  content: string,
  uploadedBy: number
): Promise<number> {
  const title = section.title.slice(0, 500);
  const filename = `company_${section.id}.md`;

  let documentId = section.documentId;
  if (documentId) {
    await documentDb.deleteDocumentChunks(documentId);
    await documentDb.updateDocumentStatus(documentId, "processing");
  } else {
    documentId = await documentDb.createDocument({
      filename,
      fileType: "md",
      fileSize: Buffer.byteLength(content, "utf-8"),
      uploadedBy,
      status: "processing",
      processingType: "company",
      docType: "company",
      title,
      processingStage: "embedding",
      processingProgress: 10,
      processingMessage: "Индексация раздела «О компании»",
      chunksCount: 0,
    });
  }

  const pieces = chunkMarkdown(content);
  const chunkRecords: InsertDocumentChunk[] = [];

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!;
    const emb = await generateEmbeddingVector(piece, {
      model: EMBEDDING_MODEL,
      maxChars: 4000,
      retries: 2,
    });
    chunkRecords.push({
      documentId,
      chunkIndex: i,
      content: piece,
      tokenCount: estimateTokens(piece),
      embedding: emb.embedding ? JSON.stringify(emb.embedding) : null,
      pageNumber: 1,
      sectionPath: section.id,
      elementType: "text",
      tableJson: null,
      language: "ru",
      bm25Terms: buildLexicalTerms(piece),
      chunkMetadata: {
        section: section.title,
        heading: section.title,
        sectionPath: section.id,
        importance: "medium",
        category: "company",
        tags: ["company", "sanext"],
      },
    });
  }

  if (chunkRecords.length) {
    await documentDb.insertDocumentChunks(chunkRecords);
  }
  await documentDb.updateDocumentChunksCount(documentId, chunkRecords.length);
  await documentDb.updateDocumentMetadata(
    documentId,
    { tags: ["company"], customFields: { sectionId: section.id } },
    { title, docType: "company", pages: 1 }
  );
  await documentDb.updateDocumentStatus(documentId, "indexed");
  return documentId;
}

export async function fileToMarkdown(
  tempPath: string,
  originalFilename: string
): Promise<string> {
  const ext = path.extname(originalFilename).toLowerCase();
  if (ext === ".md" || ext === ".markdown" || ext === ".txt") {
    return fs.readFileSync(tempPath, "utf-8").replace(/^\uFEFF/, "").trim();
  }

  // PDF/DOCX/XLSX via existing processor (general mode)
  const processed = await documentProcessor.processDocument(tempPath, "general");
  const fromChunks = (processed.chunks ?? [])
    .map((c) => c.content?.trim())
    .filter(Boolean)
    .join("\n\n");
  if (fromChunks.trim()) return fromChunks.trim();

  const fromElements = (processed.elements ?? [])
    .map((e: any) => (typeof e.content === "string" ? e.content.trim() : ""))
    .filter(Boolean)
    .join("\n\n");
  return fromElements.trim();
}

export async function appendMarkdownSection(input: {
  title: string;
  filename: string;
  sourceType: "upload" | "paste";
  markdown: string;
  uploadedBy?: number;
}): Promise<CompanySectionMeta> {
  ensureDirs();
  const markdown = (input.markdown || "").trim();
  if (!markdown) {
    throw new Error("Пустое содержимое секции");
  }

  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  const meta: CompanySectionMeta = {
    id,
    title: (input.title || input.filename || "Без названия").trim().slice(0, 200),
    filename: (input.filename || "paste.txt").trim().slice(0, 255),
    sourceType: input.sourceType,
    documentId: null,
    createdAt: new Date().toISOString(),
    charCount: markdown.length,
  };

  fs.writeFileSync(sectionContentPath(id), markdown, "utf-8");

  const documentId = await indexSectionDocument(meta, markdown, input.uploadedBy ?? 1);
  meta.documentId = documentId;

  const manifest = readManifest();
  manifest.sections.push(meta);
  writeManifest(manifest);
  rebuildAssembled(manifest);

  return meta;
}

export async function deleteSection(sectionId: string): Promise<boolean> {
  ensureDirs();
  const manifest = readManifest();
  const idx = manifest.sections.findIndex((s) => s.id === sectionId);
  if (idx < 0) return false;

  const [removed] = manifest.sections.splice(idx, 1);
  writeManifest(manifest);

  const contentPath = sectionContentPath(sectionId);
  if (fs.existsSync(contentPath)) fs.unlinkSync(contentPath);

  if (removed?.documentId) {
    try {
      await documentDb.deleteDocument(removed.documentId);
    } catch (error) {
      console.warn(`[CompanyKB] Failed to delete document ${removed.documentId}:`, error);
    }
  }

  rebuildAssembled(manifest);
  return true;
}

export function getAssembledStats(): {
  sectionCount: number;
  charCount: number;
  estimatedTokens: number;
  path: string;
} {
  const md = readAssembledMarkdown();
  return {
    sectionCount: readManifest().sections.length,
    charCount: md.length,
    estimatedTokens: estimateTokens(md),
    path: ASSEMBLED_PATH,
  };
}
