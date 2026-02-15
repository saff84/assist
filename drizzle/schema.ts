import { 
  int, 
  mysqlEnum, 
  mysqlTable, 
  text, 
  timestamp, 
  varchar,
  decimal,
  longtext,
  boolean,
  index,
  json
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }).unique(),
  passwordHash: varchar("passwordHash", { length: 255 }), // For email/password auth
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Documents table for RAG system
 * Stores metadata about uploaded documents
 */
export const documents = mysqlTable(
  "documents",
  {
    id: int("id").autoincrement().primaryKey(),
    filename: varchar("filename", { length: 255 }).notNull(),
    fileType: varchar("fileType", { length: 20 }).notNull(), // pdf, xlsx, xls, doc, docx
    fileSize: int("fileSize").notNull(), // in bytes
    uploadedBy: int("uploadedBy").notNull(),
    uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
    status: mysqlEnum("status", ["processing", "indexed", "failed"]).default("processing").notNull(),
    errorMessage: longtext("errorMessage"),
    chunksCount: int("chunksCount").default(0).notNull(),
    s3Key: varchar("s3Key", { length: 512 }), // S3 storage reference
    // Document processing type and metadata
    processingType: mysqlEnum("processingType", [
      "general",
      "instruction",
      "catalog",
      "certificate",
      "passport",
      "warranty_faq",
    ])
      .default("general")
      .notNull(),
    docType: mysqlEnum("docType", [
      "catalog",
      "instruction",
      "general",
      "certificate",
      "passport",
      "warranty_faq",
    ])
      .default("general")
      .notNull(),
    title: varchar("title", { length: 512 }),
    year: int("year"),
    pages: int("pages"),
    processingStage: mysqlEnum("processingStage", ["queued", "parsing", "chunking", "embedding", "saving", "completed", "failed"]).default("queued").notNull(),
    processingProgress: int("processingProgress").default(0).notNull(),
    processingMessage: longtext("processingMessage"),
    documentMetadata: json("documentMetadata").$type<{
      hasTableOfContents?: boolean;
      tableOfContents?: Array<{ title: string; level: number; page?: number }>;
      sections?: Array<{ title: string; startPage?: number; endPage?: number }>;
      categories?: Array<string>;
      tags?: Array<string>;
      customFields?: Record<string, any>;
    }>(),
    tocJson: json("tocJson").$type<
      Array<{
        sectionPath: string;
        title: string;
        level: number;
        page?: number;
      }>
    >(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    uploadedByIdx: index("uploadedBy_idx").on(table.uploadedBy),
    statusIdx: index("status_idx").on(table.status),
  })
);

export type Document = typeof documents.$inferSelect;
export type InsertDocument = typeof documents.$inferInsert;

/**
 * Document chunks table for RAG system
 * Stores text chunks extracted from documents with embeddings
 */
export const documentChunks = mysqlTable(
  "document_chunks",
  {
    id: int("id").autoincrement().primaryKey(),
    documentId: int("documentId").notNull(),
    chunkIndex: int("chunkIndex").notNull(),
    content: longtext("content").notNull(), // text content of the chunk
    embedding: longtext("embedding"), // JSON string of embedding vector (stored as text for simplicity)
    tokenCount: int("tokenCount").default(0).notNull(),
    pageNumber: int("pageNumber"),
    sectionPath: varchar("sectionPath", { length: 512 }),
    elementType: mysqlEnum("elementType", ["text", "table", "figure", "list", "header"]).default("text").notNull(),
    tableJson: json("tableJson").$type<
      Array<Record<string, string | number | null>> | undefined
    >(),
    language: varchar("language", { length: 8 }).default("ru").notNull(),
    bm25Terms: longtext("bm25Terms"),
    // Chunk metadata for better context
    chunkMetadata: json("chunkMetadata").$type<{
      section?: string; // название раздела
      subsection?: string; // название подраздела
      pageNumber?: number; // номер страницы
      heading?: string; // заголовок, к которому относится чанк
      category?: string; // категория товаров (для каталогов)
      tags?: Array<string>; // теги
      importance?: 'high' | 'medium' | 'low'; // важность чанка
      sectionPath?: string;
      elementType?: "text" | "table" | "figure" | "list" | "header";
      productGroupId?: number | null;
      productGroupName?: string | null;
      productGroupSlug?: string | null;
      productVariantName?: string | null;
      productVariantNormalized?: string | null;
      productVariantSlug?: string | null;
    }>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    documentIdIdx: index("documentId_idx").on(table.documentId),
  })
);

export type DocumentChunk = typeof documentChunks.$inferSelect;
export type InsertDocumentChunk = typeof documentChunks.$inferInsert;

/**
 * Sections table - normalized table of contents entries
 */
export const sections = mysqlTable(
  "sections",
  {
    id: int("id").autoincrement().primaryKey(),
    documentId: int("documentId").notNull(),
    sectionPath: varchar("sectionPath", { length: 512 }).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    level: int("level").default(1).notNull(),
    parentPath: varchar("parentPath", { length: 512 }),
    pageStart: int("pageStart"),
    pageEnd: int("pageEnd"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    documentIdx: index("sections_document_idx").on(table.documentId),
    sectionPathIdx: index("sections_sectionPath_idx").on(table.sectionPath),
  })
);

export type Section = typeof sections.$inferSelect;
export type InsertSection = typeof sections.$inferInsert;

/**
 * Products table - structured catalogue items
 */
export const products = mysqlTable(
  "products",
  {
    id: int("id").autoincrement().primaryKey(),
    documentId: int("documentId").notNull(),
    sectionId: int("sectionId"),
    groupId: int("groupId"), // Reference to product_groups table
    sku: varchar("sku", { length: 128 }).notNull(),
    name: varchar("name", { length: 512 }),
    attributes: json("attributes").$type<Record<string, string | number | null>>(),
    pageNumber: int("pageNumber"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    productDocIdx: index("products_document_idx").on(table.documentId),
    productSkuIdx: index("products_sku_idx").on(table.sku),
    productGroupIdx: index("products_group_idx").on(table.groupId),
  })
);

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

/**
 * Product groups table - groups of products for better organization
 * Allows manual grouping of products from tables
 */
export const productGroups = mysqlTable(
  "product_groups",
  {
    id: int("id").autoincrement().primaryKey(),
    documentId: int("documentId").notNull(),
    name: varchar("name", { length: 512 }).notNull(), // Group name (e.g., "Трубы SANEXT", "Фитинги")
    description: text("description"), // Optional description
    sectionPath: varchar("sectionPath", { length: 512 }), // Related section path
    pageStart: int("pageStart"), // First page where products from this group appear
    pageEnd: int("pageEnd"), // Last page where products from this group appear
    createdBy: int("createdBy").notNull(), // User ID who created the group
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    documentIdIdx: index("product_groups_document_idx").on(table.documentId),
  })
);

export type ProductGroup = typeof productGroups.$inferSelect;
export type InsertProductGroup = typeof productGroups.$inferInsert;

/**
 * Product items table - items inside a product group (each item maps to one manual chunk).
 */
export const productItems = mysqlTable(
  "product_items",
  {
    id: int("id").autoincrement().primaryKey(),
    documentId: int("documentId").notNull(),
    groupId: int("groupId").notNull(), // Reference to product_groups table
    name: varchar("name", { length: 512 }).notNull(), // Item name (e.g., "Труба SANEXT «Универсальная»")
    description: text("description"),
    sortOrder: int("sortOrder").default(0).notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    documentIdIdx: index("product_items_document_idx").on(table.documentId),
    groupIdIdx: index("product_items_group_idx").on(table.groupId),
  })
);

export type ProductItem = typeof productItems.$inferSelect;
export type InsertProductItem = typeof productItems.$inferInsert;

/**
 * Document annotations table - manual markup for tables and tables with articles
 * Stores user annotations for document chunks (tables, tables with articles, etc.)
 */
export const documentAnnotations = mysqlTable(
  "document_annotations",
  {
    id: int("id").autoincrement().primaryKey(),
    documentId: int("documentId").notNull(),
    chunkIndex: int("chunkIndex").notNull(), // Index of the chunk being annotated
    annotationType: mysqlEnum("annotationType", [
      "table",
      "table_with_articles",
      "text",
      "figure",
      "list",
      "manual_region_group",
    ]).notNull(),
    isNomenclatureTable: boolean("isNomenclatureTable").default(false).notNull(), // True if this is a nomenclature table (contains articles/SKUs)
    productGroupId: int("productGroupId"), // Reference to product_groups table - products from this chunk belong to this group
    notes: text("notes"), // Optional notes from the annotator
    annotatedBy: int("annotatedBy").notNull(), // User ID who created the annotation
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    documentIdIdx: index("annotations_document_idx").on(table.documentId),
    chunkIndexIdx: index("annotations_chunk_idx").on(table.documentId, table.chunkIndex),
    productGroupIdx: index("annotations_group_idx").on(table.productGroupId),
  })
);

export type DocumentAnnotation = typeof documentAnnotations.$inferSelect;
export type InsertDocumentAnnotation = typeof documentAnnotations.$inferInsert;

/**
 * Manual regions table - stores user-selected regions on documents for manual chunking
 * Users draw polygons/rectangles on the document to mark areas for chunking
 */
export const manualRegions = mysqlTable(
  "manual_regions",
  {
    id: int("id").autoincrement().primaryKey(),
    documentId: int("documentId").notNull(),
    pageNumber: int("pageNumber").notNull(), // Page number where region is located
    regionType: mysqlEnum("regionType", [
      "text",
      "table",
      "table_with_articles",
      "figure",
      "list",
      "faq_question",
      "faq_answer",
      "certificate_answer",
    ]).notNull(), // Type of content in this region
    coordinates: json("coordinates").$type<{
      // Polygon coordinates (array of {x, y} points) in display space (after DPI scaling compensation)
      points: Array<{ x: number; y: number }>;
      // Bounding box in display coordinates
      bbox?: { x: number; y: number; width: number; height: number };
      // Normalized polygon relative to page width/height (0..1)
      normalizedPoints?: Array<{ x: number; y: number }>;
      // Normalized bounding box (0..1 relative to page width/height)
      normalizedBBox?: { x: number; y: number; width: number; height: number };
      // Page dimensions at scale 1 (PDF units converted to viewport)
      pageDimensions?: { width: number; height: number };
      // UI scale factor at the time region was created/updated
      scaleAtCapture?: number;
    }>().notNull(),
    extractedText: text("extractedText"), // Text extracted from this region (filled when creating chunk)
    isNomenclatureTable: boolean("isNomenclatureTable").default(false).notNull(), // True if this is a nomenclature table
    productGroupId: int("productGroupId"), // Reference to product_groups table
    productItemId: int("productItemId"), // Reference to product_items table (each item = one chunk)
    qaPairId: int("qaPairId"), // For warranty_faq: groups question+answer regions into pairs
    notes: text("notes"), // Optional notes
    createdBy: int("createdBy").notNull(), // User ID who created the region
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    documentIdIdx: index("manual_regions_document_idx").on(table.documentId),
    pageNumberIdx: index("manual_regions_page_idx").on(table.documentId, table.pageNumber),
  })
);

export type ManualRegion = typeof manualRegions.$inferSelect;
export type InsertManualRegion = typeof manualRegions.$inferInsert;

/**
 * FAQ entries table - manual Q/A chunks not tied to documents.
 * Stores a "problem title" (user issue) and an "answer" that can include images.
 */
export const faqEntries = mysqlTable(
  "faq_entries",
  {
    id: int("id").autoincrement().primaryKey(),
    title: varchar("title", { length: 512 }).notNull(),
    answerText: longtext("answerText").notNull(),
    content: longtext("content").notNull(), // Normalized "Вопрос/Ответ" text used for retrieval
    images: json("images").$type<
      Array<{
        key: string; // storage key / filename
        filename: string;
        mimeType: string;
        url: string; // public URL (usually /api/faq-images/<key>)
      }>
    >(),
    embedding: longtext("embedding"), // JSON embedding vector
    bm25Terms: longtext("bm25Terms"),
    tags: json("tags").$type<string[]>(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    createdByIdx: index("faq_entries_createdBy_idx").on(table.createdBy),
  })
);

export type FaqEntry = typeof faqEntries.$inferSelect;
export type InsertFaqEntry = typeof faqEntries.$inferInsert;

/**
 * System prompts table
 * Stores the main system prompt for the assistant
 */
export const systemPrompts = mysqlTable(
  "system_prompts",
  {
    id: int("id").autoincrement().primaryKey(),
    prompt: longtext("prompt").notNull(),
    version: int("version").default(1).notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    isActive: boolean("isActive").default(true).notNull(),
  },
  (table) => ({
    isActiveIdx: index("isActive_idx").on(table.isActive),
  })
);

export type SystemPrompt = typeof systemPrompts.$inferSelect;
export type InsertSystemPrompt = typeof systemPrompts.$inferInsert;

/**
 * Chat history table
 * Stores all queries and responses for statistics and audit
 */
export const chatHistory = mysqlTable(
  "chat_history",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId"),
    sessionId: varchar("sessionId", { length: 128 }), // for tracking conversations
    query: longtext("query").notNull(),
    response: longtext("response").notNull(),
    source: mysqlEnum("source", ["website", "bitrix24", "test"]).notNull(),
    responseTime: int("responseTime").default(0).notNull(), // in milliseconds
    tokensUsed: int("tokensUsed").default(0).notNull(),
    documentsUsed: int("documentsUsed").default(0).notNull(), // count of documents referenced
    diagnostics: json("diagnostics").$type<{
      relevanceThreshold: number;
      answerThreshold: number;
      originalTop: Array<{
        chunkId: number;
        relevance: number;
        filename: string;
      }>;
      mmrTop: Array<{
        chunkId: number;
        relevance: number;
        filename: string;
      }>;
      selectedDocuments: Array<{
        documentId: number;
        filename: string;
        chunkCount: number;
      }>;
      rerankerApplied: boolean;
      rerankerModel?: string;
      boostsByChunk: Record<
        string,
        {
          boosts: string[];
          finalScore: number;
        }
      >;
    }>(),
    rating: int("rating"), // optional user rating (1-5)
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("userId_idx").on(table.userId),
    sourceIdx: index("source_idx").on(table.source),
    createdAtIdx: index("createdAt_idx").on(table.createdAt),
    sessionIdIdx: index("sessionId_idx").on(table.sessionId),
  })
);

export type ChatHistoryRecord = typeof chatHistory.$inferSelect;
export type InsertChatHistoryRecord = typeof chatHistory.$inferInsert;

/**
 * Query statistics table
 * Aggregated statistics for dashboard
 */
export const queryStats = mysqlTable(
  "query_stats",
  {
    id: int("id").autoincrement().primaryKey(),
    date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD format
    totalQueries: int("totalQueries").default(0).notNull(),
    avgResponseTime: decimal("avgResponseTime", { precision: 10, scale: 2 }).default("0").notNull(),
    websiteQueries: int("websiteQueries").default(0).notNull(),
    bitrix24Queries: int("bitrix24Queries").default(0).notNull(),
    avgTokensUsed: decimal("avgTokensUsed", { precision: 10, scale: 2 }).default("0").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    dateIdx: index("date_idx").on(table.date),
  })
);

export type QueryStat = typeof queryStats.$inferSelect;
export type InsertQueryStat = typeof queryStats.$inferInsert;
