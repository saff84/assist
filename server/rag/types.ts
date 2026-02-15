export type DocumentType =
  | "catalog"
  | "instruction"
  | "general"
  | "certificate"
  | "passport"
  | "warranty_faq";

export interface LLMConfig {
  model: string;
  temperature: number;
  topP: number;
  repeatPenalty: number;
  maxTokens: number;
  language: string;
}

export interface HybridWeights {
  embedding: number;
  bm25: number;
}

export interface BoostConfig {
  sectionMatch: number;
  titleMatch: number;
  tagMatch: number;
  skuMatch: number;
  instructionPriority: number;
  catalogPriority: number;
  termOverlap: number;
  radiatorSectionPriority: number;
  variantMatch: number;
}

export interface MMRConfig {
  lambda: number;
  candidatePoolSize: number;
  resultCount: number;
}

export interface ContextCaps {
  maxChunks: number;
  maxChunksPerDoc: number;
  maxTokens: number;
  chunkTokenLimit: number;
}

export interface RerankerConfig {
  enabled: boolean;
  model?: string;
}

export interface RetrievalConfig {
  embeddingModel: string;
  hybridWeights: HybridWeights;
  relevanceThreshold: number;
  answerThreshold: number;
  fallbackThreshold: number;
  maxInitialChunks: number;
  mmr: MMRConfig;
  boosts: BoostConfig;
  stopwords: {
    extra: string[];
  };
  reranker: RerankerConfig;
  contextCaps: ContextCaps;
}

export interface LoggingConfig {
  enabled: boolean;
}

export interface RAGConfig {
  llm: LLMConfig;
  retrieval: RetrievalConfig;
  logging: LoggingConfig;
}

export interface RAGOptions {
  topK?: number;
  includeDiagnostics?: boolean;
  forceDocumentType?: DocumentType;
  disableReranker?: boolean;
}

export interface RetrieverChunk {
  id: number;
  documentId: number;
  content: string;
  chunkIndex: number;
  embeddingVector: number[] | null;
  termFrequency: Map<string, number>;
  termCount: number;
  pageNumber: number | null;
  sectionPath: string | null;
  metadata: Record<string, any> | null;
  docType: DocumentType;
  processingType: string;
  filename: string;
  heading?: string | null;
  tags?: string[];
}

export interface ScoredChunk extends RetrieverChunk {
  bm25Score: number;
  embeddingScore: number;
  boostedScore: number;
  hybridScore: number;
  relevance: number;
  boostsApplied: string[];
}

export interface ContextTableEntry {
  label?: string;
  markdown: string;
  headerLine: string;
  introLine?: string;
}

export interface ContextSourceEntry {
  elementType?: string;
  documentId: number;
  filename: string;
  documentType: DocumentType;
  sectionPath?: string;
  sectionTitle?: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  chunkIndex: number;
  chunkContent: string;
  relevance: number;
  boostsApplied: string[];
  tables?: ContextTableEntry[];
  metadata?: Record<string, any>;
}

export interface RetrievalDiagnostics {
  topOriginal: Array<{ id: number; relevance: number; filename: string }>;
  topAfterMmr: Array<{ id: number; relevance: number; filename: string }>;
  appliedBoosts: Record<number, string[]>;
  rerankerApplied: boolean;
  rerankerModel?: string;
}

