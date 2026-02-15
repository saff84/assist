import { eq, desc, sql } from "drizzle-orm";

import {
  chatHistory,
  documentChunks,
  documents,
  products,
  systemPrompts,
  faqEntries,
} from "../drizzle/schema";
import { getDb } from "./db";
import * as documentDb from "./documentDb";
import { invokeLLM } from "./_core/llm";
import { getRagConfig } from "./rag/config";
import { getSystemPromptTemplate } from "./rag/promptLoader";
import {
  buildTermFrequency,
  createStopwordSet,
  extractSkuCandidates,
  hasCatalogIntent,
  hasInstallationIntent,
  normalizeToken,
  tokenize,
  truncateContent,
} from "./rag/textProcessing";
import { buildContext } from "./rag/contextBuilder";
import { rerankChunks } from "./rag/reranker";
import type {
  ContextSourceEntry,
  ContextTableEntry,
  DocumentType,
  RAGConfig,
  RAGOptions,
  RetrievalDiagnostics,
  RetrieverChunk,
  ScoredChunk,
} from "./rag/types";

export interface RAGQuery {
  query: string;
  sessionId?: string;
  userId?: number;
  source: "website" | "bitrix24" | "test";
  topK?: number;
}

export interface RAGResponse {
  response: string;
  sources: Array<{
    documentId: number;
    filename: string;
    chunkIndex: number;
    relevance: number;
    pageNumber?: number;
    sectionPath?: string;
    chunkContent?: string;
  }>;
  attachments?: Array<{
    type: "document";
    documentId: number;
    filename: string;
    title?: string | null;
    fileType: string;
    docType: DocumentType;
    previewUrl: string;
    downloadUrl: string;
  }>;
  chunks?: Array<{
    documentId: number;
    chunkIndex: number;
    sectionPath: string;
    pageNumber: number;
    elementType: string;
    filename: string;
    relevance: number;
    hasTable: boolean;
    chunkContent?: string;
  }>;
  responseTime: number;
  tokensUsed: number;
  diagnostics?: {
    retrieval: RetrievalDiagnostics;
    context: string;
    usedSources: ContextSourceEntry[];
  };
}

interface DocumentMeta {
  id: number;
  filename: string;
  docType: DocumentType;
  processingType: string;
  title?: string | null;
}

interface RetrievalResult {
  chunks: ScoredChunk[];
  diagnostics: RetrievalDiagnostics;
  documentMeta: Map<number, DocumentMeta>;
}

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const TOKEN_CHAR_RATIO = 4;
const sectionChunksCache = new Map<string, documentDb.ChunkBaseInfo[]>();
const sectionFetchLocks = new Map<string, Promise<documentDb.ChunkBaseInfo[]>>();

type BasicDocumentHit = {
  id: number;
  filename: string;
  title: string | null;
  fileType: string;
  docType: DocumentType;
  chunksCount: number;
};

function buildDocumentAttachment(doc: BasicDocumentHit) {
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
  // Substring matches are strong signals for certificate names
  for (const token of queryTokens) {
    if (token.length < 3) continue;
    if (hay.includes(token)) score += 2;
  }
  if (hay.includes(queryNormalized)) score += 4;

  // Extra bonus for exact-ish phrase without spaces/punct
  const compactHay = hay.replace(/[^a-z0-9а-яё]+/gi, "");
  const compactQuery = queryNormalized.replace(/[^a-z0-9а-яё]+/gi, "");
  if (compactQuery.length >= 5 && compactHay.includes(compactQuery)) score += 4;

  return score;
}

async function findBestDocumentsByTitle(
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
    .where(
      sql`${documents.status} = 'indexed' AND ${documents.docType} = ${docType}`
    )
    .orderBy(desc(documents.createdAt))
    .limit(50);

  const scored = candidates
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

  return scored;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) {
    return 0;
  }

  return dot / magnitude;
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return vector.slice();
  }
  return vector.map((value) => value / norm);
}

async function generateEmbedding(
  text: string,
  config: RAGConfig,
  dimensionsHint?: number
): Promise<number[]> {
  const model = config.retrieval.embeddingModel;
  const ollamaUrl =
    process.env.OLLAMA_URL ||
    process.env.OLLAMA_BASE_URL ||
    "http://ollama:11434";

  try {
    const input = text.substring(0, 2000);
    const request = async (endpoint: string, body: any) => {
      const response = await fetch(`${ollamaUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return response;
    };

    let response = await request("/api/embed", { model, input });
    if (response.status === 404) {
      response = await request("/api/embeddings", { model, prompt: input });
    }
    if (response.status === 404) {
      // On first boot the embedding model may still be pulling; retry once.
      await new Promise((r) => setTimeout(r, 2000));
      response = await request("/api/embed", { model, input });
      if (response.status === 404) {
        response = await request("/api/embeddings", { model, prompt: input });
      }
    }

    if (!response.ok) {
      console.error(
        `[RAG] Embedding request failed (${response.status} ${response.statusText})`
      );
      return fallbackEmbedding(text, dimensionsHint);
    }

    const payload: any = await response.json();
    if (Array.isArray(payload?.embedding)) {
      return payload.embedding as number[];
    }
    if (Array.isArray(payload?.embeddings) && Array.isArray(payload.embeddings[0])) {
      return payload.embeddings[0] as number[];
    }

    console.error("[RAG] Unexpected embedding response format");
    return fallbackEmbedding(text, dimensionsHint);
  } catch (error) {
    console.error("[RAG] Failed to generate embedding:", error);
    return fallbackEmbedding(text, dimensionsHint);
  }
}

function fallbackEmbedding(text: string, dimensionsHint?: number): number[] {
  const dimension = dimensionsHint && dimensionsHint > 0 ? dimensionsHint : 384;
  const vector = new Array(dimension).fill(0);

  for (let i = 0; i < text.length; i += 1) {
    const charCode = text.charCodeAt(i);
    vector[i % dimension] += charCode / 256;
  }

  return normalizeVector(vector);
}

function computeBm25Score(
  queryTerms: string[],
  termFrequency: Map<string, number>,
  docLength: number,
  avgDocLength: number,
  docFrequency: Map<string, number>,
  totalDocs: number
): number {
  if (!queryTerms.length) {
    return 0;
  }

  let score = 0;

  for (const term of queryTerms) {
    const tf = termFrequency.get(term) ?? 0;
    if (tf === 0) continue;

    const df = docFrequency.get(term) ?? 0.5;
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);

    const numerator = tf * (BM25_K1 + 1);
    const denominator =
      tf +
      BM25_K1 *
        (1 -
          BM25_B +
          (BM25_B * docLength) / (avgDocLength <= 0 ? 1 : avgDocLength));

    score += idf * (numerator / denominator);
  }

  return score;
}

function applyMmr(
  candidates: ScoredChunk[],
  lambda: number,
  targetSize: number
): ScoredChunk[] {
  const selected: ScoredChunk[] = [];
  const remaining = [...candidates];

  while (selected.length < targetSize && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];

      let diversity = 0;
      if (selected.length > 0) {
        diversity = Math.max(
          ...selected.map((item) =>
            cosineSimilarity(
              candidate.embeddingVector ?? [],
              item.embeddingVector ?? []
            )
          )
        );
      }

      const mmrScore = lambda * candidate.relevance - (1 - lambda) * diversity;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = i;
      }
    }

    const [chosen] = remaining.splice(bestIndex, 1);
    selected.push(chosen);
  }

  return selected;
}

async function fetchRawChunks(
  config: RAGConfig
): Promise<{
  chunks: Array<{
    id: number;
    documentId: number;
    content: string;
    chunkIndex: number;
    embedding: string | null;
    bm25Terms: string | null;
    pageNumber: number | null;
    sectionPath: string | null;
    metadata: any;
    tableJson: Array<Record<string, string | number | null>> | null;
    docType: DocumentType;
    processingType: string;
    filename: string;
    title: string | null;
  }>;
  documentMeta: Map<number, DocumentMeta>;
}> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const rows = await db
    .select({
      id: documentChunks.id,
      documentId: documentChunks.documentId,
      content: documentChunks.content,
      chunkIndex: documentChunks.chunkIndex,
      embedding: documentChunks.embedding,
      bm25Terms: documentChunks.bm25Terms,
      pageNumber: documentChunks.pageNumber,
      sectionPath: documentChunks.sectionPath,
      metadata: documentChunks.chunkMetadata,
      tableJson: documentChunks.tableJson,
      docType: documents.docType,
      processingType: documents.processingType,
      filename: documents.filename,
      title: documents.title,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documentChunks.documentId, documents.id))
    .where(eq(documents.status, "indexed"))
    .limit(config.retrieval.maxInitialChunks);

  const faqRows = await db
    .select({
      id: faqEntries.id,
      title: faqEntries.title,
      content: faqEntries.content,
      embedding: faqEntries.embedding,
      bm25Terms: faqEntries.bm25Terms,
      images: faqEntries.images,
      tags: faqEntries.tags,
    })
    .from(faqEntries)
    .limit(5000);

  const meta = new Map<number, DocumentMeta>();

  rows.forEach((row) => {
    if (!meta.has(row.documentId)) {
      meta.set(row.documentId, {
        id: row.documentId,
        filename: row.filename,
        docType: row.docType,
        processingType: row.processingType,
        title: row.title,
      });
    }
  });

  // Merge FAQ entries as pseudo-chunks under a single virtual "document"
  const FAQ_DOC_ID = 0;
  if (faqRows.length > 0) {
    meta.set(FAQ_DOC_ID, {
      id: FAQ_DOC_ID,
      filename: "FAQ (ручной ввод)",
      docType: "warranty_faq",
      processingType: "warranty_faq",
      title: "FAQ (ручной ввод)",
    });
  }

  const faqAsChunks = faqRows.map((f) => ({
    id: 1_000_000_000 + f.id, // avoid collisions with document_chunks ids
    documentId: FAQ_DOC_ID,
    content: f.content,
    chunkIndex: f.id,
    embedding: f.embedding,
    bm25Terms: f.bm25Terms,
    pageNumber: null,
    sectionPath: `FAQ: ${f.title}`.slice(0, 512),
    metadata: {
      source: "faq_entry",
      faqEntryId: f.id,
      title: f.title,
      images: f.images ?? [],
      tags: f.tags ?? [],
    },
    tableJson: null,
    docType: "warranty_faq" as const,
    processingType: "warranty_faq",
    filename: "FAQ (ручной ввод)",
    title: f.title,
  }));

  return {
    chunks: [...rows, ...faqAsChunks],
    documentMeta: meta,
  };
}

function prepareRetrieverChunks(
  rows: Awaited<ReturnType<typeof fetchRawChunks>>["chunks"],
  stopwords: Set<string>,
  fallbackDimensions: number
): {
  chunkStats: RetrieverChunk[];
  docFrequency: Map<string, number>;
  avgDocLength: number;
} {
  const docFrequency = new Map<string, number>();
  const chunkStats: RetrieverChunk[] = rows.map((row) => {
    let parsedEmbedding: number[] | null = null;
    if (row.embedding) {
      try {
        const parsed = JSON.parse(row.embedding);
        if (Array.isArray(parsed)) {
          parsedEmbedding = parsed;
        }
      } catch {
        parsedEmbedding = null;
      }
    }

    let metadata: Record<string, any> | null = null;
    if (row.metadata) {
      if (typeof row.metadata === "string") {
        try {
          metadata = JSON.parse(row.metadata);
        } catch {
          metadata = { raw: row.metadata };
        }
      } else {
        metadata = row.metadata;
      }
    }

    const termFrequency = buildTermFrequency(row.content, stopwords);

    termFrequency.forEach((_, term) => {
      docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
    });

    const termCount = Array.from(termFrequency.values()).reduce(
      (sum, value) => sum + value,
      0
    );

    // Merge tableJson into metadata if available
    if (row.tableJson && Array.isArray(row.tableJson) && row.tableJson.length > 0) {
      if (!metadata) {
        metadata = {};
      }
      metadata.tableJson = row.tableJson;
    }

    return {
      id: row.id,
      documentId: row.documentId,
      content: row.content,
      chunkIndex: row.chunkIndex,
      embeddingVector: parsedEmbedding
        ? normalizeVector(parsedEmbedding)
        : null,
      termFrequency,
      termCount: termCount || 1,
      pageNumber: row.pageNumber,
      sectionPath: row.sectionPath,
      metadata,
      docType: row.docType,
      processingType: row.processingType,
      filename: row.filename,
      heading: metadata?.heading ?? metadata?.section ?? null,
      tags: Array.isArray(metadata?.tags)
        ? metadata?.tags.map((tag: string) => tag.toString())
        : undefined,
    };
  });

  const avgDocLength =
    chunkStats.reduce((sum, chunk) => sum + chunk.termCount, 0) /
      (chunkStats.length || 1) || 1;

  return { chunkStats, docFrequency, avgDocLength };
}

async function computeProductBoosts(
  querySkuTokens: string[]
): Promise<Map<number, number>> {
  if (!querySkuTokens.length) {
    return new Map();
  }

  const db = await getDb();
  if (!db) {
    return new Map();
  }

  const rows = await db
    .select({
      documentId: products.documentId,
      sku: products.sku,
    })
    .from(products);

  const normalizedTokens = new Set(
    querySkuTokens.map((token) => token.replace(/[-–]/g, "").toUpperCase())
  );

  const matches = new Map<number, number>();
  rows.forEach((row) => {
    const token = row.sku.replace(/[-–]/g, "").toUpperCase();
    if (normalizedTokens.has(token)) {
      matches.set(row.documentId, (matches.get(row.documentId) ?? 0) + 1);
    }
  });

  return matches;
}

function computeBoosts(
  chunk: RetrieverChunk,
  queryNormalized: string,
  queryTokens: string[],
  stopwords: Set<string>,
  document: DocumentMeta,
  skuTokens: string[],
  matchesByDoc: Map<number, number>,
  config: RAGConfig,
  intents: { installation: boolean; catalog: boolean }
): { totalBoost: number; reasons: string[] } {
  const boosts = config.retrieval.boosts;
  const reasons: string[] = [];
  let total = 0;
  const queryTokenSet = new Set(queryTokens);

  // Lightweight synonym expansion for better section matching (esp. passports)
  const manufacturerQuery =
    queryNormalized.includes("производ") || queryNormalized.includes("изготов");
  if (manufacturerQuery) {
    // Add both base/stem forms to maximize overlap with tokenizers
    ["производител", "производитель", "изготовител", "изготовитель"].forEach(
      (t) => queryTokenSet.add(t)
    );
  }

  const sectionCandidate =
    chunk.metadata?.section ?? chunk.heading ?? chunk.sectionPath ?? null;
  if (
    typeof sectionCandidate === "string" &&
    tokenize(sectionCandidate, stopwords).some((token) =>
      queryTokenSet.has(token)
    )
  ) {
    total += boosts.sectionMatch;
    reasons.push("section_match");
  }

  // Avoid misrouting "производитель/изготовитель" questions into warranty sections.
  if (manufacturerQuery) {
    const queryAsksWarranty = queryNormalized.includes("гарант");
    const sectionLower =
      typeof chunk.sectionPath === "string" ? chunk.sectionPath.toLowerCase() : "";
    const contentLower = chunk.content.toLowerCase();

    // Stronger heuristics for passports/certificates: "производитель" often appears in warranty text
    // ("Производитель гарантирует...") and should not win manufacturer queries.
    if (!queryAsksWarranty && sectionLower.includes("гарант")) {
      total -= 0.7;
      reasons.push("manufacturer_guarantee_penalty");
    }
    if (!queryAsksWarranty && contentLower.includes("производитель гарантирует")) {
      total -= 0.4;
      reasons.push("manufacturer_guarantee_phrase_penalty");
    }

    if (sectionLower.includes("изготов")) {
      total += 0.8;
      reasons.push("manufacturer_section_bonus");
    } else if (
      sectionLower.includes("производ") &&
      !sectionLower.includes("гарант")
    ) {
      total += 0.35;
      reasons.push("manufacturer_section_soft_bonus");
    }
  }

  if (
    document.title &&
    tokenize(document.title, stopwords).some((token) =>
      queryTokenSet.has(token)
    )
  ) {
    total += boosts.titleMatch;
    reasons.push("title_match");
  }

  if (chunk.tags && chunk.tags.length > 0) {
    const hasTagMatch = chunk.tags.some((tag) =>
      tokenize(tag, stopwords).some((token) => queryTokenSet.has(token))
    );
    if (hasTagMatch) {
      total += boosts.tagMatch;
      reasons.push("tag_match");
    }
  }

  const variantNormalized =
    typeof (chunk.metadata as any)?.productVariantNormalized === "string"
      ? ((chunk.metadata as any).productVariantNormalized as string)
      : typeof (chunk.metadata as any)?.variantNormalized === "string"
      ? ((chunk.metadata as any).variantNormalized as string)
      : null;
  if (boosts.variantMatch > 0 && variantNormalized) {
    const variantTokens = tokenize(variantNormalized, stopwords);
    const hasVariantMatch = variantTokens.some((token) =>
      queryTokenSet.has(token)
    );
    if (hasVariantMatch) {
      total += boosts.variantMatch;
      reasons.push("variant_match");
    }
  }

  if (skuTokens.length > 0) {
    const normalizedContent = chunk.content.replace(/[-–]/g, "").toUpperCase();
    const skuMatch = skuTokens.some((sku) =>
      normalizedContent.includes(sku.toUpperCase())
    );
    if (skuMatch) {
      total += boosts.skuMatch;
      reasons.push("sku_match_chunk");
    }
    const docMatchCount = matchesByDoc.get(chunk.documentId);
    if (docMatchCount && docMatchCount > 0) {
      total += Math.min(boosts.skuMatch * docMatchCount, boosts.skuMatch * 2);
      reasons.push("sku_match_document");
    }
  }

  if (intents.installation) {
    if (chunk.docType === "instruction") {
      total += boosts.instructionPriority;
      reasons.push("installation_instruction_priority");
    } else if (chunk.docType === "catalog") {
      total -= boosts.catalogPriority / 2;
      reasons.push("installation_catalog_penalty");
    }
  }

  if (intents.catalog) {
    if (chunk.docType === "catalog") {
      total += boosts.catalogPriority;
      reasons.push("catalog_priority");
    } else if (chunk.docType === "instruction") {
      total -= boosts.catalogPriority / 2;
      reasons.push("catalog_instruction_penalty");
    }
  }

  const overlapTokens = new Set<string>();
  queryTokens.forEach((token) => {
    if (chunk.termFrequency?.has(token)) {
      overlapTokens.add(token);
    }
  });

  if (overlapTokens.size > 0 && boosts.termOverlap > 0) {
    const capped =
      boosts.termOverlap * Math.min(overlapTokens.size, 4);
    total += capped;
    reasons.push("term_overlap");
  }

  const radiatorQuery =
    intents.installation &&
    (queryNormalized.includes("радиатор") ||
      queryTokens.some((token) => token.startsWith("радиатор")));

  if (radiatorQuery && boosts.radiatorSectionPriority > 0) {
    const chunkHasRadiator =
      chunk.termFrequency?.has("радиатор") ||
      chunk.content.toLowerCase().includes("радиатор");
    if (chunkHasRadiator) {
      total += boosts.radiatorSectionPriority;
      reasons.push("radiator_keyword");
    }

    const sectionString =
      typeof chunk.metadata?.section === "string"
        ? chunk.metadata.section.toLowerCase()
        : "";
    if (
      (chunk.sectionPath && chunk.sectionPath.startsWith("1.5")) ||
      sectionString.includes("радиатор")
    ) {
      total += boosts.radiatorSectionPriority / 2;
      reasons.push("radiator_section");
    }
  }

  return { totalBoost: total, reasons };
}

async function retrieveAndScoreChunks(
  query: string,
  config: RAGConfig,
  options: RAGOptions | undefined
): Promise<RetrievalResult> {
  const stopwords = createStopwordSet(config.retrieval.stopwords.extra);
  const queryTokens = tokenize(query, stopwords);
  const queryNormalized = normalizeToken(query);
  const skuTokens = extractSkuCandidates(query);
  const intents = {
    installation: hasInstallationIntent(query),
    catalog: hasCatalogIntent(query),
  };

  const { chunks: rawChunks, documentMeta } = await fetchRawChunks(config);
  if (!rawChunks.length) {
    return {
      chunks: [],
      diagnostics: {
        topOriginal: [],
        topAfterMmr: [],
        appliedBoosts: {},
        rerankerApplied: false,
      },
      documentMeta,
    };
  }

  const queryEmbedding = await generateEmbedding(query, config);
  const fallbackDimensions = queryEmbedding.length || 384;

  const { chunkStats, docFrequency, avgDocLength } = prepareRetrieverChunks(
    rawChunks,
    stopwords,
    fallbackDimensions
  );

  const matchesByDoc = await computeProductBoosts(skuTokens);

  const chunksWithScores: ScoredChunk[] = chunkStats.map((chunk) => {
    const bm25 = computeBm25Score(
      queryTokens,
      chunk.termFrequency,
      chunk.termCount,
      avgDocLength,
      docFrequency,
      chunkStats.length
    );

    const embeddingVector =
      chunk.embeddingVector ??
      fallbackEmbedding(chunk.content, fallbackDimensions);

    const embeddingScore = cosineSimilarity(queryEmbedding, embeddingVector);

    const docInfo =
      documentMeta.get(chunk.documentId) ??
        ({
          id: chunk.documentId,
          filename: chunk.filename,
          docType: chunk.docType,
          processingType: chunk.processingType,
        } as DocumentMeta);

    const { totalBoost, reasons } = computeBoosts(
      { ...chunk, embeddingVector },
      queryNormalized,
      queryTokens,
      stopwords,
      docInfo,
      skuTokens,
      matchesByDoc,
      config,
      intents
    );

    const weights = config.retrieval.hybridWeights;
    const hybrid =
      weights.embedding * embeddingScore + weights.bm25 * bm25 + totalBoost;

    return {
      ...chunk,
      embeddingVector,
      bm25Score: bm25,
      embeddingScore,
      boostedScore: totalBoost,
      hybridScore: hybrid,
      relevance: hybrid,
      boostsApplied: reasons,
    };
  });

  let candidateChunks = chunksWithScores;
  const hasVariantPreference = chunksWithScores.some((chunk) =>
    chunk.boostsApplied.includes("variant_match")
  );
  if (hasVariantPreference) {
    const variantOnly = chunksWithScores.filter((chunk) =>
      chunk.boostsApplied.includes("variant_match")
    );
    if (variantOnly.length > 0) {
      candidateChunks = variantOnly;
    }
  }

  const sorted = [...candidateChunks]
    .sort((a, b) => b.relevance - a.relevance)
    .slice(
      0,
      options?.topK ?? config.retrieval.mmr.candidatePoolSize
    );

  const mmrSelected = applyMmr(
    sorted,
    config.retrieval.mmr.lambda,
    config.retrieval.mmr.resultCount
  );

  const diag: RetrievalDiagnostics = {
    topOriginal: sorted.slice(0, 10).map((chunk) => ({
      id: chunk.id,
      relevance: chunk.relevance,
      filename: chunk.filename,
    })),
    topAfterMmr: mmrSelected.slice(0, 10).map((chunk) => ({
      id: chunk.id,
      relevance: chunk.relevance,
      filename: chunk.filename,
    })),
    appliedBoosts: Object.fromEntries(
      mmrSelected.map((chunk) => [
        chunk.id,
        chunk.boostsApplied.slice(),
      ])
    ),
    rerankerApplied: false,
  };

  return {
    chunks: mmrSelected,
    diagnostics: diag,
    documentMeta,
  };
}

function enforceContextCaps(
  chunks: ScoredChunk[],
  documentMeta: Map<number, DocumentMeta>,
  config: RAGConfig
): { limited: ScoredChunk[]; selectedDocs: Map<number, ScoredChunk[]> } {
  const caps = config.retrieval.contextCaps;
  if (!chunks.length) {
    return { limited: [], selectedDocs: new Map() };
  }

  const grouped = new Map<number, ScoredChunk[]>();
  chunks.forEach((chunk) => {
    if (!grouped.has(chunk.documentId)) {
      grouped.set(chunk.documentId, []);
    }
    grouped.get(chunk.documentId)!.push(chunk);
  });

  grouped.forEach((list) =>
    list.sort((a, b) => b.relevance - a.relevance)
  );

  const docAverages = Array.from(grouped.entries()).map(
    ([documentId, list]) => {
      const avg =
        list.reduce((sum, chunk) => sum + chunk.relevance, 0) /
        (list.length || 1);
      return { documentId, avg, list };
    }
  );

  docAverages.sort((a, b) => b.avg - a.avg);

  const selected: ScoredChunk[] = [];
  const selectedPerDoc = new Map<number, ScoredChunk[]>();

  if (!docAverages.length) {
    return { limited: selected, selectedDocs: selectedPerDoc };
  }

  const primaryDoc = docAverages[0];
  const primaryLimit = Math.min(
    caps.maxChunksPerDoc,
    Math.max(1, Math.round(caps.maxChunks * 0.8))
  );

  const secondaryLimit = Math.max(
    1,
    caps.maxChunks - primaryLimit
  );

  const addChunks = (
    list: ScoredChunk[],
    limit: number,
    docId: number
  ) => {
    if (!limit) return;
    const toAdd = list.slice(0, limit);
    toAdd.forEach((chunk) => {
      if (selected.length < caps.maxChunks) {
        selected.push(chunk);
        if (!selectedPerDoc.has(docId)) {
          selectedPerDoc.set(docId, []);
        }
        selectedPerDoc.get(docId)!.push(chunk);
      }
    });
  };

  addChunks(primaryDoc.list, primaryLimit, primaryDoc.documentId);

  for (let i = 1; i < docAverages.length; i += 1) {
    const doc = docAverages[i];
    if (selected.length >= caps.maxChunks) break;

    const limit = Math.min(caps.maxChunksPerDoc, secondaryLimit);
    const difference = Math.abs(primaryDoc.avg - doc.avg);
    if (difference <= 0.15) {
      addChunks(doc.list, limit, doc.documentId);
    }
  }

  return { limited: selected, selectedDocs: selectedPerDoc };
}
async function expandCatalogChunksWithNeighbors(
  chunks: ScoredChunk[],
  documentMeta: Map<number, DocumentMeta>
): Promise<ScoredChunk[]> {
  if (!chunks.length) return chunks;

  const augmented = [...chunks];
  const seen = new Set(chunks.map((chunk) => `${chunk.documentId}:${chunk.chunkIndex}`));

  for (const chunk of chunks) {
    const meta = documentMeta.get(chunk.documentId);
    if (!meta || meta.docType !== "catalog") {
      continue;
    }

    if (chunk.sectionPath) {
      const sectionChunks = await getSectionChunks(chunk.documentId, chunk.sectionPath);
      if (sectionChunks.length > 1) {
        const sorted = sectionChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
        const basePos = sorted.findIndex((info) => info.chunkIndex === chunk.chunkIndex);
        const includeRange = 2;
        for (
          let i = Math.max(0, basePos - includeRange);
          i <= Math.min(sorted.length - 1, basePos + includeRange);
          i += 1
        ) {
          const info = sorted[i];
          if (info.chunkIndex === chunk.chunkIndex) continue;
          if (!shouldIncludeNeighbor(chunk, info)) continue;
          const cacheKey = `${chunk.documentId}:${info.chunkIndex}`;
          if (seen.has(cacheKey)) continue;
          seen.add(cacheKey);
          augmented.push(buildNeighborChunk(chunk, info, true));
        }
        continue;
      }
    }

    const prev = await fetchNeighborChunk(chunk, -1);
    if (prev?.info && prev.shouldInclude) {
      const prevKey = `${chunk.documentId}:${prev.info.chunkIndex}`;
      if (!seen.has(prevKey)) {
        seen.add(prevKey);
        augmented.push(buildNeighborChunk(chunk, prev.info));
      }
    }

    const next = await fetchNeighborChunk(chunk, 1);
    if (next?.info && next.shouldInclude) {
      const nextKey = `${chunk.documentId}:${next.info.chunkIndex}`;
      if (!seen.has(nextKey)) {
        seen.add(nextKey);
        augmented.push(buildNeighborChunk(chunk, next.info));
      }
    }
  }

  return augmented;
}

async function fetchNeighborChunk(
  source: ScoredChunk,
  offset: number
): Promise<{ info: documentDb.ChunkBaseInfo; shouldInclude: boolean } | null> {
  const neighborIndex = source.chunkIndex + offset;
  if (neighborIndex < 0) return null;
  try {
    const info = await documentDb.getChunkBaseInfo(
      source.documentId,
      neighborIndex
    );
    if (!info) return null;
    const shouldInclude = shouldIncludeNeighbor(source, info);
    return { info, shouldInclude };
  } catch (error) {
    console.warn(
      `[RAG] Failed to fetch neighbor chunk ${source.documentId}#${neighborIndex}:`,
      error
    );
    return null;
  }
}

function buildNeighborChunk(
  source: ScoredChunk,
  neighbor: documentDb.ChunkBaseInfo,
  bridge = false
): ScoredChunk {
  const multiplier = bridge ? 0.6 : 0.75;
  let mergedMetadata: Record<string, any> | null = null;
  if (source.metadata || neighbor.metadata || neighbor.tableJson) {
    mergedMetadata = {
      ...(source.metadata ?? {}),
      ...(neighbor.metadata ?? {}),
    };
    if (
      neighbor.tableJson &&
      (!mergedMetadata.tableJson || mergedMetadata.tableJson.length === 0)
    ) {
      mergedMetadata.tableJson = neighbor.tableJson;
    }
  }
  return {
    ...source,
    id: neighbor.id,
    chunkIndex: neighbor.chunkIndex,
    content: neighbor.content,
    pageNumber: neighbor.pageNumber,
    sectionPath: neighbor.sectionPath ?? source.sectionPath,
    metadata: mergedMetadata ?? source.metadata,
    boostsApplied: Array.from(
      new Set([...source.boostsApplied, bridge ? "neighbor_bridge" : "neighbor_chunk"])
    ),
    bm25Score: source.bm25Score * multiplier,
    embeddingScore: source.embeddingScore * multiplier,
    boostedScore: source.boostedScore * multiplier,
    hybridScore: source.hybridScore * multiplier,
    relevance: source.relevance * multiplier,
  };
}

function shouldIncludeNeighbor(
  source: ScoredChunk,
  neighbor: documentDb.ChunkBaseInfo
): boolean {
  const sourceVariant = getVariantKeyFromChunk(source);
  const neighborVariant = getVariantKey(neighbor.metadata, neighbor.sectionPath);

  if (
    sourceVariant &&
    neighborVariant &&
    sourceVariant.length > 0 &&
    neighborVariant.length > 0 &&
    sourceVariant !== neighborVariant
  ) {
    return false;
  }

  if (
    source.sectionPath &&
    neighbor.sectionPath &&
    source.sectionPath !== neighbor.sectionPath &&
    !(sourceVariant && neighborVariant && sourceVariant === neighborVariant)
  ) {
    return false;
  }

  return true;
}

async function getSectionChunks(documentId: number, sectionPath: string) {
  const cacheKey = `${documentId}:${sectionPath}`;
  if (sectionChunksCache.has(cacheKey)) {
    return sectionChunksCache.get(cacheKey)!;
  }
  let pending = sectionFetchLocks.get(cacheKey);
  if (!pending) {
    pending = documentDb.getChunksInSection(documentId, sectionPath);
    sectionFetchLocks.set(cacheKey, pending);
  }
  const result = await pending;
  sectionChunksCache.set(cacheKey, result);
  sectionFetchLocks.delete(cacheKey);
  return result;
}

function getVariantKey(
  metadata: Record<string, any> | null | undefined,
  sectionPath?: string | null
): string | null {
  const candidates: Array<string | undefined | null> = [
    metadata?.productVariantNormalized,
    metadata?.variantNormalized,
    metadata?.productVariantName,
    metadata?.variantName,
    metadata?.section,
    sectionPath,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return normalizeVariant(candidate);
    }
  }

  return null;
}

function normalizeVariant(value: string): string {
  return value
    .toLowerCase()
    .replace(/[«»"'`]/g, " ")
    .replace(/[^a-z0-9а-яё\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getVariantKeyFromChunk(chunk: ScoredChunk): string | null {
  return getVariantKey(chunk.metadata, chunk.sectionPath);
}

interface TableRenderSection {
  label?: string;
  markdown: string;
  headerLine: string;
  introLine: string;
}

type RawAnswerOptions = {
  allowTables?: boolean;
};

function sanitizeTableLabel(label?: string | null): string | undefined {
  if (!label) return undefined;
  const trimmed = label.trim().replace(/[:.：]+$/, "");
  if (!trimmed) return undefined;
  return trimmed;
}

function inferTableLabel(columns: string[]): string | undefined {
  const lowerColumns = columns.map((col) => col.toLowerCase());
  if (lowerColumns.some((col) => col.includes("артикул"))) {
    return "Номенклатура";
  }
  if (lowerColumns.some((col) => col.includes("характерист"))) {
    return "Технические характеристики";
  }
  if (lowerColumns.some((col) => col.includes("размер"))) {
    return "Размеры";
  }
  return undefined;
}

function tableRowsToMarkdown(
  rows: Array<Record<string, any>>,
  preferredLabel?: string | null
): TableRenderSection | null {
  if (!rows.length) return null;
  const columns: string[] = [];
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (key && !columns.includes(key)) {
        columns.push(key);
      }
    });
  });
  if (!columns.length) return null;
  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => {
    const cells = columns.map((col) => {
      const value = row?.[col];
      if (value === null || value === undefined) return "";
      return String(value).replace(/\|/g, "\\|").trim();
    });
    return `| ${cells.join(" | ")} |`;
  });

  const label =
    sanitizeTableLabel(preferredLabel) ?? inferTableLabel(columns) ?? undefined;
  const introLine = label
    ? `${label} (таблица)`
    : "[Таблица технических характеристик]";

  return {
    label,
    markdown: [header, divider, ...body].join("\n"),
    headerLine: header,
    introLine,
  };
}

function detectTableHeading(rawContent?: string | null): string | null {
  if (!rawContent) return null;
  const lines = rawContent.split("\n").map((line) => line.trim());
  let inspected = 0;
  for (let i = lines.length - 1; i >= 0 && inspected < 8; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    inspected += 1;
    if (/таблиц|номенклатур|размер|характеристик/i.test(line)) {
      return line;
    }
    if (line.endsWith(":") && line.length <= 80) {
      return line;
    }
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function insertTableIntoContent(
  content: string,
  tableSection: TableRenderSection
): string {
  if (!content) {
    return `${tableSection.introLine}\n${tableSection.markdown}`.trim();
  }
  const label = tableSection.label;
  if (label) {
    const pattern = new RegExp(`(${escapeRegExp(label)}\\s*:?)`, "i");
    const match = content.match(pattern);
    if (match) {
      const insertPosition = content.indexOf(match[0]) + match[0].length;
      const before = content.slice(0, insertPosition).replace(/\s+$/, "");
      const after = content.slice(insertPosition).replace(/^\s+/, "");
      return `${before}\n\n${tableSection.markdown}\n${after}`.trim();
    }
  }

  return `${content.trim()}\n\n${tableSection.introLine}\n${tableSection.markdown}`.trim();
}

function normalizeAnswerSpacing(text: string): string {
  if (!text) return text;
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripMarkdownTables(text: string): string {
  if (!text) return text;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const result: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    // Remove common "table intro" lines for passports/certificates raw answers
    if (
      /^\[таблица/i.test(trimmed) ||
      /таблиц/i.test(trimmed) ||
      /техническ.*характерист.*\(таблица\)/i.test(trimmed)
    ) {
      // Keep the line only if it's not a standalone table marker
      // In our chunks it often precedes a markdown table and adds noise.
      i += 1;
      continue;
    }

    // Remove markdown tables (| header | ... then | --- | ...)
    const isPipeRow = trimmed.startsWith("|") && trimmed.includes("|");
    const next = (lines[i + 1] ?? "").trim();
    const nextLooksDivider =
      next.startsWith("|") && /\|\s*---/.test(next);
    if (isPipeRow && nextLooksDivider) {
      // Skip until table ends (non-pipe row)
      i += 2;
      while (i < lines.length) {
        const row = (lines[i] ?? "").trim();
        if (!row.startsWith("|")) break;
        i += 1;
      }
      continue;
    }

    result.push(line);
    i += 1;
  }

  return normalizeAnswerSpacing(result.join("\n"));
}

function formatRawChunkContent(
  source: ContextSourceEntry,
  options?: RawAnswerOptions
): string {
  const allowTables = options?.allowTables !== false;
  const manualContent = formatManualRegionAwareContent(source, { allowTables });
  if (manualContent) {
    return manualContent;
  }

  let content = (source.chunkContent ?? "").replace(/\r\n/g, "\n").trim();
  if (!content) return "";
  if (!allowTables) {
    content = stripMarkdownTables(content);
  }

  const segments = splitIntoSegments(content);
  const formatted: string[] = [];

  const preferTable = allowTables ? inferTablePreference(source) : false;
  const preferList = inferListPreference(source);

  segments.forEach((segment) => {
    const trimmed = segment.trim();
    if (!trimmed) return;

    const table = allowTables
      convertWhitespaceTableSegment(trimmed, preferTable) ||
      convertKeyValueSegment(trimmed, preferTable);
    if (table) {
      formatted.push(table);
      return;
    }

    const list = convertBulletSegment(trimmed, preferList);
    if (list) {
      formatted.push(list);
      return;
    }

    formatted.push(formatParagraphSegment(trimmed));
  });

  return formatted.join("\n\n").trim();
}

function buildRawAnswerFromSources(
  sources: ContextSourceEntry[],
  options?: RawAnswerOptions
): string | null {
  const allowTables = options?.allowTables !== false;
  const formattedText = sources
    .map((source) => formatRawChunkContent(source, { allowTables }))
    .filter((text) => text.length > 0);

  if (!formattedText.length) {
    return null;
  }

  if (!allowTables) {
    return normalizeAnswerSpacing(formattedText.join("\n\n"));
  }

  const tableBlocks: string[] = [];
  const seenTables = new Set<string>();

  sources.forEach((source) => {
    source.tables?.forEach((table, idx) => {
      const key = `${table.headerLine}|${table.markdown}`;
      if (seenTables.has(key)) return;
      seenTables.add(key);

      const intro =
        table.introLine ??
        table.label ??
        `Таблица #${idx + 1}`;
      tableBlocks.push(
        `${intro ? `**${intro}**\n` : ""}${table.markdown}`.trim()
      );
    });
  });

  const combined = [
    ...formattedText,
    ...tableBlocks.filter((block) => block.length > 0),
  ].join("\n\n");

  return normalizeAnswerSpacing(combined);
}

function mapSourcesForResponse(
  entries: ContextSourceEntry[],
  limit?: number
) {
  const list =
    typeof limit === "number" ? entries.slice(0, limit) : entries;

  const mappedSources = list.map((source) => ({
    documentId: source.documentId,
    filename: source.filename,
    chunkIndex: source.chunkIndex,
    relevance: source.relevance,
    pageNumber: source.pageStart ?? undefined,
    sectionPath: source.sectionPath,
    chunkContent: source.chunkContent,
  }));

  const mappedChunks = list.map((source) => ({
    documentId: source.documentId,
    chunkIndex: source.chunkIndex,
    sectionPath: source.sectionPath ?? "не указан",
    pageNumber: source.pageStart ?? 0,
    elementType: source.elementType ?? "text",
    filename: source.filename,
    relevance: source.relevance,
    hasTable:
      source.chunkContent?.includes("[Таблица технических характеристик]") ??
      false,
    chunkContent: source.chunkContent,
  }));

  return { sources: mappedSources, chunks: mappedChunks };
}

function splitIntoSegments(content: string): string[] {
  return content.split(/\n\s*\n/g);
}

function ensureUniqueHeaders(headers: string[]): string[] {
  const counts = new Map<string, number>();
  return headers.map((header) => {
    const key = header || "Колонка";
    const current = counts.get(key) ?? 0;
    counts.set(key, current + 1);
    if (current === 0) {
      return key;
    }
    return `${key} ${current + 1}`;
  });
}

function convertWhitespaceTableSegment(
  segment: string,
  force: boolean
): string | null {
  const lines = segment.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const counts = lines.map((line) => countColumns(line));
  const maxColumns = Math.max(...counts);
  if (maxColumns < 2) return null;

  const linesWithColumns = counts.filter((count) => count >= 2).length;
  if (!force && linesWithColumns < Math.max(3, Math.floor(lines.length * 0.75))) {
    return null;
  }

  const isKeyValue =
    maxColumns === 2 &&
    lines.every((line) => !!line.match(/^([^:–—\-]+?)\s*[:–—-]\s*(.+)$/));

  const headerCells = isKeyValue
    ? ["Параметр", "Значение"]
    : splitLineIntoColumns(lines[0], maxColumns);
  if (!headerCells.length) return null;
  const uniqueHeader = ensureUniqueHeaders(headerCells.map((cell) => cell || "Колонка"));
  const header = `| ${uniqueHeader.join(" | ")} |`;
  const divider = `| ${uniqueHeader.map(() => "---").join(" | ")} |`;

  const body = lines.slice(isKeyValue ? 0 : 1).map((line) => {
    const cells = isKeyValue
      ? splitKeyValueLine(line)
      : splitLineIntoColumns(line, maxColumns);
    return `| ${cells.join(" | ")} |`;
  });

  return [header, divider, ...body].join("\n");
}

function countColumns(line: string): number {
  return line.split(/\s{2,}|\t+/).filter((cell) => cell.trim().length > 0).length;
}

function splitLineIntoColumns(line: string, expected: number): string[] {
  const parts = line.split(/\s{2,}|\t+/).map((cell) => cell.trim()).filter(Boolean);
  if (!parts.length) return [];
  const cells = parts.slice(0, expected);
  if (parts.length > expected) {
    const tail = parts.slice(expected - 1).join(" ").trim();
    cells[expected - 1] = cells[expected - 1]
      ? `${cells[expected - 1]} ${tail}`.trim()
      : tail;
  }
  while (cells.length < expected) {
    cells.push("");
  }
  return cells;
}

function splitKeyValueLine(line: string): string[] {
  const match = line.match(/^([^:–—\-]+?)\s*[:–—-]\s*(.+)$/);
  if (match) {
    return [match[1].trim(), match[2].trim()];
  }
  return [line.trim(), ""];
}

function convertKeyValueSegment(
  segment: string,
  force: boolean
): string | null {
  const lines = segment.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return null;

  const pairs = lines
    .map((line) => {
      const match = line.match(/^([^:–—\-]+?)\s*[:–—-]\s*(.+)$/);
      if (!match) return null;
      return { key: match[1].trim(), value: match[2].trim() };
    })
    .filter((pair): pair is { key: string; value: string } => Boolean(pair));

  if (pairs.length < 3) {
    return null;
  }

  if (!force) {
    const numericRatio =
      pairs.filter((pair) => /[\d%°]/.test(pair.value)).length / pairs.length;
    const avgKeyLength =
      pairs.reduce((sum, pair) => sum + pair.key.length, 0) / pairs.length;
    const avgValueLength =
      pairs.reduce((sum, pair) => sum + pair.value.length, 0) / pairs.length;
    if (numericRatio < 0.4) return null;
    if (avgKeyLength > 35) return null;
    if (avgValueLength > 90) return null;
  }

  const header = "| Параметр | Значение |";
  const divider = "| --- | --- |";
  const rows = pairs.map((pair) => `| ${pair.key} | ${pair.value} |`);
  return [header, divider, ...rows].join("\n");
}

function convertBulletSegment(
  segment: string,
  force: boolean
): string | null {
  const lines = segment.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;

  const bulletLines = lines.filter((line) => isBulletLine(line)).length;
  // Many PDF extracts wrap list items across multiple lines; accept looser ratios.
  const enoughBullets =
    bulletLines >= 2 &&
    (bulletLines >= Math.floor(lines.length * 0.3) || bulletLines >= 4);
  if (!force && !enoughBullets) {
    return null;
  }

  const items: Array<{ marker: string; text: string }> = [];
  let current: { marker: string; text: string } | null = null;

  for (const rawLine of lines) {
    if (isBulletLine(rawLine)) {
      if (current) {
        items.push({ marker: current.marker, text: current.text.trim() });
      }
      const match = rawLine.match(
        /^\s*(\d+[\.\)]|[\-\*\•●◦○■▪□◼◻◆♦◾]+)\s+(.*)$/
      );
      const marker = match?.[1] ?? "-";
      const text = (
        match?.[2] ??
        rawLine.replace(/^[\-\*\•●◦○■▪□◼◻◆♦◾\d\.\)\(]+/, "")
      ).trim();
      current = { marker, text };
      continue;
    }

    // Continuation line: attach to previous item if we are in a list.
    if (current) {
      current.text = `${current.text} ${rawLine}`.replace(/\s+/g, " ").trim();
    } else {
      // No current bullet yet; keep as-is (will be included as an item).
      current = { marker: "-", text: rawLine.trim() };
    }
  }

  if (current) {
    items.push({ marker: current.marker, text: current.text.trim() });
  }

  const normalized = items
    .map((item) => ({
      marker: item.marker,
      text: item.text.replace(/\s+/g, " ").trim(),
    }))
    .filter((item) => item.text.length > 0)
    .map((item) => {
      const isNumbered = /^\d+[\.\)]$/.test(item.marker);
      if (isNumbered) {
        // Keep numbering, normalize to "N."
        const normalizedMarker = item.marker.endsWith(")") ? `${item.marker.slice(0, -1)}.` : item.marker;
        return `${normalizedMarker} ${item.text}`;
      }
      return `- ${item.text}`;
    });

  return normalized.join("\n");
}

function isBulletLine(line: string): boolean {
  // Include common PDF bullet glyphs (private use symbols like //)
  return /^[\s]*([\-\*\•●◦○■▪□◼◻◆♦◾]+|\d+\.|\d+\))\s+/.test(line);
}

function formatParagraphSegment(segment: string): string {
  let text = segment;
  text = text.replace(/([A-Za-zА-Яа-яЁё0-9])-\n([A-Za-zА-Яа-яЁё0-9])/g, "$1$2");

  // If it looks like a list/steps — keep it as list for readability.
  if (looksLikeList(text)) {
    const list = convertBulletSegment(text, true);
    if (list) {
      return list.trim();
    }
  }

  const lines = text
    .split(/\n+/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  if (!lines.length) return "";

  const avgLen =
    lines.reduce((sum, line) => sum + line.length, 0) / (lines.length || 1);

  // If text is already line-broken into reasonably short lines (common for PDF),
  // preserve line breaks instead of turning everything into one long paragraph.
  const preserveLineBreaks = lines.length >= 4 && avgLen <= 90;
  if (preserveLineBreaks) {
    return lines.join("\n").trim();
  }

  return lines.join(" ").trim();
}

function inferTablePreference(source: ContextSourceEntry): boolean {
  if ((source.tables?.length ?? 0) > 0) return true;
  const elementType = source.elementType?.toLowerCase();
  if (elementType === "table") return true;
  const title = `${source.sectionTitle ?? ""} ${source.sectionPath ?? ""}`.toLowerCase();
  if (/таблиц|номенклат|характерист|размер/.test(title)) return true;
  return false;
}

function inferListPreference(source: ContextSourceEntry): boolean {
  const elementType = source.elementType?.toLowerCase();
  if (elementType === "list") return true;
  const title = `${source.sectionTitle ?? ""} ${source.sectionPath ?? ""}`.toLowerCase();
  if (/преимуществ|особенност|услов|требован/.test(title)) return true;
  return false;
}

function formatManualRegionAwareContent(
  source: ContextSourceEntry,
  options?: RawAnswerOptions
): string | null {
  const allowTables = options?.allowTables !== false;
  const metadata = source.metadata as Record<string, any> | undefined;
  if (
    !metadata?.isManualRegion ||
    !Array.isArray(metadata.regions) ||
    metadata.regions.length === 0
  ) {
    return null;
  }

  const sorted = [...metadata.regions].sort((a, b) => {
    const pageDiff = (a.pageNumber ?? 0) - (b.pageNumber ?? 0);
    if (pageDiff !== 0) return pageDiff;
    return (a.regionId ?? 0) - (b.regionId ?? 0);
  });

  const blocks = sorted
    .map((region) =>
      formatManualRegionBlock(region, metadata, source, { allowTables })
    )
    .filter((block): block is string => Boolean(block));

  if (!blocks.length) {
    return null;
  }

  return blocks.join("\n\n").trim();
}

function formatManualRegionBlock(
  region: Record<string, any>,
  metadata: Record<string, any>,
  source: ContextSourceEntry,
  options?: RawAnswerOptions
): string | null {
  const allowTables = options?.allowTables !== false;
  const text =
    typeof region.text === "string" ? region.text.trim() : "";
  const type = String(region.type ?? "").toLowerCase();
  const label =
    region.notes ||
    metadata.subsection ||
    metadata.section ||
    metadata.title ||
    source.sectionTitle ||
    source.sectionPath ||
    source.filename;

  const tableData =
    Array.isArray(region.tableJson) && region.tableJson.length
      ? region.tableJson
      : undefined;
  const tableStructure =
    normalizeRegionTableStructure(
      region.tableStructure || region.table_structure
    ) || null;
  const tableTitle =
    region.tableTitle ||
    region.table_title ||
    region.notes ||
    metadata?.title ||
    label;

  const prefersTable =
    type.includes("table") ||
    region.isNomenclatureTable ||
    Boolean(tableData) ||
    Boolean(tableStructure);
  const prefersList = type.includes("list");

  if (prefersTable && allowTables) {
    if (tableStructure) {
      const heading = tableTitle ? `**${tableTitle}**\n` : "";
      return `${heading}${renderRegionTableStructure(tableStructure)}`.trim();
    }
    if (tableData) {
      const tableSection = tableRowsToMarkdown(tableData, label);
      if (tableSection) {
        const heading = tableSection.introLine
          ? `**${tableSection.introLine}**\n`
          : "";
        return `${heading}${tableSection.markdown}`.trim();
      }
    }
    const fromText =
      convertWhitespaceTableSegment(text, true) ||
      convertKeyValueSegment(text, true);
    if (fromText) {
      return fromText;
    }
  }

  if (prefersList || looksLikeList(text)) {
    const list = convertBulletSegment(text, true);
    if (list) {
      return list;
    }
  }

  if (!text) {
    return null;
  }

  return formatParagraphSegment(text);
}

function queryWantsTables(query: string): boolean {
  const q = query.toLowerCase();
  return /таблиц|таблица|размер|диаметр|толщин|характерист|давлен|температур|номенклатур/.test(
    q
  );
}

function isObviousSingleChunkAnswer(
  chunks: ScoredChunk[],
  config: RAGConfig
): boolean {
  if (!chunks.length) return false;
  const top = chunks[0];
  const second = chunks[1];
  if (top.relevance < config.retrieval.answerThreshold) return false;
  if (!second) return true;
  const gap = top.relevance - second.relevance;
  return gap >= 0.12;
}

function extractFaqAnswer(content: string): string | null {
  const idx = content.toLowerCase().indexOf("\n\nответ:");
  if (idx === -1) return null;
  const answer = content.slice(idx).replace(/^\s*\n*\s*ответ:\s*/i, "").trim();
  return answer.length > 0 ? answer : null;
}

function looksLikeList(text: string): boolean {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  const bulletLines = lines.filter((line) => isBulletLine(line)).length;
  return bulletLines >= Math.max(2, Math.floor(lines.length * 0.6));
}

function convertInlineWhitespaceTables(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let block: string[] = [];

  const flushBlock = () => {
    if (block.length >= 2 && block.some(isTableLikeLine)) {
      const table = buildMarkdownTableFromBlock(block);
      if (table) {
        result.push(table);
        block = [];
        return;
      }
    }
    result.push(...block);
    block = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    if (isTableLikeLine(line)) {
      block.push(line.trim());
    } else {
      if (block.length) {
        flushBlock();
      }
      result.push(line);
    }
  });

  if (block.length) {
    flushBlock();
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isTableLikeLine(line: string): boolean {
  if (!line || !/\S/.test(line)) return false;
  return /\s{2,}/.test(line.replace(/\t/g, "    "));
}

function buildMarkdownTableFromBlock(block: string[]): string | null {
  if (!block.length) return null;
  const headerCells = splitTableLine(block[0]);
  if (headerCells.length < 2) {
    return null;
  }

  const rows = block
    .slice(1)
    .map((line) => splitTableLine(line))
    .filter((row) => row.some((cell) => cell.length > 0));

  if (!rows.length) {
    return null;
  }

  const normalizedRows = rows.map((row) => {
    const cells = row.slice(0, headerCells.length);
    while (cells.length < headerCells.length) {
      cells.push("");
    }
    return cells;
  });

  const header = `| ${headerCells.join(" | ")} |`;
  const divider = `| ${headerCells.map(() => "---").join(" | ")} |`;
  const body = normalizedRows.map(
    (row) => `| ${row.join(" | ")} |`
  );

  return [header, divider, ...body].join("\n");
}

function splitTableLine(line: string): string[] {
  return line
    .trim()
    .split(/\s{2,}|\t+/)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

interface RegionTableStructure {
  headers: string[];
  rows: string[][];
}

function normalizeRegionTableStructure(raw: any): RegionTableStructure | null {
  if (!raw || !Array.isArray(raw.headers) || !Array.isArray(raw.rows)) {
    return null;
  }

  const headers = raw.headers
    .map((header: unknown) =>
      typeof header === "string" ? header.trim() : ""
    )
    .filter((_: string, idx: number) => idx >= 0);

  const rows = raw.rows
    .filter((row: unknown) => Array.isArray(row))
    .map((row: string[]) => row.map((cell) => (cell ?? "").trim()));

  if (!headers.length || !rows.length) {
    return null;
  }

  return { headers, rows };
}

function renderRegionTableStructure(structure: RegionTableStructure): string {
  const headers =
    structure.headers.length > 0
      ? structure.headers
      : structure.rows[0]
      ? structure.rows[0].map((_, idx) => `Колонка ${idx + 1}`)
      : [];

  const width = headers.length;
  const normalizedRows = structure.rows.map((row) => {
    const arr = row.map((cell) => cell?.trim() ?? "");
    while (arr.length < width) {
      arr.push("");
    }
    return arr;
  });

  const headerLine = `| ${headers.map((h) => h || " ").join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = normalizedRows.map(
    (row) => `| ${row.map((cell) => cell || " ").join(" | ")} |`
  );

  return [headerLine, divider, ...body].join("\n");
}

function shouldReturnRawAnswer(
  sources: ContextSourceEntry[],
  variantFilterKeys: Set<string>
): boolean {
  if (!sources.length) return false;
  const catalogOnly = sources.every(
    (source) => source.documentType === "catalog"
  );
  if (!catalogOnly) return false;
  if (sources.length > 2) return false;
  const singleSection =
    new Set(
      sources
        .map((source) => source.sectionPath ?? "")
        .filter((section) => section.length > 0)
    ).size <= 1;
  if (!singleSection) return false;
  if (!variantFilterKeys.size) return false;
  const hasContent = sources.every(
    (source) => source.chunkContent && source.chunkContent.trim().length > 0
  );
  return hasContent;
}

async function resolveTableData(
  chunk: ScoredChunk,
  sectionPath?: string | null
): Promise<Array<Record<string, any>> | null> {
  const metadata = chunk.metadata ?? {};
  const direct = metadata?.tableJson || (chunk as any)?.tableJson;
  if (direct && Array.isArray(direct) && direct.length > 0) {
    return direct;
  }

  const normalizedSection =
    sectionPath ||
    metadata.sectionPath ||
    chunk.sectionPath ||
    (metadata.section as string | undefined) ||
    null;

  if (normalizedSection) {
    try {
      const sectionChunks = await getSectionChunks(
        chunk.documentId,
        normalizedSection
      );
      const tableChunk = sectionChunks.find(
        (info) => info.tableJson && info.tableJson.length > 0
      );
      if (tableChunk?.tableJson?.length) {
        return tableChunk.tableJson;
      }
    } catch (error) {
      console.warn(
        `[RAG] Failed to fetch section tables for ${chunk.documentId}:${normalizedSection}`,
        error
      );
    }
  }

  const neighborOffsets = [1, -1, 2, -2];
  for (const offset of neighborOffsets) {
    const neighborIndex = chunk.chunkIndex + offset;
    if (neighborIndex < 0) continue;
    try {
      const neighbor = await documentDb.getChunkBaseInfo(
        chunk.documentId,
        neighborIndex
      );
      if (neighbor?.tableJson && neighbor.tableJson.length > 0) {
        return neighbor.tableJson;
      }
    } catch (error) {
      console.warn(
        `[RAG] Failed to fetch neighbor chunk for table ${chunk.documentId}#${neighborIndex}:`,
        error
      );
    }
  }

  return null;
}

function formatTableHeading(
  source: ContextSourceEntry,
  table: ContextTableEntry,
  index: number
): string {
  const parts: string[] = [];
  if (table.label) {
    parts.push(table.label);
  } else {
    parts.push(`Табличные данные #${index + 1}`);
  }
  parts.push(source.filename);
  if (source.sectionPath) {
    parts.push(`раздел ${source.sectionPath}`);
  }
  return parts.join(" — ");
}

function ensureTablesInResponse(
  response: string,
  sources: ContextSourceEntry[]
): string {
  if (!response) {
    response = "";
  }
  const additions: string[] = [];
  sources.forEach((source) => {
    source.tables?.forEach((table, index) => {
      if (!table.markdown) {
        return;
      }
      const headerLine = table.headerLine || table.markdown.split("\n")[0];
      if (headerLine && response.includes(headerLine)) {
        return;
      }
      if (response.includes(table.markdown.trim())) {
        return;
      }
      const heading = formatTableHeading(source, table, index);
      additions.push(
        `${heading ? `**${heading}**\n` : ""}${table.markdown}`.trim()
      );
    });
  });

  if (!additions.length) {
    return response;
  }

  return `${response.trim()}\n\n${additions.join("\n\n")}`.trim();
}

function applyVariantFilter(chunks: ScoredChunk[]): ScoredChunk[] {
  const variantKeys = new Set<string>();
  chunks.forEach((chunk) => {
    if (chunk.boostsApplied.includes("variant_match")) {
      const key = getVariantKeyFromChunk(chunk);
      if (key) {
        variantKeys.add(key);
      }
    }
  });

  if (!variantKeys.size) {
    return chunks;
  }

  const filtered = chunks.filter((chunk) => {
    const key = getVariantKeyFromChunk(chunk);
    return key && variantKeys.has(key);
  });

  return filtered.length > 0 ? filtered : chunks;
}


async function handleMetaQuery(query: string): Promise<string | null> {
  const lower = query.toLowerCase();
  const metaPatterns = [
    "какие документы",
    "список документов",
    "что есть в базе",
    "какие файлы",
    "покажи документы",
    "что загружено",
    "документы в базе",
  ];
  const countPatterns = [
    "сколько документов",
    "сколько файлов",
    "how many documents",
    "how many files",
  ];

  const isMeta = metaPatterns.some((pattern) =>
    lower.includes(pattern)
  );
  const isCount =
    countPatterns.some((pattern) => lower.includes(pattern)) ||
    /\b(сколько|how many)\b.*\b(документ|файл|materials?|items?)\b/.test(
      lower
    );

  if (!isMeta && !isCount) {
    return null;
  }

  const db = await getDb();
  if (!db) return null;

  const docs = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      status: documents.status,
    })
    .from(documents)
    .where(eq(documents.status, "indexed"))
    .orderBy(desc(documents.uploadedAt));

  if (!docs.length) {
    return "В базе знаний пока нет документов. Загрузите материалы через раздел «Documents».";
  }

  if (isCount && !isMeta) {
    const plural =
      docs.length === 1
        ? "документ"
        : docs.length < 5
        ? "документа"
        : "документов";
    return `В базе знаний находится ${docs.length} ${plural}. Задайте вопрос по содержимому — приведу выдержки из соответствующих файлов.`;
  }

  const lines = docs.map(
    (doc, index) => `${index + 1}. ${doc.filename}`
  );
  return `В базе знаний проиндексировано ${docs.length} материалов:\n\n${lines.join(
    "\n"
  )}\n\nЗадайте вопрос по содержимому этих документов.`;
}

async function generateClarifyingResponse(
  query: string
): Promise<string> {
  const db = await getDb();
  if (!db) {
    return `В документах нет информации о: ${query}`;
  }

  const docs = await db
    .select({
      filename: documents.filename,
      docType: documents.docType,
    })
    .from(documents)
    .where(eq(documents.status, "indexed"))
    .orderBy(documents.filename);

  if (!docs.length) {
    return "В базе знаний пока нет документов. Загрузите материалы SANEXT, чтобы я смог помочь.";
  }

  const exampleDoc =
    docs.find((doc) => doc.docType === "instruction") ??
    docs[0];

  return `В документах нет информации о: ${query}.

Для уточнения ответа укажите, пожалуйста:
• Модель или артикул изделия
• Раздел (например, монтаж, эксплуатация, характеристики)
• Диаметр/тип системы, если речь о трубах или фитингах

Доступные материалы включают, например, «${exampleDoc.filename}».`;
}

async function fetchActiveSystemPrompt(): Promise<string> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db
    .select({
      prompt: systemPrompts.prompt,
    })
    .from(systemPrompts)
    .where(eq(systemPrompts.isActive, true))
    .orderBy(desc(systemPrompts.createdAt))
    .limit(1);

  if (!result.length) {
    return "You are a helpful AI assistant. Answer questions based on the provided context.";
  }

  return result[0].prompt;
}

function composeSystemPrompt(template: string, activePrompt: string): string {
  return `${activePrompt}\n\n${template}`.trim();
}

function buildUserMessage(
  context: string,
  query: string
): string {
  return `Задача: ответить на вопрос пользователя только на основе источников ниже. Если сведений нет — так и скажи. 

КРИТИЧЕСКИ ВАЖНО — ЯЗЫК ОТВЕТА:
ОБЯЗАТЕЛЬНО отвечай ТОЛЬКО на русском языке. Использование английского, немецкого или любого другого языка СТРОГО ЗАПРЕЩЕНО. Все ответы, характеристики, описания должны быть строго на русском языке.

КРИТИЧЕСКИ ВАЖНО — РАЗДЕЛЕНИЕ ТОВАРОВ:
1. Если в вопросе пользователя упомянут конкретный продукт (название, артикул, модель), отвечай ТОЛЬКО об этом конкретном продукте.
2. ВНИМАТЕЛЬНО проверяй поле "Товар:" в заголовке каждого источника — используй ТОЛЬКО те источники, где указан тот же товар, что и в вопросе пользователя.
3. НЕ смешивай характеристики разных товаров, даже если они упомянуты в одном разделе документа.
4. Если в источнике указано "Товар: X", а в вопросе спрашивают о товаре Y — НЕ используй этот источник для ответа.
5. Если не уверен, какой товар имеется в виду — уточни или скажи, что информации недостаточно для точного ответа.

КРИТИЧЕСКИ ВАЖНО — ВЫБОР ИСТОЧНИКОВ:
1. Для вопросов о характеристиках, описании, параметрах товара используй ТОЛЬКО источники из каталога (где "Тип: catalog"). НЕ используй другие документы.
2. Для вопросов о монтаже, установке, подключении, сборке оборудования используй ТОЛЬКО источники из «Пособия по монтажу» (где "Тип: instruction"). НЕ используй каталог для монтажных вопросов.
3. В каждом источнике указан его тип в поле "Тип:". Строго следуй правилу выбора источников по типу вопроса.

КРИТИЧЕСКИ ВАЖНО — ПОЛНОТА ИНФОРМАЦИИ:
Для выбранных источников (каталог для характеристик, пособие для монтажа) используй ВСЕ доступные фрагменты о запрашиваемом товаре. Перечисляй ВСЕ характеристики, которые упомянуты в источниках: материал, диаметры, размеры, технические параметры, применение, преимущества и т.д. Не ограничивайся только частью информации — предоставляй полную картину.

ОБЯЗАТЕЛЬНО включай в ответ ВСЕ технические характеристики из таблиц (максимальное давление, рабочее давление, температура, срок службы, диаметры, толщина стенки и т.д.), все преимущества, все особенности применения, все важные примечания.

КРИТИЧЕСКИ ВАЖНО — ИСПОЛЬЗОВАНИЕ ОРИГИНАЛЬНЫХ ФОРМУЛИРОВОК:
1. НЕ перефразируй и НЕ пересказывай информацию из каталога своими словами.
2. Используй ТОЧНО те формулировки, которые указаны в источниках из каталога.
3. Если в источнике написано "Труба SANEXT «Стабил»", используй именно эту формулировку, а не "труба Стабил" или "трубы Стабил".
4. Если в источнике указано "высокая прочность", используй именно "высокая прочность", а не "надежность" или "прочность".
5. Сохраняй оригинальную структуру и порядок информации из каталога.
6. НЕ компонуй информацию из разных источников в один абзац — сохраняй структуру оригинального документа.
7. Если в источнике информация представлена в виде списка — сохраняй формат списка.
8. Если в источнике информация представлена в виде таблицы — перечисляй все строки таблицы с точными значениями.

КРИТИЧЕСКИ ВАЖНО — ТОЧНОСТЬ ТАБЛИЧНЫХ ДАННЫХ:
1. Используй ТОЧНО те значения, которые указаны в таблицах из источников. НЕ изменяй, НЕ округляй, НЕ обобщай числовые значения.
2. Если в таблице указано "Толщина стенки: 2,6 - 4,7 мм", используй именно это значение, а не другие числа.
3. Если указан диапазон значений, указывай именно этот диапазон без изменений.
4. Обязательно включай единицы измерения (мм, бар, °C и т.д.), если они указаны в таблице.
5. НЕ придумывай значения, которых нет в источниках.
6. Если в таблице несколько строк, перечисляй ВСЕ строки точно, как они указаны.

КРИТИЧЕСКИ ВАЖНО — ФОРМАТИРОВАНИЕ ТАБЛИЦ:
1. Если данные из источника представлены таблицей, ОБЯЗАТЕЛЬНО выводи их в ответе в виде Markdown-таблицы. Минимальная структура: «| Характеристика | Значение |» либо используй оригинальные заголовки колонок.
2. Не преобразовывай таблицы в обычный текст или списки — пользователь должен видеть явные границы таблицы и столбцы.
3. Если источник содержит несколько таблиц, выводи каждую отдельной Markdown-таблицей и подпиши, что это за таблица (например, «Технические характеристики», «Номенклатура»).

ОБЯЗАТЕЛЬНО указывай источники в конце ответа в формате: 
«Источник: <название документа>, раздел <номер раздела> (например, 1.3), страница <номер страницы>».

Если использовано несколько источников, перечисли все:
«Источники:
- <название документа>, раздел <номер>, страница <номер>
- <название документа>, раздел <номер>, страница <номер>»

ВАЖНО: В ответе обязательно указывай ссылки на документы с номерами страниц для каждой части информации. Если информация взята из разных страниц — укажи все страницы.

Стиль: структурированно, подробно, по пунктам. Ответ предоставь СТРОГО на русском языке, использование других языков ЗАПРЕЩЕНО.

Источники:
${context}

Вопрос пользователя: ${query}

Ответ (СТРОГО на русском языке):`;
}

function buildDiagnosticsPayload(
  diagnostics: RetrievalDiagnostics,
  selectedDocs: Map<number, ScoredChunk[]>,
  config: RAGConfig,
  rerankerApplied: boolean,
  rerankerModel?: string
) {
  return {
    relevanceThreshold: config.retrieval.relevanceThreshold,
    answerThreshold: config.retrieval.answerThreshold,
    originalTop: diagnostics.topOriginal,
    mmrTop: diagnostics.topAfterMmr,
    selectedDocuments: Array.from(selectedDocs.entries()).map(
      ([documentId, chunks]) => ({
        documentId,
        filename: chunks[0]?.filename ?? "",
        chunkCount: chunks.length,
      })
    ),
    rerankerApplied,
    rerankerModel,
    boostsByChunk: diagnostics.appliedBoosts,
  };
}

export async function processRAGQuery(
  ragQuery: RAGQuery,
  options?: RAGOptions
): Promise<RAGResponse> {
  const start = Date.now();
  const config = getRagConfig();
  const topK = options?.topK ?? config.retrieval.mmr.resultCount;
  const forcedDocType = options?.forceDocumentType;
  const docTypeLabel = (docType: string) => {
    switch (docType) {
      case "catalog":
        return "Товары (каталог)";
      case "instruction":
        return "Инструкции";
      case "certificate":
        return "Сертификаты";
      case "passport":
        return "Паспорта";
      case "warranty_faq":
        return "Гарантия (FAQ)";
      default:
        return "Общие документы";
    }
  };

  const metaResponse = await handleMetaQuery(ragQuery.query);
  if (metaResponse) {
    return {
      response: metaResponse,
      sources: [],
      responseTime: Date.now() - start,
      tokensUsed: Math.ceil(metaResponse.length / TOKEN_CHAR_RATIO),
    };
  }

  const retrieval = await retrieveAndScoreChunks(
    ragQuery.query,
    config,
    options
  );

  const fallbackThreshold =
    config.retrieval.fallbackThreshold ??
    config.retrieval.relevanceThreshold * 0.7;

  let filtered = retrieval.chunks.filter(
    (chunk) =>
      chunk.relevance >= config.retrieval.relevanceThreshold
  );

  if (!filtered.length && retrieval.chunks.length > 0) {
    const fallbackCandidates = retrieval.chunks.filter(
      (chunk) => chunk.relevance >= fallbackThreshold
    );
    if (fallbackCandidates.length > 0) {
      console.warn(
        `[RAG] Relevance fallback triggered for query "${ragQuery.query}". Using ${fallbackCandidates.length} chunk(s) with threshold ${fallbackThreshold.toFixed(
          2
        )}.`
      );
      filtered = fallbackCandidates;
    }
  }

  if (!filtered.length) {
    const clarification = await generateClarifyingResponse(
      ragQuery.query
    );
    return {
      response: clarification,
      sources: [],
      responseTime: Date.now() - start,
      tokensUsed: Math.ceil(clarification.length / TOKEN_CHAR_RATIO),
    };
  }

  // Filter by document type based on query intent
  // For catalog questions (characteristics, description) - use only catalog documents
  // For installation questions - use only instruction documents
  const intents = {
    installation: hasInstallationIntent(ragQuery.query),
    catalog: hasCatalogIntent(ragQuery.query),
  };

  let typeFiltered = filtered;
  if (forcedDocType) {
    typeFiltered = filtered.filter((chunk) => chunk.docType === forcedDocType);
    if (!typeFiltered.length) {
      // Certificates can be scanned PDFs without extractable text (0 chunks).
      // In that case, we still can answer by returning the certificate file
      // and selecting it by title/filename.
      if (forcedDocType === "certificate") {
        const stopwords = createStopwordSet(config.retrieval.stopwords.extra ?? []);
        const hits = await findBestDocumentsByTitle(
          ragQuery.query,
          "certificate",
          stopwords,
          3
        );

        if (hits.length > 0) {
          const top = hits[0];
          const title = top.title?.trim() || top.filename;
          const response =
            hits.length === 1
              ? `Нашёл сертификат: **${title}**.\n\nНиже — файл для просмотра/скачивания.`
              : `Нашёл несколько подходящих сертификатов. Уточните, пожалуйста, какой нужен:\n\n${hits
                  .map((d, idx) => `- ${idx + 1}) ${d.title?.trim() || d.filename}`)
                  .join("\n")}\n\nНиже приложил самые близкие варианты.`;

          return {
            response,
            sources: [],
            attachments: hits.map(buildDocumentAttachment),
            responseTime: Date.now() - start,
            tokensUsed: Math.ceil(response.length / TOKEN_CHAR_RATIO),
          };
        }
      }

      const clarification = `В базе знаний нет документов по теме "${docTypeLabel(
        forcedDocType
      )}", чтобы ответить на ваш вопрос. Попробуйте выбрать другую тематику или загрузить соответствующие документы.`;
      return {
        response: clarification,
        sources: [],
        responseTime: Date.now() - start,
        tokensUsed: Math.ceil(clarification.length / TOKEN_CHAR_RATIO),
      };
    }
  } else if (intents.installation) {
    // For installation questions, use only instruction documents
    typeFiltered = filtered.filter(
      (chunk) => chunk.docType === "instruction"
    );
  } else if (intents.catalog) {
    // For catalog questions (characteristics, description), use only catalog documents
    typeFiltered = filtered.filter(
      (chunk) => chunk.docType === "catalog"
    );
  }
  // If no clear intent, use all documents (fallback)

  if (!typeFiltered.length && (intents.installation || intents.catalog)) {
    // If we filtered by type but got no results, provide helpful message
    const docType = intents.installation ? "instruction" : "catalog";
    const docTypeName = intents.installation ? "Пособие по монтажу" : "каталог";
    const clarification = `В базе знаний нет документов типа "${docTypeName}" для ответа на ваш вопрос. ${intents.installation ? "Загрузите «Пособие по монтажу» для получения информации о монтаже." : "Используйте каталог для вопросов о характеристиках товаров."}`;
    return {
      response: clarification,
      sources: [],
      responseTime: Date.now() - start,
      tokensUsed: Math.ceil(clarification.length / TOKEN_CHAR_RATIO),
    };
  }

  const variantFilterKeys = new Set<string>();
  filtered.forEach((chunk) => {
    if (chunk.boostsApplied.includes("variant_match")) {
      const variantKey = getVariantKeyFromChunk(chunk);
      if (variantKey) {
        variantFilterKeys.add(variantKey);
      }
    }
  });

  let baseChunks = typeFiltered.length > 0 ? typeFiltered : filtered;
  if (variantFilterKeys.size > 0) {
    const variantOnly = baseChunks.filter((chunk) => {
      const key = getVariantKeyFromChunk(chunk);
      return key && variantFilterKeys.has(key);
    });
    if (variantOnly.length > 0) {
      baseChunks = variantOnly;
    }
  }
  const augmentedChunks = await expandCatalogChunksWithNeighbors(
    baseChunks,
    retrieval.documentMeta
  );

  const { limited, selectedDocs } = enforceContextCaps(
    augmentedChunks,
    retrieval.documentMeta,
    config
  );

  const topRelevance = limited[0]?.relevance ?? 0;
  const meetsAnswerThreshold =
    topRelevance >= config.retrieval.answerThreshold;
  const meetsFallbackThreshold = topRelevance >= fallbackThreshold;

  if (!limited.length || (!meetsAnswerThreshold && !meetsFallbackThreshold)) {
    const clarification = await generateClarifyingResponse(
      ragQuery.query
    );
    return {
      response: clarification,
      sources: [],
      responseTime: Date.now() - start,
      tokensUsed: Math.ceil(clarification.length / TOKEN_CHAR_RATIO),
    };
  }

  if (!meetsAnswerThreshold && meetsFallbackThreshold) {
    console.warn(
      `[RAG] Answer threshold fallback used for query "${ragQuery.query}". Top relevance ${topRelevance.toFixed(
        2
      )} below answer threshold ${config.retrieval.answerThreshold.toFixed(
        2
      )}.`
    );
  }

  const rerankConfig = options?.disableReranker
    ? {
        ...config.retrieval,
        reranker: {
          ...config.retrieval.reranker,
          enabled: false,
        },
      }
    : config.retrieval;

  const rerankResult = await rerankChunks(
    ragQuery.query,
    limited.slice(0, topK),
    rerankConfig
  );

  retrieval.diagnostics.rerankerApplied = rerankResult.applied;

  const finalChunks = rerankResult.chunks;

  // Debug logging: log retrieved chunks
  if (config.logging?.enabled) {
    console.log(`[RAG] Retrieved ${finalChunks.length} chunks after reranking`);
    finalChunks.slice(0, 5).forEach((chunk, idx) => {
      console.log(`[RAG] Chunk ${idx + 1}: ${chunk.filename}, chunkIndex: ${chunk.chunkIndex}, relevance: ${(chunk.relevance * 100).toFixed(1)}%`);
      const metadata = chunk.metadata ?? {};
      if (metadata.tableJson || (chunk as any)?.tableJson) {
        const tableData = metadata.tableJson || (chunk as any)?.tableJson;
        console.log(`[RAG]   Has table data: ${Array.isArray(tableData) ? tableData.length : 0} rows`);
      }
    });
  }

  const contextSources: ContextSourceEntry[] = await Promise.all(
    finalChunks.map(async (chunk) => {
      const docMeta =
        retrieval.documentMeta.get(chunk.documentId) ??
        ({
          id: chunk.documentId,
          filename: chunk.filename,
          docType: chunk.docType,
          processingType: chunk.processingType,
        } as DocumentMeta);

      const metadata = chunk.metadata ?? {};
      const sectionPath = metadata.sectionPath ?? chunk.sectionPath ?? "";
      const pageStart =
        metadata.pageNumber ??
        chunk.pageNumber ??
        metadata.pageStart ??
        null;
      const pageEnd = metadata.pageEnd ?? pageStart ?? null;

      // Build full content including tables if available
      const descriptorParts: string[] = [];
      const productGroupName =
        (metadata.productGroupName as string | undefined) ??
        (metadata.section as string | undefined);
      const variantName =
        (metadata.productVariantName as string | undefined) ??
        (metadata.subsection as string | undefined) ??
        (metadata.title as string | undefined);
      if (productGroupName) {
        descriptorParts.push(`Товар: ${productGroupName}`);
      }
      if (
        variantName &&
        (!productGroupName ||
          variantName.toLowerCase() !== productGroupName.toLowerCase())
      ) {
        descriptorParts.push(`Вариант: ${variantName}`);
      }

      const tables: ContextTableEntry[] = [];
      let fullContent = chunk.content.trim();
      if (descriptorParts.length) {
        fullContent = `${descriptorParts.join(" | ")}\n${fullContent}`;
      }

      const tableData = await resolveTableData(chunk, sectionPath);

      if (tableData && Array.isArray(tableData) && tableData.length > 0) {
        const tableLabel =
          detectTableHeading(fullContent) || detectTableHeading(chunk.content);
        const tableSection = tableRowsToMarkdown(tableData, tableLabel);
        if (tableSection) {
          tables.push({
            label: tableSection.label,
            markdown: tableSection.markdown,
            headerLine: tableSection.headerLine,
            introLine: tableSection.introLine,
          });
          fullContent = insertTableIntoContent(fullContent, tableSection);
        }
      }

      const isCatalog = docMeta.docType === "catalog";
      const snippet = isCatalog
        ? fullContent
        : truncateContent(
            fullContent,
            config.retrieval.contextCaps.chunkTokenLimit * TOKEN_CHAR_RATIO
          );

      const tags = chunk.tags ?? metadata.tags ?? [];
      const productTag = tags.find((tag: string) => tag.startsWith("product:"));
      const productId = productTag ? productTag.replace("product:", "") : null;

      const elementType =
        metadata.elementType ?? (chunk as any)?.elementType ?? "text";

      return {
        documentId: chunk.documentId,
        filename: docMeta.filename,
        documentType: docMeta.docType,
        sectionPath: sectionPath || undefined,
        sectionTitle:
          (metadata.productVariantName as string | undefined) ??
          (metadata.section as string | undefined) ??
          metadata.heading,
        pageStart,
        pageEnd,
        chunkIndex: chunk.chunkIndex,
        chunkContent: snippet,
        relevance: chunk.relevance,
        elementType,
        boostsApplied: productId
          ? [...chunk.boostsApplied, `product:${productId}`]
          : chunk.boostsApplied,
        tables: tables.length ? tables : undefined,
        metadata: metadata,
      };
    })
  );

  const context = buildContext(
    contextSources,
    config.retrieval.contextCaps
  );

  // Debug logging: check if tables are included in context
  if (config.logging?.enabled) {
    const hasTables = context.context.includes("[Таблица технических характеристик]");
    console.log(`[RAG] Context built: ${context.usedSources.length} sources, ${context.totalTokens} tokens, hasTables: ${hasTables}`);
    if (hasTables) {
      const tableMatches = context.context.match(/\[Таблица технических характеристик\][\s\S]*?(?=\n\n\[Источник|$)/g);
      console.log(`[RAG] Found ${tableMatches?.length || 0} tables in context`);
    }
    
    // Log query and selected sources
    console.log(`[RAG] Query: "${ragQuery.query}"`);
    console.log(`[RAG] Selected sources:`, context.usedSources.map(s => ({
      filename: s.filename,
      chunkIndex: s.chunkIndex,
      pageStart: s.pageStart,
      sectionPath: s.sectionPath,
      hasTable: s.chunkContent.includes("[Таблица технических характеристик]"),
      contentPreview: s.chunkContent.slice(0, 200) + "..."
    })));
    
    // Log context preview (first 1000 chars)
    console.log(`[RAG] Context preview (first 1000 chars):\n${context.context.slice(0, 1000)}...`);
  }

  const fullUsedSources = context.usedSources;
  const usedSources = fullUsedSources.slice(0, topK);

  const { sources, chunks } = mapSourcesForResponse(usedSources);

  if (shouldReturnRawAnswer(fullUsedSources, variantFilterKeys)) {
    const rawAnswer = buildRawAnswerFromSources(fullUsedSources, {
      allowTables: true,
    });
    if (rawAnswer) {
      const rawMapped = mapSourcesForResponse(fullUsedSources);
      const ragResponse: RAGResponse = {
        response: rawAnswer,
        sources: rawMapped.sources,
        chunks: rawMapped.chunks,
        responseTime: Date.now() - start,
        tokensUsed:
          Math.ceil(ragQuery.query.length / TOKEN_CHAR_RATIO) +
          Math.ceil(rawAnswer.length / TOKEN_CHAR_RATIO),
      };

      return ragResponse;
    }
  }

  // Fast path for passports/certificates/FAQ: if answer is obvious, return chunk text without LLM.
  const primaryDocType =
    forcedDocType ??
    (finalChunks.length > 0 &&
    finalChunks.every((c) => c.docType === finalChunks[0].docType)
      ? finalChunks[0].docType
      : null);
  const specialDoc =
    primaryDocType === "passport" ||
    primaryDocType === "certificate" ||
    primaryDocType === "warranty_faq";
  if (specialDoc && isObviousSingleChunkAnswer(finalChunks, config)) {
    const allowTables = queryWantsTables(ragQuery.query);
    const topSource = fullUsedSources[0];
    if (primaryDocType === "warranty_faq" && topSource?.chunkContent) {
      const extracted = extractFaqAnswer(topSource.chunkContent);
      if (extracted) {
        const mapped = mapSourcesForResponse([topSource]);
        return {
          response: normalizeAnswerSpacing(extracted),
          sources: mapped.sources,
          chunks: mapped.chunks,
          responseTime: Date.now() - start,
          tokensUsed:
            Math.ceil(ragQuery.query.length / TOKEN_CHAR_RATIO) +
            Math.ceil(extracted.length / TOKEN_CHAR_RATIO),
        };
      }
    }

    const rawAnswer = buildRawAnswerFromSources([topSource], { allowTables });
    if (rawAnswer) {
      const mapped = mapSourcesForResponse([topSource]);
      return {
        response: rawAnswer,
        sources: mapped.sources,
        chunks: mapped.chunks,
        responseTime: Date.now() - start,
        tokensUsed:
          Math.ceil(ragQuery.query.length / TOKEN_CHAR_RATIO) +
          Math.ceil(rawAnswer.length / TOKEN_CHAR_RATIO),
      };
    }
  }

  const systemPrompt = composeSystemPrompt(
    getSystemPromptTemplate(),
    await fetchActiveSystemPrompt()
  );

  // The default user message is heavily catalog/instruction-oriented.
  // For passports/certificates/FAQ we use a simpler instruction set.
  const wantsTables = queryWantsTables(ragQuery.query);
  const userMessage =
    specialDoc
      ? `Задача: ответить на вопрос пользователя строго на основе источников ниже. Если сведений нет — так и скажи.

ВАЖНО:
- Отвечай кратко и по делу.
- НЕ добавляй таблицы и большие блоки данных, если пользователь явно не просил таблицу.

ФОРМАТ ОТВЕТА (читабельность):
- Если в источнике есть нумерованный/маркированный список (шаги/условия) — сохрани формат списком (каждый пункт с новой строки).
- Если в тексте есть перечисления/условия — лучше оформляй как список, а не “простыню”.
- Делай короткие абзацы (1–3 предложения), добавляй пустую строку между блоками.

ТАБЛИЦЫ:
- Если пользователь просит таблицу/характеристики/размеры/параметры — выведи данные в Markdown-таблице.
- Если таблица в источнике “кривая/ломаная”, НЕ пытайся её выдумывать: лучше выведи ключевые строки/параметры списком и предложи запросить “покажи таблицу полностью”.
- Не дублируй одну и ту же таблицу несколько раз.

ИСТОЧНИКИ:
- В конце укажи источники: «Источник: <документ>, раздел <раздел>, страница <страница>».

Источники:
${context.context}

Вопрос пользователя: ${ragQuery.query}

Ответ (на русском языке):`
      : buildUserMessage(context.context, ragQuery.query);

  // Debug logging: log user message preview
  if (config.logging?.enabled) {
    console.log(`[RAG] User message length: ${userMessage.length} chars`);
    console.log(`[RAG] User message preview (first 1500 chars):\n${userMessage.slice(0, 1500)}...`);
    
    // Check if tables are in user message
    if (userMessage.includes("[Таблица технических характеристик]")) {
      const tableStart = userMessage.indexOf("[Таблица технических характеристик]");
      const tableEnd = userMessage.indexOf("\n\n[Источник", tableStart);
      const tableSection = tableEnd > tableStart 
        ? userMessage.slice(tableStart, tableEnd)
        : userMessage.slice(tableStart, tableStart + 500);
      console.log(`[RAG] Table section in user message:\n${tableSection}`);
    } else {
      console.log(`[RAG] WARNING: No tables found in user message!`);
    }
  }

  const llmResponse = await invokeLLM({
    model: config.llm.model,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userMessage,
      },
    ],
    temperature: config.llm.temperature,
    top_p: config.llm.topP,
    repeat_penalty: config.llm.repeatPenalty,
    maxTokens: config.llm.maxTokens,
  });

  let messageContent =
    llmResponse.choices[0]?.message?.content ??
    "В документах нет информации о вашем вопросе.";

  // Auto-appending tables is useful for catalog answers, but degrades passports/certificates/FAQ.
  // Only force-append tables for those doc types when the query explicitly asks for tables.
  const allowAutoTables = !specialDoc || wantsTables;
  if (allowAutoTables) {
    messageContent = ensureTablesInResponse(messageContent, usedSources);
  }
  messageContent = normalizeAnswerSpacing(messageContent);

  // Debug logging: log LLM response
  if (config.logging?.enabled) {
    console.log(`[RAG] LLM Response (first 500 chars):\n${messageContent.slice(0, 500)}...`);
    console.log(`[RAG] Response length: ${messageContent.length} chars`);
  }

  const diagnosticsPayload = buildDiagnosticsPayload(
    retrieval.diagnostics,
    selectedDocs,
    config,
    rerankResult.applied,
    rerankResult.model
  );

  const db = await getDb();
  if (db) {
    await db.insert(chatHistory).values({
      sessionId: ragQuery.sessionId,
      userId: ragQuery.userId,
      query: ragQuery.query,
      response: messageContent,
      source: ragQuery.source,
      responseTime: Date.now() - start,
      tokensUsed:
        Math.ceil(ragQuery.query.length / TOKEN_CHAR_RATIO) +
        Math.ceil(messageContent.length / TOKEN_CHAR_RATIO),
      documentsUsed: sources.length,
      diagnostics: diagnosticsPayload,
    });
  }

  const ragResponse: RAGResponse = {
    response: messageContent,
    sources,
    chunks,
    responseTime: Date.now() - start,
    tokensUsed:
      Math.ceil(ragQuery.query.length / TOKEN_CHAR_RATIO) +
      Math.ceil(messageContent.length / TOKEN_CHAR_RATIO),
  };

  if (options?.includeDiagnostics) {
    ragResponse.diagnostics = {
      retrieval: retrieval.diagnostics,
      context: context.context,
      usedSources: context.usedSources,
    };
  }

  return ragResponse;
}

export async function getAssistantStats() {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const totalQueries = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(chatHistory);

  const avgResponseTime = await db
    .select({ avg: sql<number>`AVG(responseTime)` })
    .from(chatHistory);

  const queriesBySource = await db
    .select({
      source: chatHistory.source,
      count: sql<number>`COUNT(*)`,
    })
    .from(chatHistory)
    .groupBy(chatHistory.source);

  return {
    totalQueries: totalQueries[0]?.count ?? 0,
    avgResponseTime: Math.round(avgResponseTime[0]?.avg ?? 0),
    queriesBySource: Object.fromEntries(
      queriesBySource.map((row) => [row.source, row.count])
    ),
  };
}

export const __testables = {
  computeBm25Score,
  applyMmr,
  computeBoosts,
  buildUserMessage,
};

