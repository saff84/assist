import { getDb } from "./db";
import { documents, documentChunks, systemPrompts, chatHistory, queryStats, sections, products, documentAnnotations, productGroups, productItems, manualRegions } from "../drizzle/schema";
import { eq, desc, and, gte, sql, asc, or, inArray } from "drizzle-orm";
import type { InsertDocument, InsertDocumentChunk, InsertSystemPrompt, InsertSection, InsertProduct, InsertDocumentAnnotation, InsertProductGroup, InsertProductItem, InsertManualRegion } from "../drizzle/schema";
import type { DocumentType } from "./rag/types";

/**
 * Database operations for documents and RAG system
 */

/**
 * Create a new document record
 */
export async function createDocument(doc: InsertDocument): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(documents).values(doc);
  return result[0].insertId as number;
}

/**
 * Update document status
 */
export async function updateDocumentStatus(
  documentId: number,
  status: "processing" | "indexed" | "failed",
  errorMessage?: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updates: Record<string, any> = {
    status,
    errorMessage: errorMessage || null,
    updatedAt: new Date(),
  };

  if (status === "indexed") {
    updates.processingStage = "completed";
    updates.processingProgress = 100;
  }

  if (status === "failed") {
    updates.processingStage = "failed";
    updates.processingProgress = 100;
  }

  await db.update(documents).set(updates).where(eq(documents.id, documentId));
}

/**
 * Update document chunks count
 */
export async function updateDocumentChunksCount(documentId: number, chunksCount: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(documents)
    .set({
      chunksCount,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, documentId));
}

/**
 * Update document metadata
 */
export async function updateDocumentMetadata(
  documentId: number,
  metadata: Record<string, any>,
  options?: {
    toc?: Array<{
      sectionPath: string;
      title: string;
      level: number;
      page?: number;
      pageStart?: number;
      pageEnd?: number;
    }>;
    title?: string;
    pages?: number;
    docType?:
      | "general"
      | "instruction"
      | "catalog"
      | "certificate"
      | "passport"
      | "warranty_faq";
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const payload: Record<string, any> = {
    documentMetadata: metadata,
    updatedAt: new Date(),
  };

  if (options?.toc) {
    payload.tocJson = options.toc;
  }
  if (typeof options?.title === "string") {
    payload.title = options.title;
  }
  if (typeof options?.pages === "number") {
    payload.pages = options.pages;
  }
  if (options?.docType) {
    payload.docType = options.docType;
  }

  await db
    .update(documents)
    .set(payload)
    .where(eq(documents.id, documentId));
}

/**
 * Insert document chunks
 */
export async function insertDocumentChunks(chunks: InsertDocumentChunk[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Insert in batches to avoid query size limits
  const batchSize = 100;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    await db.insert(documentChunks).values(batch);
  }
}

export async function getNextChunkIndex(documentId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db
    .select({
      maxIndex: sql<number>`COALESCE(MAX(${documentChunks.chunkIndex}), -1)`,
    })
    .from(documentChunks)
    .where(eq(documentChunks.documentId, documentId));

  const maxIndex = result?.maxIndex ?? -1;
  return maxIndex + 1;
}

export async function getDocumentChunkCount(documentId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db
    .select({
      count: sql<number>`COUNT(*)`,
    })
    .from(documentChunks)
    .where(eq(documentChunks.documentId, documentId));

  return result?.count ?? 0;
}

export async function deleteDocumentChunks(documentId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
}

export async function deleteDocumentAnnotations(documentId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .delete(documentAnnotations)
    .where(eq(documentAnnotations.documentId, documentId));
}

/**
 * Update document processing progress and stage
 */
export async function updateDocumentProgress(
  documentId: number,
  stage: "queued" | "parsing" | "chunking" | "embedding" | "saving" | "completed" | "failed",
  progress: number,
  message?: string | null
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalizedProgress = Math.max(0, Math.min(100, Math.round(progress)));
  await db
    .update(documents)
    .set({
      processingStage: stage,
      processingProgress: normalizedProgress,
      processingMessage: message ?? null,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, documentId));
}

/**
 * Replace sections associated with a document
 */
export async function replaceDocumentSections(
  documentId: number,
  sectionRecords: InsertSection[]
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(sections).where(eq(sections.documentId, documentId));

  if (sectionRecords.length === 0) {
    return;
  }

  const batchSize = 100;
  for (let i = 0; i < sectionRecords.length; i += batchSize) {
    const batch = sectionRecords.slice(i, i + batchSize);
    await db.insert(sections).values(batch);
  }
}

/**
 * Replace product index records for a document
 */
export async function replaceDocumentProducts(
  documentId: number,
  productRecords: InsertProduct[]
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(products).where(eq(products.documentId, documentId));

  if (productRecords.length === 0) {
    return;
  }

  const batchSize = 100;
  for (let i = 0; i < productRecords.length; i += batchSize) {
    const batch = productRecords.slice(i, i + batchSize).map((record) => ({
      ...record,
      // Ensure nullable fields are explicitly null, not undefined
      sectionId: record.sectionId ?? null,
      groupId: record.groupId ?? null,
      name: record.name ?? null,
      attributes: record.attributes ?? null,
      pageNumber: record.pageNumber ?? null,
    }));
    await db.insert(products).values(batch);
  }
}

/**
 * Get all documents
 */
export async function getAllDocuments() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.select().from(documents).orderBy(desc(documents.createdAt));
}

export async function updateDocumentTitle(documentId: number, title: string | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(documents)
    .set({
      title: title ?? null,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, documentId));
}

export async function getDocTypeAvailability(
  docTypes: DocumentType[]
): Promise<Record<DocumentType, boolean>> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const base: Record<DocumentType, boolean> = {
    catalog: false,
    instruction: false,
    general: false,
    certificate: false,
    passport: false,
    warranty_faq: false,
  };

  if (!docTypes.length) return base;

  const rows = await db
    .select({
      docType: documents.docType,
      cnt: sql<number>`COUNT(*)`,
    })
    .from(documents)
    .where(
      and(
        eq(documents.status, "indexed"),
        // For passports/certificates we show the topic even if chunks are not generated yet
        // (manual workflow can start from an indexed doc with 0 chunks).
        or(
          sql`${documents.chunksCount} > 0`,
          inArray(documents.docType, ["certificate", "passport"] as any)
        ),
        inArray(documents.docType, docTypes as any)
      )
    )
    .groupBy(documents.docType);

  rows.forEach((row) => {
    const key = row.docType as DocumentType;
    if (key in base) {
      base[key] = (row.cnt ?? 0) > 0;
    }
  });

  return base;
}

/**
 * Get document by ID
 */
export async function getDocumentById(documentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  return result[0] || null;
}

/**
 * Get detailed document processing information
 * Returns document with all chunks, sections, and processing details
 */
export async function getDocumentProcessingDetails(documentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get document
  const doc = await getDocumentById(documentId);
  if (!doc) {
    return null;
  }

  // Get all chunks for this document
  const chunks = await db
    .select({
      id: documentChunks.id,
      chunkIndex: documentChunks.chunkIndex,
      content: documentChunks.content,
      tokenCount: documentChunks.tokenCount,
      pageNumber: documentChunks.pageNumber,
      sectionPath: documentChunks.sectionPath,
      elementType: documentChunks.elementType,
      tableJson: documentChunks.tableJson,
      language: documentChunks.language,
      chunkMetadata: documentChunks.chunkMetadata,
      embedding: documentChunks.embedding,
      bm25Terms: documentChunks.bm25Terms,
      createdAt: documentChunks.createdAt,
    })
    .from(documentChunks)
    .where(eq(documentChunks.documentId, documentId))
    .orderBy(asc(documentChunks.chunkIndex));

  // Get all sections for this document
  const docSections = await db
    .select()
    .from(sections)
    .where(eq(sections.documentId, documentId))
    .orderBy(asc(sections.sectionPath));

  // Get all products for this document (guard table existence)
  let docProducts: typeof products.$inferSelect[] = [];
  try {
    docProducts = await db
      .select()
      .from(products)
      .where(eq(products.documentId, documentId));
  } catch (error: any) {
    const isMissingTable = error?.code === "ER_NO_SUCH_TABLE" || error?.errno === 1146;
    const isMissingColumn = error?.code === "ER_BAD_FIELD_ERROR" || error?.errno === 1054;

    if (isMissingTable) {
      console.warn("[DocumentDb] products table not available, skipping products load");
      docProducts = [];
    } else if (isMissingColumn) {
      console.warn("[DocumentDb] products table missing expected columns, skipping products load");
      docProducts = [];
    } else {
      throw error;
    }
  }

  // Process chunks to add embedding info
  const processedChunks = chunks.map((chunk) => {
    let embeddingInfo = null;
    if (chunk.embedding) {
      try {
        const embeddingArray = JSON.parse(chunk.embedding);
        if (Array.isArray(embeddingArray)) {
          embeddingInfo = {
            hasEmbedding: true,
            dimensions: embeddingArray.length,
            sample: embeddingArray.slice(0, 5), // First 5 values for preview
          };
        }
      } catch {
        embeddingInfo = { hasEmbedding: false, error: "Failed to parse embedding" };
      }
    } else {
      embeddingInfo = { hasEmbedding: false };
    }

    // Process table data
    let tableInfo = null;
    if (chunk.tableJson && Array.isArray(chunk.tableJson) && chunk.tableJson.length > 0) {
      tableInfo = {
        hasTable: true,
        rowCount: chunk.tableJson.length,
        columns: Object.keys(chunk.tableJson[0] || {}),
        sampleRows: chunk.tableJson.slice(0, 3), // First 3 rows for preview
      };
    } else {
      tableInfo = { hasTable: false };
    }

    // Parse metadata
    let metadata = null;
    if (chunk.chunkMetadata) {
      if (typeof chunk.chunkMetadata === "string") {
        try {
          metadata = JSON.parse(chunk.chunkMetadata);
        } catch {
          metadata = { raw: chunk.chunkMetadata };
        }
      } else {
        metadata = chunk.chunkMetadata;
      }
    }

    return {
      id: chunk.id,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      contentPreview: chunk.content.slice(0, 200) + (chunk.content.length > 200 ? "..." : ""),
      tokenCount: chunk.tokenCount,
      pageNumber: chunk.pageNumber,
      sectionPath: chunk.sectionPath,
      elementType: chunk.elementType,
      language: chunk.language,
      metadata,
      embedding: embeddingInfo,
      table: tableInfo,
      hasBm25Terms: !!chunk.bm25Terms,
      createdAt: chunk.createdAt,
    };
  });

  return {
    document: doc,
    chunks: processedChunks,
    sections: docSections,
    products: docProducts,
    statistics: {
      totalChunks: chunks.length,
      chunksWithEmbeddings: chunks.filter((c) => c.embedding).length,
      chunksWithTables: chunks.filter((c) => c.tableJson && Array.isArray(c.tableJson) && c.tableJson.length > 0).length,
      totalSections: docSections.length,
      totalProducts: docProducts.length,
      totalTokens: chunks.reduce((sum, c) => sum + c.tokenCount, 0),
    },
  };
}

/**
 * Get full chunk content by documentId and chunkIndex
 */
export async function getChunkContent(documentId: number, chunkIndex: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const chunk = await db
    .select({
      id: documentChunks.id,
      chunkIndex: documentChunks.chunkIndex,
      content: documentChunks.content,
      tokenCount: documentChunks.tokenCount,
      pageNumber: documentChunks.pageNumber,
      sectionPath: documentChunks.sectionPath,
      elementType: documentChunks.elementType,
      tableJson: documentChunks.tableJson,
      language: documentChunks.language,
      chunkMetadata: documentChunks.chunkMetadata,
      createdAt: documentChunks.createdAt,
    })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.documentId, documentId),
        eq(documentChunks.chunkIndex, chunkIndex)
      )
    )
    .limit(1);

  if (!chunk.length) {
    return null;
  }

  const chunkData = chunk[0];
  
  // Parse metadata
  let metadata = null;
  if (chunkData.chunkMetadata) {
    if (typeof chunkData.chunkMetadata === "string") {
      try {
        metadata = JSON.parse(chunkData.chunkMetadata);
      } catch {
        metadata = { raw: chunkData.chunkMetadata };
      }
    } else {
      metadata = chunkData.chunkMetadata;
    }
  }

  // Process table data
  let tableData = null;
  if (chunkData.tableJson && Array.isArray(chunkData.tableJson) && chunkData.tableJson.length > 0) {
    tableData = {
      rows: chunkData.tableJson,
      rowCount: chunkData.tableJson.length,
      columns: Object.keys(chunkData.tableJson[0] || {}),
    };
  }

  return {
    id: chunkData.id,
    chunkIndex: chunkData.chunkIndex,
    content: chunkData.content,
    fullContent: chunkData.content, // Full content without truncation
    tokenCount: chunkData.tokenCount,
    pageNumber: chunkData.pageNumber,
    sectionPath: chunkData.sectionPath,
    elementType: chunkData.elementType,
    language: chunkData.language,
    metadata,
    tableData,
    createdAt: chunkData.createdAt,
  };
}

export interface ChunkBaseInfo {
  id: number;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageNumber: number | null;
  sectionPath: string | null;
  elementType: string | null;
  metadata: Record<string, any> | null;
  tableJson: Array<Record<string, string | number | null>> | null;
}

export async function getChunkBaseInfo(
  documentId: number,
  chunkIndex: number
): Promise<ChunkBaseInfo | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const chunk = await db
    .select({
      id: documentChunks.id,
      chunkIndex: documentChunks.chunkIndex,
      content: documentChunks.content,
      tokenCount: documentChunks.tokenCount,
      pageNumber: documentChunks.pageNumber,
      sectionPath: documentChunks.sectionPath,
      elementType: documentChunks.elementType,
      chunkMetadata: documentChunks.chunkMetadata,
      tableJson: documentChunks.tableJson,
    })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.documentId, documentId),
        eq(documentChunks.chunkIndex, chunkIndex)
      )
    )
    .limit(1);

  if (!chunk.length) {
    return null;
  }

  const row = chunk[0];
  let metadata: Record<string, any> | null = null;
  if (row.chunkMetadata) {
    if (typeof row.chunkMetadata === "string") {
      try {
        metadata = JSON.parse(row.chunkMetadata);
      } catch {
        metadata = { raw: row.chunkMetadata };
      }
    } else {
      metadata = row.chunkMetadata;
    }
  }

  return {
    id: row.id,
    chunkIndex: row.chunkIndex,
    content: row.content,
    tokenCount: row.tokenCount,
    pageNumber: row.pageNumber,
    sectionPath: row.sectionPath,
    elementType: row.elementType,
    metadata,
    tableJson:
      row.tableJson && Array.isArray(row.tableJson) ? row.tableJson : null,
  };
}

export async function getChunksInSection(
  documentId: number,
  sectionPath: string
): Promise<ChunkBaseInfo[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const chunks = await db
    .select({
      id: documentChunks.id,
      chunkIndex: documentChunks.chunkIndex,
      content: documentChunks.content,
      tokenCount: documentChunks.tokenCount,
      pageNumber: documentChunks.pageNumber,
      sectionPath: documentChunks.sectionPath,
      elementType: documentChunks.elementType,
      chunkMetadata: documentChunks.chunkMetadata,
      tableJson: documentChunks.tableJson,
    })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.documentId, documentId),
        eq(documentChunks.sectionPath, sectionPath)
      )
    )
    .orderBy(asc(documentChunks.chunkIndex));

  return chunks.map((row) => {
    let metadata: Record<string, any> | null = null;
    if (row.chunkMetadata) {
      if (typeof row.chunkMetadata === "string") {
        try {
          metadata = JSON.parse(row.chunkMetadata);
        } catch {
          metadata = { raw: row.chunkMetadata };
        }
      } else {
        metadata = row.chunkMetadata;
      }
    }

    return {
      id: row.id,
      chunkIndex: row.chunkIndex,
      content: row.content,
      tokenCount: row.tokenCount,
      pageNumber: row.pageNumber,
      sectionPath: row.sectionPath,
      elementType: row.elementType,
      metadata,
      tableJson:
        row.tableJson && Array.isArray(row.tableJson) ? row.tableJson : null,
    };
  });
}

/**
 * Get all sections for a document
 */
export async function getDocumentSections(documentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Validate input
  if (documentId === undefined || documentId === null || documentId <= 0) {
    throw new Error("Invalid documentId");
  }

  const docSections = await db
    .select()
    .from(sections)
    .where(eq(sections.documentId, documentId))
    .orderBy(asc(sections.sectionPath));

  return docSections;
}

/**
 * Get section details with all related chunks
 */
export async function getSectionDetails(documentId: number, sectionPath: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Normalize sectionPath: try both the provided path and normalized versions
  // "1.1" might be stored as "1.10" or vice versa
  const normalizedPaths = [sectionPath];
  
  // Try normalizing: "1.10" -> "1.1", "1.20" -> "1.2"
  const parts = sectionPath.split('.');
  if (parts.length > 1) {
    const normalized = parts.map((part, idx) => {
      if (idx === 0) return part;
      const num = parseInt(part, 10);
      if (!isNaN(num) && part.length > 1 && part.endsWith('0')) {
        // Try removing trailing zero: "10" -> "1", "20" -> "2"
        const withoutZero = String(num / 10);
        if (withoutZero.includes('.')) {
          // If division results in decimal, keep original
          return part;
        }
        return withoutZero;
      }
      return part;
    }).join('.');
    if (normalized !== sectionPath) {
      normalizedPaths.push(normalized);
    }
    
    // Also try adding zero: "1.1" -> "1.10"
    const withZero = parts.map((part, idx) => {
      if (idx === 0) return part;
      const num = parseInt(part, 10);
      if (!isNaN(num) && part.length === 1) {
        return String(num * 10);
      }
      return part;
    }).join('.');
    if (withZero !== sectionPath && withZero !== normalized) {
      normalizedPaths.push(withZero);
    }
  }

  // Get section - try all normalized paths
  let sectionResult: any[] = [];
  for (const path of normalizedPaths) {
    const result = await db
      .select()
      .from(sections)
      .where(
        and(
          eq(sections.documentId, documentId),
          eq(sections.sectionPath, path)
        )
      )
      .limit(1);
    if (result.length > 0) {
      sectionResult = result;
      sectionPath = path; // Use the found path for chunk lookup
      break;
    }
  }

  if (!sectionResult.length) {
    return null;
  }

  const section = sectionResult[0];

  // Get all chunks for this section
  const sectionChunks = await db
    .select({
      id: documentChunks.id,
      chunkIndex: documentChunks.chunkIndex,
      content: documentChunks.content,
      tokenCount: documentChunks.tokenCount,
      pageNumber: documentChunks.pageNumber,
      elementType: documentChunks.elementType,
      tableJson: documentChunks.tableJson,
      chunkMetadata: documentChunks.chunkMetadata,
    })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.documentId, documentId),
        eq(documentChunks.sectionPath, sectionPath)
      )
    )
    .orderBy(asc(documentChunks.chunkIndex));

  // Get products for this section
  const sectionProducts = await db
    .select({
      product: products,
    })
    .from(products)
    .leftJoin(sections, eq(products.sectionId, sections.id))
    .where(
      and(
        eq(products.documentId, documentId),
        eq(sections.sectionPath, sectionPath)
      )
    );

  return {
    section,
    chunks: sectionChunks.map((chunk) => ({
      id: chunk.id,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      tokenCount: chunk.tokenCount,
      pageNumber: chunk.pageNumber,
      elementType: chunk.elementType,
      tableJson: chunk.tableJson,
      metadata: chunk.chunkMetadata,
    })),
    products: sectionProducts.map((row) => row.product),
  };
}

/**
 * Get product details with all related chunks
 */
export async function getProductDetails(documentId: number, productSku: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get product
  const productResult = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.documentId, documentId),
        eq(products.sku, productSku)
      )
    )
    .limit(1);

  if (!productResult.length) {
    return null;
  }

  const product = productResult[0];

  // Get all chunks that mention this product (by sectionPath)
  // Note: We'll filter by sectionPath for now, tag-based filtering can be added later if needed
  let productSectionPath: string | null = null;
  if (product.sectionId) {
    const sectionRow = await db
      .select({ sectionPath: sections.sectionPath })
      .from(sections)
      .where(eq(sections.id, product.sectionId))
      .limit(1);
    productSectionPath = sectionRow[0]?.sectionPath ?? null;
  }

  const productChunks = await db
    .select({
      id: documentChunks.id,
      chunkIndex: documentChunks.chunkIndex,
      content: documentChunks.content,
      tokenCount: documentChunks.tokenCount,
      pageNumber: documentChunks.pageNumber,
      sectionPath: documentChunks.sectionPath,
      elementType: documentChunks.elementType,
      tableJson: documentChunks.tableJson,
      chunkMetadata: documentChunks.chunkMetadata,
    })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.documentId, documentId),
        productSectionPath
          ? eq(documentChunks.sectionPath, productSectionPath)
          : sql`1=1`
      )
    )
    .orderBy(asc(documentChunks.chunkIndex));

  return {
    product,
    chunks: productChunks.map((chunk) => ({
      id: chunk.id,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      tokenCount: chunk.tokenCount,
      pageNumber: chunk.pageNumber,
      sectionPath: chunk.sectionPath,
      elementType: chunk.elementType,
      tableJson: chunk.tableJson,
      metadata: chunk.chunkMetadata,
    })),
  };
}

/**
 * Delete document and all its related data
 * 
 * This function deletes:
 * - document_chunks (including embeddings stored in the embedding field)
 * - sections
 * - products
 * - the document itself
 * 
 * Note: Embeddings are stored as JSON strings in the document_chunks.embedding field,
 * so they are automatically deleted when chunks are removed.
 */
export async function deleteDocument(documentId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Delete all related data in correct order (to avoid foreign key constraints)
  // 1. Delete chunks (referenced by documentId)
  //    This also deletes embeddings stored in document_chunks.embedding field
  await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
  
  // 2. Delete sections (referenced by documentId)
  await db.delete(sections).where(eq(sections.documentId, documentId));
  
  // 3. Delete products (referenced by documentId)
  await db.delete(products).where(eq(products.documentId, documentId));

  // 4. Finally delete the document itself
  await db.delete(documents).where(eq(documents.id, documentId));
}

/**
 * Clean up orphaned records (chunks, sections, products without parent documents)
 * This is useful after manual database cleanup or data migration
 */
export async function cleanupOrphanedRecords(): Promise<{
  chunksDeleted: number;
  sectionsDeleted: number;
  productsDeleted: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get all existing document IDs
  const existingDocs = await db.select({ id: documents.id }).from(documents);
  const docIds = new Set(existingDocs.map(d => d.id));

  if (docIds.size === 0) {
    // If no documents exist, delete all related records
    const chunksResult = await db.delete(documentChunks);
    const sectionsResult = await db.delete(sections);
    const productsResult = await db.delete(products);
    
    return {
      chunksDeleted: chunksResult[0].affectedRows || 0,
      sectionsDeleted: sectionsResult[0].affectedRows || 0,
      productsDeleted: productsResult[0].affectedRows || 0,
    };
  }

  // Delete chunks without valid documentId
  const docIdsArray = Array.from(docIds);
  const chunksResult = docIdsArray.length > 0
    ? await db.delete(documentChunks).where(sql`${documentChunks.documentId} NOT IN (${sql.join(docIdsArray.map(id => sql`${id}`), sql`, `)})`)
    : await db.delete(documentChunks);

  // Delete sections without valid documentId
  const sectionsResult = docIdsArray.length > 0
    ? await db.delete(sections).where(sql`${sections.documentId} NOT IN (${sql.join(docIdsArray.map(id => sql`${id}`), sql`, `)})`)
    : await db.delete(sections);

  // Delete products without valid documentId
  const productsResult = docIdsArray.length > 0
    ? await db.delete(products).where(sql`${products.documentId} NOT IN (${sql.join(docIdsArray.map(id => sql`${id}`), sql`, `)})`)
    : await db.delete(products);

  return {
    chunksDeleted: chunksResult[0].affectedRows || 0,
    sectionsDeleted: sectionsResult[0].affectedRows || 0,
    productsDeleted: productsResult[0].affectedRows || 0,
  };
}

/**
 * Get database cleanup statistics
 */
export async function getCleanupStats(): Promise<{
  totalDocuments: number;
  totalChunks: number;
  totalSections: number;
  totalProducts: number;
  orphanedChunks: number;
  orphanedSections: number;
  orphanedProducts: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get all existing document IDs
  const existingDocs = await db.select({ id: documents.id }).from(documents);
  const docIds = new Set(existingDocs.map(d => d.id));

  // Count all records
  const [totalChunks] = await db.select({ count: sql<number>`COUNT(*)` }).from(documentChunks);
  const [totalSections] = await db.select({ count: sql<number>`COUNT(*)` }).from(sections);
  const [totalProducts] = await db.select({ count: sql<number>`COUNT(*)` }).from(products);

  // Count orphaned records
  let orphanedChunks = 0;
  let orphanedSections = 0;
  let orphanedProducts = 0;

  if (docIds.size > 0) {
    const docIdsArray = Array.from(docIds);
    const [orphanedChunksResult] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(documentChunks)
      .where(sql`${documentChunks.documentId} NOT IN (${sql.join(docIdsArray.map(id => sql`${id}`), sql`, `)})`);
    orphanedChunks = orphanedChunksResult.count;

    const [orphanedSectionsResult] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(sections)
      .where(sql`${sections.documentId} NOT IN (${sql.join(docIdsArray.map(id => sql`${id}`), sql`, `)})`);
    orphanedSections = orphanedSectionsResult.count;

    const [orphanedProductsResult] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(products)
      .where(sql`${products.documentId} NOT IN (${sql.join(docIdsArray.map(id => sql`${id}`), sql`, `)})`);
    orphanedProducts = orphanedProductsResult.count;
  } else {
    // If no documents exist, all related records are orphaned
    orphanedChunks = totalChunks.count;
    orphanedSections = totalSections.count;
    orphanedProducts = totalProducts.count;
  }

  return {
    totalDocuments: docIds.size,
    totalChunks: totalChunks.count,
    totalSections: totalSections.count,
    totalProducts: totalProducts.count,
    orphanedChunks,
    orphanedSections,
    orphanedProducts,
  };
}

/**
 * Get system prompt
 */
export async function getSystemPrompt() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(systemPrompts)
    .where(eq(systemPrompts.isActive, true))
    .orderBy(desc(systemPrompts.createdAt))
    .limit(1);

  return result[0] || null;
}

/**
 * Create new system prompt version
 */
export async function createSystemPrompt(
  prompt: string,
  userId: number
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Deactivate previous prompts
  await db
    .update(systemPrompts)
    .set({ isActive: false })
    .where(eq(systemPrompts.isActive, true));

  // Create new prompt
  const result = await db.insert(systemPrompts).values({
    prompt,
    createdBy: userId,
    isActive: true,
  });

  return result[0].insertId as number;
}

/**
 * Get chat history
 */
export async function getChatHistory(limit: number = 50, offset: number = 0) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .select()
    .from(chatHistory)
    .orderBy(desc(chatHistory.createdAt))
    .limit(limit)
    .offset(offset);
}

/**
 * Get chat history for session
 */
export async function getSessionChatHistory(sessionId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .select()
    .from(chatHistory)
    .where(eq(chatHistory.sessionId, sessionId))
    .orderBy(chatHistory.createdAt);
}

/**
 * Get statistics for a date
 */
export async function getStatsByDate(date: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(queryStats)
    .where(eq(queryStats.date, date))
    .limit(1);

  return result[0] || null;
}

/**
 * Update or create daily statistics
 */
export async function updateDailyStats(date: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get stats for the date
  const dayStart = new Date(date);
  const dayEnd = new Date(date);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const queriesForDay = await db
    .select({
      totalQueries: sql<number>`COUNT(*)`,
      avgResponseTime: sql<number>`AVG(responseTime)`,
      websiteQueries: sql<number>`SUM(CASE WHEN source = 'website' THEN 1 ELSE 0 END)`,
      bitrix24Queries: sql<number>`SUM(CASE WHEN source = 'bitrix24' THEN 1 ELSE 0 END)`,
      avgTokensUsed: sql<string>`AVG(tokensUsed)`,
    })
    .from(chatHistory)
    .where(and(gte(chatHistory.createdAt, dayStart)));

  const stats = queriesForDay[0];

  // Upsert stats
  const existing = await getStatsByDate(date);
  if (existing) {
    await db
      .update(queryStats)
      .set({
        totalQueries: stats.totalQueries || 0,
        avgResponseTime: String(stats.avgResponseTime || 0),
        websiteQueries: stats.websiteQueries || 0,
        bitrix24Queries: stats.bitrix24Queries || 0,
        avgTokensUsed: String(stats.avgTokensUsed || 0),
      })
      .where(eq(queryStats.date, date));
  } else {
    await db.insert(queryStats).values({
      date,
      totalQueries: stats.totalQueries || 0,
      avgResponseTime: String(stats.avgResponseTime || 0),
      websiteQueries: stats.websiteQueries || 0,
      bitrix24Queries: stats.bitrix24Queries || 0,
      avgTokensUsed: String(stats.avgTokensUsed || 0),
    });
  }
}

/**
 * Get statistics for last N days
 */
export async function getStatsTrend(days: number = 30) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return await db
    .select()
    .from(queryStats)
    .where(gte(queryStats.date, startDate.toISOString().split("T")[0]))
    .orderBy(queryStats.date);
}

/**
 * Get popular questions
 */
export async function getPopularQuestions(limit: number = 10) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .select({
      query: chatHistory.query,
      count: sql<number>`COUNT(*) as count`,
    })
    .from(chatHistory)
    .groupBy(chatHistory.query)
    .orderBy(desc(sql`count`))
    .limit(limit);
}

/**
 * Document Annotations Functions
 */

/**
 * Get all annotations for a document
 */
export async function getDocumentAnnotations(documentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .select()
    .from(documentAnnotations)
    .where(eq(documentAnnotations.documentId, documentId))
    .orderBy(asc(documentAnnotations.chunkIndex));
}

/**
 * Get annotation for a specific chunk
 */
export async function getChunkAnnotation(documentId: number, chunkIndex: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(documentAnnotations)
    .where(
      and(
        eq(documentAnnotations.documentId, documentId),
        eq(documentAnnotations.chunkIndex, chunkIndex)
      )
    )
    .limit(1);

  return result[0] || null;
}

/**
 * Create or update annotation for a chunk
 */
export async function upsertChunkAnnotation(
  annotation: InsertDocumentAnnotation
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Validate required fields
  if (annotation.documentId === undefined || annotation.documentId === null) {
    throw new Error("documentId is required");
  }
  if (annotation.chunkIndex === undefined || annotation.chunkIndex === null) {
    throw new Error("chunkIndex is required");
  }
  if (!annotation.annotationType) {
    throw new Error("annotationType is required");
  }
  if (annotation.annotatedBy === undefined || annotation.annotatedBy === null) {
    throw new Error("annotatedBy is required");
  }

  // Check if annotation already exists
  const existing = await getChunkAnnotation(annotation.documentId, annotation.chunkIndex);

  if (existing) {
    // Update existing annotation
    await db
      .update(documentAnnotations)
      .set({
        annotationType: annotation.annotationType,
        isNomenclatureTable: annotation.isNomenclatureTable ?? false,
        productGroupId: annotation.productGroupId ?? null,
        notes: annotation.notes ?? null,
        annotatedBy: annotation.annotatedBy,
        updatedAt: new Date(),
      })
      .where(eq(documentAnnotations.id, existing.id));

    return existing.id;
  } else {
    // Create new annotation
    const result = await db.insert(documentAnnotations).values({
      ...annotation,
      isNomenclatureTable: annotation.isNomenclatureTable ?? false,
      productGroupId: annotation.productGroupId ?? null,
      notes: annotation.notes ?? null,
    });
    return result[0].insertId as number;
  }
}

/**
 * Delete annotation for a chunk
 */
export async function deleteChunkAnnotation(documentId: number, chunkIndex: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Validate inputs
  if (documentId === undefined || documentId === null || documentId <= 0) {
    throw new Error("Invalid documentId");
  }
  if (chunkIndex === undefined || chunkIndex === null) {
    throw new Error("Invalid chunkIndex");
  }

  await db
    .delete(documentAnnotations)
    .where(
      and(
        eq(documentAnnotations.documentId, documentId),
        eq(documentAnnotations.chunkIndex, chunkIndex)
      )
    );
}

/**
 * Get all chunks for a document with their annotations
 */
export async function getDocumentChunksWithAnnotations(documentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (documentId === undefined || documentId === null || documentId <= 0) {
    throw new Error("Invalid documentId");
  }

  const chunks = await db
    .select({
      id: documentChunks.id,
      chunkIndex: documentChunks.chunkIndex,
      content: documentChunks.content,
      tokenCount: documentChunks.tokenCount,
      pageNumber: documentChunks.pageNumber,
      sectionPath: documentChunks.sectionPath,
      elementType: documentChunks.elementType,
      tableJson: documentChunks.tableJson,
      language: documentChunks.language,
      chunkMetadata: documentChunks.chunkMetadata,
      createdAt: documentChunks.createdAt,
    })
    .from(documentChunks)
    .where(eq(documentChunks.documentId, documentId))
    .orderBy(asc(documentChunks.chunkIndex));

  const annotations = await getDocumentAnnotations(documentId);
  const annotationMap = new Map<number, typeof annotations[0]>();
  annotations.forEach((ann) => {
    if (ann.chunkIndex !== undefined && ann.chunkIndex !== null) {
      annotationMap.set(ann.chunkIndex, ann);
    }
  });

  return chunks.map((chunk) => ({
    ...chunk,
    annotation: (chunk.chunkIndex !== undefined && chunk.chunkIndex !== null) 
      ? (annotationMap.get(chunk.chunkIndex) || null)
      : null,
  }));
}

/**
 * Product Groups Functions
 */

/**
 * Get all product groups for a document
 */
export async function getDocumentProductGroups(documentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Validate input
  if (documentId === undefined || documentId === null || documentId <= 0) {
    throw new Error("Invalid documentId");
  }

  return await db
    .select()
    .from(productGroups)
    .where(eq(productGroups.documentId, documentId))
    .orderBy(asc(productGroups.name));
}

/**
 * Get product group by ID
 */
export async function getProductGroup(groupId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(productGroups)
    .where(eq(productGroups.id, groupId))
    .limit(1);

  return result[0] || null;
}

/**
 * Create product group
 */
export async function createProductGroup(group: InsertProductGroup): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Validate required fields
  if (group.documentId === undefined || group.documentId === null) {
    throw new Error("documentId is required");
  }
  if (!group.name || typeof group.name !== 'string' || group.name.trim().length === 0) {
    throw new Error("name is required and must be a non-empty string");
  }
  if (group.createdBy === undefined || group.createdBy === null) {
    throw new Error("createdBy is required");
  }

  const result = await db.insert(productGroups).values({
    ...group,
    name: group.name.trim(),
    description: group.description ?? null,
    sectionPath: group.sectionPath ?? null,
    pageStart: group.pageStart ?? null,
    pageEnd: group.pageEnd ?? null,
  });
  return result[0].insertId as number;
}

/**
 * Update product group
 */
export async function updateProductGroup(
  groupId: number,
  updates: Partial<Omit<InsertProductGroup, "id" | "documentId" | "createdBy" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(productGroups)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(productGroups.id, groupId));
}

/**
 * Delete product group
 */
export async function deleteProductGroup(groupId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // First, remove group reference from products
  await db
    .update(products)
    .set({ groupId: null })
    .where(eq(products.groupId, groupId));

  // Then delete the group
  await db.delete(productGroups).where(eq(productGroups.id, groupId));
}

/**
 * Product Items Functions (items inside a product group)
 */

export async function getProductItem(itemId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [row] = await db
    .select()
    .from(productItems)
    .where(eq(productItems.id, itemId))
    .limit(1);

  return row ?? null;
}

export async function getProductItemsByGroup(documentId: number, groupId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .select()
    .from(productItems)
    .where(and(eq(productItems.documentId, documentId), eq(productItems.groupId, groupId)))
    .orderBy(asc(productItems.sortOrder), asc(productItems.name));
}

export async function createProductItem(item: InsertProductItem): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (!item.documentId) throw new Error("documentId is required");
  if (!item.groupId) throw new Error("groupId is required");
  if (!item.name || item.name.trim().length === 0) throw new Error("name is required");
  if (!item.createdBy) throw new Error("createdBy is required");

  const result = await db.insert(productItems).values({
    ...item,
    name: item.name.trim(),
    description: item.description ?? null,
    sortOrder: item.sortOrder ?? 0,
  });
  return result[0].insertId as number;
}

export async function updateProductItem(
  itemId: number,
  updates: Partial<Omit<InsertProductItem, "id" | "documentId" | "groupId" | "createdBy" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const patch: any = { ...updates, updatedAt: new Date() };
  if (typeof patch.name === "string") patch.name = patch.name.trim();
  await db.update(productItems).set(patch).where(eq(productItems.id, itemId));
}

export async function deleteProductItem(itemId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Detach manual regions first
  await db
    .update(manualRegions)
    .set({ productItemId: null })
    .where(eq(manualRegions.productItemId, itemId));

  await db.delete(productItems).where(eq(productItems.id, itemId));
}

/**
 * Get products in a group
 */
export async function getProductsInGroup(groupId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .select()
    .from(products)
    .where(eq(products.groupId, groupId))
    .orderBy(asc(products.sku));
}

/**
 * Add products to group (by updating their groupId)
 */
export async function addProductsToGroup(
  groupId: number,
  productIds: number[]
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (productIds.length === 0) return;

  await db
    .update(products)
    .set({ groupId })
    .where(sql`${products.id} IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})`);
}

/**
 * Remove products from group
 */
export async function removeProductsFromGroup(productIds: number[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (productIds.length === 0) return;

  await db
    .update(products)
    .set({ groupId: null })
    .where(sql`${products.id} IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})`);
}

/**
 * Manual Regions Functions - for manual document annotation
 */

/**
 * Create a manual region (user-selected area on document)
 */
export async function createManualRegion(region: InsertManualRegion): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Validate required fields
  if (region.documentId === undefined || region.documentId === null) {
    throw new Error("documentId is required");
  }
  if (region.pageNumber === undefined || region.pageNumber === null) {
    throw new Error("pageNumber is required");
  }
  if (!region.regionType) {
    throw new Error("regionType is required");
  }
  if (!region.coordinates || !region.coordinates.points || region.coordinates.points.length < 3) {
    throw new Error("coordinates with at least 3 points are required");
  }
  if (region.createdBy === undefined || region.createdBy === null) {
    throw new Error("createdBy is required");
  }

  const result = await db.insert(manualRegions).values({
    ...region,
    isNomenclatureTable: region.isNomenclatureTable ?? false,
    productGroupId: region.productGroupId ?? null,
    notes: region.notes ?? null,
    extractedText: region.extractedText ?? null,
  });
  return result[0].insertId as number;
}

/**
 * Get all manual regions for a document
 */
export async function getDocumentManualRegions(documentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Validate input
  if (documentId === undefined || documentId === null || documentId <= 0) {
    throw new Error("Invalid documentId");
  }

  return await db
    .select()
    .from(manualRegions)
    .where(eq(manualRegions.documentId, documentId))
    .orderBy(asc(manualRegions.pageNumber), asc(manualRegions.id));
}

export async function getManualRegionsByIds(documentId: number, regionIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (!regionIds || regionIds.length === 0) {
    return [];
  }

  const uniqueIds = Array.from(new Set(regionIds));

  return await db
    .select()
    .from(manualRegions)
    .where(
      and(
        eq(manualRegions.documentId, documentId),
        inArray(manualRegions.id, uniqueIds)
      )
    )
    .orderBy(asc(manualRegions.pageNumber), asc(manualRegions.id));
}

/**
 * Get manual region by ID
 */
export async function getManualRegion(regionId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(manualRegions)
    .where(eq(manualRegions.id, regionId))
    .limit(1);

  return result[0] || null;
}

/**
 * Update manual region
 */
export async function updateManualRegion(
  regionId: number,
  updates: Partial<Omit<InsertManualRegion, "id" | "documentId" | "createdBy" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(manualRegions)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(manualRegions.id, regionId));
}

/**
 * Delete manual region
 */
export async function deleteManualRegion(regionId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(manualRegions).where(eq(manualRegions.id, regionId));
}
