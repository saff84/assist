import fs from "fs";
import path from "path";

import type { RAGConfig } from "./types";

const DEFAULT_CONFIG: RAGConfig = {
  llm: {
    model: "qwen2.5:1.5b-instruct",
    temperature: 0,
    topP: 0.1,
    repeatPenalty: 1.1,
    maxTokens: 2048,
    language: "ru",
  },
  retrieval: {
    embeddingModel: "bge-m3",
    hybridWeights: {
      embedding: 0.6,
      bm25: 0.4,
    },
    relevanceThreshold: 0.45,
    answerThreshold: 0.52,
    fallbackThreshold: 0.35,
    maxInitialChunks: 300,
    mmr: {
      lambda: 0.7,
      candidatePoolSize: 40,
      resultCount: 12,
    },
    boosts: {
      sectionMatch: 0.1,
      titleMatch: 0.08,
      tagMatch: 0.05,
      skuMatch: 0.12,
      instructionPriority: 0.2,
      catalogPriority: 0.15,
      termOverlap: 0.05,
      radiatorSectionPriority: 0.35,
      variantMatch: 0.35,
    },
    stopwords: {
      extra: ["санекст", "санекстовский"],
    },
    reranker: {
      enabled: true,
      model: "bge-reranker-v2-m3",
    },
    contextCaps: {
      maxChunks: 20,
      maxChunksPerDoc: 15,
      maxTokens: 10000,
      chunkTokenLimit: 1500,
    },
  },
  logging: {
    enabled: true,
  },
};

let cachedConfig: RAGConfig | null = null;

const CONFIG_PATH =
  process.env.RAG_CONFIG_PATH ??
  path.resolve(process.cwd(), "config", "rag.json");

function readConfigFile(): Partial<RAGConfig> {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return {};
    }
    const fileContent = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(fileContent) as Partial<RAGConfig>;
  } catch (error) {
    console.warn(
      `[RAG:config] Failed to load config from ${CONFIG_PATH}:`,
      error
    );
    return {};
  }
}

function normalizeWeights(weights: { embedding: number; bm25: number }) {
  const sum = weights.embedding + weights.bm25;
  if (sum === 0) {
    return { embedding: 0.6, bm25: 0.4 };
  }

  return {
    embedding: weights.embedding / sum,
    bm25: weights.bm25 / sum,
  };
}

function applyEnvOverrides(config: RAGConfig): RAGConfig {
  const llmModelEnv =
    process.env.LLM_MODEL_GENERATION ||
    process.env.OLLAMA_MODEL ||
    process.env.OPENAI_MODEL;
  const embeddingModelEnv =
    process.env.EMBEDDING_MODEL || process.env.OLLAMA_EMBEDDING_MODEL;
  const rerankModelEnv = process.env.RERANK_MODEL;
  const rerankDisabledEnv =
    process.env.RERANK_ENABLED === "false" ||
    process.env.RAG_RERANK_ENABLED === "false";

  const merged: RAGConfig = JSON.parse(JSON.stringify(config));

  if (llmModelEnv) {
    merged.llm.model = llmModelEnv;
  }
  if (embeddingModelEnv) {
    merged.retrieval.embeddingModel = embeddingModelEnv;
  }
  if (typeof rerankModelEnv === "string" && rerankModelEnv.trim().length > 0) {
    merged.retrieval.reranker.model = rerankModelEnv.trim();
  }
  if (rerankDisabledEnv) {
    merged.retrieval.reranker.enabled = false;
  }

  const temperatureEnv = process.env.LLM_TEMPERATURE;
  if (temperatureEnv) {
    const value = Number(temperatureEnv);
    if (!Number.isNaN(value)) {
      merged.llm.temperature = value;
    }
  }

  const topPEnv = process.env.LLM_TOP_P;
  if (topPEnv) {
    const value = Number(topPEnv);
    if (!Number.isNaN(value)) {
      merged.llm.topP = value;
    }
  }

  const repeatPenaltyEnv = process.env.LLM_REPEAT_PENALTY;
  if (repeatPenaltyEnv) {
    const value = Number(repeatPenaltyEnv);
    if (!Number.isNaN(value)) {
      merged.llm.repeatPenalty = value;
    }
  }

  return merged;
}

export function getRagConfig(): RAGConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const fileConfig = readConfigFile();
  const merged: RAGConfig = {
    llm: {
      ...DEFAULT_CONFIG.llm,
      ...(fileConfig.llm ?? {}),
    },
    retrieval: {
      ...DEFAULT_CONFIG.retrieval,
      ...(fileConfig.retrieval ?? {}),
      hybridWeights: normalizeWeights({
        embedding:
          fileConfig.retrieval?.hybridWeights?.embedding ??
          DEFAULT_CONFIG.retrieval.hybridWeights.embedding,
        bm25:
          fileConfig.retrieval?.hybridWeights?.bm25 ??
          DEFAULT_CONFIG.retrieval.hybridWeights.bm25,
      }),
      boosts: {
        ...DEFAULT_CONFIG.retrieval.boosts,
        ...(fileConfig.retrieval?.boosts ?? {}),
      },
      stopwords: {
        extra: [
          ...DEFAULT_CONFIG.retrieval.stopwords.extra,
          ...(fileConfig.retrieval?.stopwords?.extra ?? []),
        ],
      },
      reranker: {
        ...DEFAULT_CONFIG.retrieval.reranker,
        ...(fileConfig.retrieval?.reranker ?? {}),
      },
      contextCaps: {
        ...DEFAULT_CONFIG.retrieval.contextCaps,
        ...(fileConfig.retrieval?.contextCaps ?? {}),
      },
      mmr: {
        ...DEFAULT_CONFIG.retrieval.mmr,
        ...(fileConfig.retrieval?.mmr ?? {}),
      },
    },
    logging: {
      ...DEFAULT_CONFIG.logging,
      ...(fileConfig.logging ?? {}),
    },
  };

  cachedConfig = applyEnvOverrides(merged);
  return cachedConfig;
}

export function reloadRagConfig(): RAGConfig {
  cachedConfig = null;
  return getRagConfig();
}

