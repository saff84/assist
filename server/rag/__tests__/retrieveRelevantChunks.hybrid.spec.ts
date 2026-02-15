import { describe, expect, it } from "vitest";

import { __testables } from "../../ragModule";
import type { RetrieverChunk, DocumentType } from "../../rag/types";

const baseChunk = (overrides: Partial<RetrieverChunk> = {}): RetrieverChunk => ({
  id: 1,
  documentId: 10,
  content: "Монтаж коллекторного блока SANEXT выполняется по инструкции.",
  chunkIndex: 0,
  embeddingVector: [0.5, 0.5, 0.5, 0.5],
  termFrequency: new Map([
    ["монтаж", 2],
    ["коллекторн", 1],
    ["блок", 1],
  ]),
  termCount: 4,
  pageNumber: 3,
  sectionPath: "1.2",
  metadata: {
    section: "Монтаж коллектора",
    tags: ["SANEXT", "коллектор"],
  },
  docType: "instruction",
  processingType: "instruction",
  filename: "Пособие по монтажу SANEXT.pdf",
  heading: "Монтаж коллектора",
  tags: ["SANEXT", "коллектор"],
  ...overrides,
});

const baseDoc = (
  overrides: Partial<{
    docType: DocumentType;
    filename: string;
    processingType: string;
    title?: string | null;
  }> = {}
) => ({
  id: 10,
  filename: "Пособие по монтажу SANEXT.pdf",
  docType: "instruction" as DocumentType,
  processingType: "instruction",
  title: "Пособие по монтажу SANEXT",
  ...overrides,
});

describe("hybrid retrieval helpers", () => {
  it("computes positive BM25 for matching terms", () => {
    const { computeBm25Score } = __testables;
    const score = computeBm25Score(
      ["монтаж", "коллекторн"],
      new Map([
        ["монтаж", 2],
        ["коллекторн", 1],
        ["блок", 1],
      ]),
      4,
      5,
      new Map([
        ["монтаж", 3],
        ["коллекторн", 2],
      ]),
      50
    );

    expect(score).toBeGreaterThan(0);
  });

  it("boosts installation chunks from instruction manual", () => {
    const { computeBoosts } = __testables;
    const chunk = baseChunk();
    const boosts = computeBoosts(
      chunk,
      "монтаж коллектора sanext",
      baseDoc(),
      [],
      new Map(),
      {
        llm: {
          model: "",
          temperature: 0,
          topP: 0,
          repeatPenalty: 1,
          maxTokens: 100,
          language: "ru",
        },
        retrieval: {
          embeddingModel: "",
          hybridWeights: { embedding: 0.6, bm25: 0.4 },
          relevanceThreshold: 0.45,
          answerThreshold: 0.52,
          maxInitialChunks: 100,
          mmr: { lambda: 0.7, candidatePoolSize: 20, resultCount: 8 },
          boosts: {
            sectionMatch: 0.1,
            titleMatch: 0.08,
            tagMatch: 0.05,
            skuMatch: 0.12,
            instructionPriority: 0.2,
            catalogPriority: 0.15,
          },
          stopwords: { extra: [] },
          reranker: { enabled: false },
          contextCaps: {
            maxChunks: 10,
            maxChunksPerDoc: 6,
            maxTokens: 4000,
            chunkTokenLimit: 900,
          },
        },
        logging: { enabled: true },
      },
      { installation: true, catalog: false }
    );

    expect(boosts.totalBoost).toBeGreaterThan(0.2);
    expect(boosts.reasons).toContain(
      "installation_instruction_priority"
    );
    expect(boosts.reasons).toContain("section_match");
  });

  it("penalises catalog chunk for installation query", () => {
    const { computeBoosts } = __testables;
    const chunk = baseChunk({
      docType: "catalog",
      processingType: "catalog",
      filename: "Каталог фитингов SANEXT.xlsx",
    });

    const boosts = computeBoosts(
      chunk,
      "монтаж коллектора sanext",
      baseDoc({
        docType: "catalog",
        filename: "Каталог фитингов SANEXT.xlsx",
        processingType: "catalog",
        title: "Каталог фитингов SANEXT",
      }),
      [],
      new Map(),
      {
        llm: {
          model: "",
          temperature: 0,
          topP: 0,
          repeatPenalty: 1,
          maxTokens: 100,
          language: "ru",
        },
        retrieval: {
          embeddingModel: "",
          hybridWeights: { embedding: 0.6, bm25: 0.4 },
          relevanceThreshold: 0.45,
          answerThreshold: 0.52,
          maxInitialChunks: 100,
          mmr: { lambda: 0.7, candidatePoolSize: 20, resultCount: 8 },
          boosts: {
            sectionMatch: 0.1,
            titleMatch: 0.08,
            tagMatch: 0.05,
            skuMatch: 0.12,
            instructionPriority: 0.2,
            catalogPriority: 0.15,
          },
          stopwords: { extra: [] },
          reranker: { enabled: false },
          contextCaps: {
            maxChunks: 10,
            maxChunksPerDoc: 6,
            maxTokens: 4000,
            chunkTokenLimit: 900,
          },
        },
        logging: { enabled: true },
      },
      { installation: true, catalog: false }
    );

    expect(boosts.totalBoost).toBeLessThan(0);
    expect(boosts.reasons).toContain("installation_catalog_penalty");
  });
});

