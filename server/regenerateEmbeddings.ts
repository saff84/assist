/**
 * Regenerate embeddings for all document chunks
 * This utility function can be called to reindex existing documents with proper embeddings
 */

import { eq } from "drizzle-orm";

import { documentChunks, documents } from "../drizzle/schema";
import { getDb } from "./db";
import { generateChunkEmbedding } from "./uploadRouter";
import { createStopwordSet, tokenize } from "./rag/textProcessing";
import { getRagConfig } from "./rag/config";

export async function regenerateAllEmbeddings(): Promise<{
  success: boolean;
  processed: number;
  failed: number;
  message: string;
}> {
  const db = await getDb();
  if (!db) {
    return {
      success: false,
      processed: 0,
      failed: 0,
      message: "Database not available",
    };
  }

  try {
    console.log("[Embeddings] 🔄 Starting embeddings regeneration...");

    const config = getRagConfig();
    const stopwords = createStopwordSet(
      config.retrieval.stopwords.extra ?? []
    );

    // Get all indexed chunks
    const chunks = await db
      .select({
        id: documentChunks.id,
        documentId: documentChunks.documentId,
        content: documentChunks.content,
        embedding: documentChunks.embedding,
      })
      .from(documentChunks)
      .innerJoin(documents, eq(documentChunks.documentId, documents.id))
      .where(eq(documents.status, "indexed"));

    console.log(`[Embeddings] Found ${chunks.length} chunks to process`);

    let processed = 0;
    let failed = 0;

    // Батчинг для снижения нагрузки на CPU - по 5 чанков параллельно
    const BATCH_SIZE = 5;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      // Обрабатываем батч параллельно
      const results = await Promise.allSettled(
        batch.map(async (chunk) => {
          try {
            const embedding = await generateChunkEmbedding(chunk.content);
            const tokens = tokenize(chunk.content, stopwords);
            await db
              .update(documentChunks)
              .set({
                embedding: JSON.stringify(embedding),
                bm25Terms: tokens.join(" "),
              })
              .where(eq(documentChunks.id, chunk.id));
            return { success: true };
          } catch (error) {
            console.error(`[Embeddings] Failed for chunk ${chunk.id}:`, error);
            return { success: false };
          }
        })
      );
      
      // Подсчет результатов
      results.forEach((result) => {
        if (result.status === "fulfilled" && result.value.success) {
          processed++;
        } else {
          failed++;
        }
      });

      console.log(
        `[Embeddings] Progress: ${processed + failed}/${chunks.length}`
      );
    }

    const message = `Processed: ${processed}, Failed: ${failed}`;
    console.log(`[Embeddings] ✅ Complete! ${message}`);

    return {
      success: true,
      processed,
      failed,
      message,
    };
  } catch (error) {
    console.error("[Embeddings] Fatal error:", error);
    return {
      success: false,
      processed: 0,
      failed: 0,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Regenerate embeddings for a specific document
 */
export async function regenerateDocumentEmbeddings(documentId: number): Promise<{
  success: boolean;
  processed: number;
  failed: number;
  message: string;
}> {
  const db = await getDb();
  if (!db) {
    return {
      success: false,
      processed: 0,
      failed: 0,
      message: "Database not available",
    };
  }

  try {
    console.log(`[Embeddings] 🔄 Regenerating embeddings for document ${documentId}...`);

    const config = getRagConfig();
    const stopwords = createStopwordSet(
      config.retrieval.stopwords.extra ?? []
    );

    const chunks = await db
      .select({
        id: documentChunks.id,
        content: documentChunks.content,
      })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, documentId));

    console.log(`[Embeddings] Found ${chunks.length} chunks for document ${documentId}`);

    let processed = 0;
    let failed = 0;

    // Батчинг для снижения нагрузки на CPU - по 5 чанков параллельно
    const BATCH_SIZE = 5;
    
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      
      // Обрабатываем батч параллельно
      const results = await Promise.allSettled(
        batch.map(async (chunk) => {
          try {
            const embedding = await generateChunkEmbedding(chunk.content);
            const tokens = tokenize(chunk.content, stopwords);
            await db
              .update(documentChunks)
              .set({
                embedding: JSON.stringify(embedding),
                bm25Terms: tokens.join(" "),
              })
              .where(eq(documentChunks.id, chunk.id));
            return { success: true };
          } catch (error) {
            console.error(`[Embeddings] Failed for chunk ${chunk.id}:`, error);
            return { success: false };
          }
        })
      );
      
      // Подсчет результатов
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value.success) {
          processed++;
        } else {
          failed++;
        }
      });
      
      console.log(`[Embeddings] Document ${documentId} Progress: ${processed + failed}/${chunks.length}`);
    }

    const message = `Processed: ${processed}, Failed: ${failed}`;
    console.log(`[Embeddings] ✅ Complete for document ${documentId}! ${message}`);

    return {
      success: true,
      processed,
      failed,
      message,
    };
  } catch (error) {
    console.error("[Embeddings] Fatal error:", error);
    return {
      success: false,
      processed: 0,
      failed: 0,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

