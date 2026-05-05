import { desc, sql } from "drizzle-orm";
import { documents } from "../../drizzle/schema";
import { getDb } from "../db";
import type { DocumentType } from "./types";
import { tokenize } from "./textProcessing";

export type BasicDocumentHit = {
  id: number;
  filename: string;
  title: string | null;
  fileType: string;
  docType: DocumentType;
  chunksCount: number;
};

export function buildDocumentAttachment(doc: BasicDocumentHit) {
  const base = `/api/documents/${doc.id}/file`;
  return {
    type: "document" as const,
    documentId: doc.id,
    filename: doc.filename,
    title: doc.title,
    fileType: doc.fileType,
    docType: doc.docType,
    previewUrl: base,
    downloadUrl: `${base}?download=1`,
  };
}

function scoreQueryToText(queryTokens: string[], queryNormalized: string, text: string): number {
  const hay = (text || "").toLowerCase();
  if (!hay) return 0;

  let score = 0;
  for (const token of queryTokens) {
    if (token.length < 3) continue;
    if (hay.includes(token)) score += 2;
  }
  if (hay.includes(queryNormalized)) score += 4;

  const compactHay = hay.replace(/[^a-z0-9а-яё]+/gi, "");
  const compactQuery = queryNormalized.replace(/[^a-z0-9а-яё]+/gi, "");
  if (compactQuery.length >= 5 && compactHay.includes(compactQuery)) score += 4;

  return score;
}

export async function findBestDocumentsByTitle(
  query: string,
  docType: DocumentType,
  stopwords: Set<string>,
  limit = 3
): Promise<BasicDocumentHit[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const queryNormalized = query.trim().toLowerCase();
  const queryTokens = tokenize(queryNormalized, stopwords);

  const candidates = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      title: documents.title,
      fileType: documents.fileType,
      docType: documents.docType,
      chunksCount: documents.chunksCount,
    })
    .from(documents)
    .where(sql`${documents.status} = 'indexed' AND ${documents.docType} = ${docType}`)
    .orderBy(desc(documents.createdAt))
    .limit(50);

  return candidates
    .map((d) => {
      const title = d.title ?? "";
      const name = `${title} ${d.filename}`.trim();
      const score = scoreQueryToText(queryTokens, queryNormalized, name);
      return { doc: d as BasicDocumentHit, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.doc);
}
