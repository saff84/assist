import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rerankChunks } from "../reranker";
import type { ScoredChunk } from "../types";

const baseChunk = (id: number): ScoredChunk => ({
  id,
  documentId: 1,
  content: `Фрагмент ${id}`,
  chunkIndex: id,
  embeddingVector: [1, 0, 0],
  termFrequency: new Map(),
  termCount: 1,
  pageNumber: null,
  sectionPath: null,
  metadata: {},
  docType: "instruction",
  processingType: "instruction",
  filename: `doc-${id}.pdf`,
  heading: null,
  tags: [],
  bm25Score: 0.1 * id,
  embeddingScore: 0.2 * id,
  boostedScore: 0,
  hybridScore: 0.3 * id,
  relevance: 0.3 * id,
  boostsApplied: [],
});

describe("reranker", () => {
  const originalEnv = process.env.RERANKER_URL;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    process.env.RERANKER_URL = originalEnv;
  });

  it("returns original order when reranker disabled", async () => {
    process.env.RERANKER_URL = "";

    const result = await rerankChunks(
      "тестовый запрос",
      [baseChunk(1), baseChunk(2)],
      {
        embeddingModel: "bge-m3",
        hybridWeights: { embedding: 0.6, bm25: 0.4 },
        relevanceThreshold: 0.45,
        answerThreshold: 0.52,
        maxInitialChunks: 10,
        mmr: { lambda: 0.7, candidatePoolSize: 5, resultCount: 3 },
        boosts: {
          sectionMatch: 0.1,
          titleMatch: 0.08,
          tagMatch: 0.05,
          skuMatch: 0.12,
          instructionPriority: 0.2,
          catalogPriority: 0.15,
        },
        stopwords: { extra: [] },
        reranker: { enabled: true, model: "bge-reranker-v2-m3" },
        contextCaps: {
          maxChunks: 10,
          maxChunksPerDoc: 5,
          maxTokens: 4000,
          chunkTokenLimit: 900,
        },
      }
    );

    expect(result.applied).toBe(false);
    expect(result.chunks.map((chunk) => chunk.id)).toEqual([1, 2]);
  });

  it("falls back gracefully when reranker errors", async () => {
    process.env.RERANKER_URL = "http://localhost:9000/rerank";
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
    } as any);

    const result = await rerankChunks(
      "тестовый запрос",
      [baseChunk(1), baseChunk(3)],
      {
        embeddingModel: "bge-m3",
        hybridWeights: { embedding: 0.6, bm25: 0.4 },
        relevanceThreshold: 0.45,
        answerThreshold: 0.52,
        maxInitialChunks: 10,
        mmr: { lambda: 0.7, candidatePoolSize: 5, resultCount: 3 },
        boosts: {
          sectionMatch: 0.1,
          titleMatch: 0.08,
          tagMatch: 0.05,
          skuMatch: 0.12,
          instructionPriority: 0.2,
          catalogPriority: 0.15,
        },
        stopwords: { extra: [] },
        reranker: { enabled: true, model: "bge-reranker-v2-m3" },
        contextCaps: {
          maxChunks: 10,
          maxChunksPerDoc: 5,
          maxTokens: 4000,
          chunkTokenLimit: 900,
        },
      }
    );

    expect(result.applied).toBe(false);
    expect(result.chunks.map((chunk) => chunk.id)).toEqual([3, 1]);
  });
});

