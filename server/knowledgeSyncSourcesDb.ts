import { getDb } from "./db";
import { knowledgeSyncSources, documents } from "../drizzle/schema";
import type { InsertKnowledgeSyncSource, KnowledgeSyncSource } from "../drizzle/schema";
import { eq, desc, asc, and, sql, inArray } from "drizzle-orm";
import * as documentDb from "./documentDb";

const DEFAULT_SOURCES: InsertKnowledgeSyncSource[] = [
  {
    name: "Технические паспорта",
    pageUrl: "https://www.sanext.ru/baza-znaniy/tehnicheskie-pasporta/",
    docType: "passport",
    enabled: true,
    hrefMustContain: "/upload/",
    fileExtension: ".pdf",
    titleSource: "link_text",
    titleStripPrefix: "pdf",
    linkTextMustContain: null,
  },
  {
    name: "Сертификаты",
    pageUrl: "https://www.sanext.ru/baza-znaniy/sertifikaty/",
    docType: "certificate",
    enabled: true,
    hrefMustContain: "/upload/",
    fileExtension: ".pdf",
    titleSource: "link_text",
    titleStripPrefix: "pdf",
    linkTextMustContain: null,
  },
];

/** Ensures table exists even if drizzle 0023 was recorded as no-op before CREATE ran. */
export async function ensureKnowledgeSyncSourcesTable(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS knowledge_sync_sources (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      pageUrl VARCHAR(1024) NOT NULL,
      docType ENUM('certificate','passport') NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      hrefMustContain VARCHAR(255) NOT NULL DEFAULT '/upload/',
      fileExtension VARCHAR(32) NOT NULL DEFAULT '.pdf',
      titleSource ENUM('link_text','filename') NOT NULL DEFAULT 'link_text',
      titleStripPrefix VARCHAR(64) DEFAULT 'pdf',
      linkTextMustContain VARCHAR(255),
      lastSyncedAt TIMESTAMP NULL,
      lastSyncMessage VARCHAR(512),
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX knowledge_sync_sources_docType_idx (docType)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `));
}

export async function ensureDefaultKnowledgeSyncSources(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await ensureKnowledgeSyncSourcesTable();
  const existing = await db.select({ id: knowledgeSyncSources.id }).from(knowledgeSyncSources).limit(1);
  if (existing.length > 0) return;
  for (const row of DEFAULT_SOURCES) {
    await db.insert(knowledgeSyncSources).values(row);
  }
  console.log("[KnowledgeSync] Seeded default passport/certificate sources");
}

export async function listKnowledgeSyncSources(): Promise<KnowledgeSyncSource[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await ensureKnowledgeSyncSourcesTable();
  return await db
    .select()
    .from(knowledgeSyncSources)
    .orderBy(asc(knowledgeSyncSources.docType), asc(knowledgeSyncSources.id));
}

export async function getKnowledgeSyncSourceById(
  id: number
): Promise<KnowledgeSyncSource | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(knowledgeSyncSources)
    .where(eq(knowledgeSyncSources.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listEnabledKnowledgeSyncSources(): Promise<KnowledgeSyncSource[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db
    .select()
    .from(knowledgeSyncSources)
    .where(eq(knowledgeSyncSources.enabled, true))
    .orderBy(asc(knowledgeSyncSources.id));
}

export async function createKnowledgeSyncSource(
  input: InsertKnowledgeSyncSource
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await ensureKnowledgeSyncSourcesTable();
  const result = await db.insert(knowledgeSyncSources).values(input);
  return result[0].insertId as number;
}

export async function updateKnowledgeSyncSource(
  id: number,
  fields: Partial<InsertKnowledgeSyncSource> & {
    lastSyncedAt?: Date | null;
    lastSyncMessage?: string | null;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(knowledgeSyncSources)
    .set({ ...fields, updatedAt: new Date() } as any)
    .where(eq(knowledgeSyncSources.id, id));
}

export async function deleteKnowledgeSyncSource(id: number): Promise<{
  detached: number;
  deletedFailed: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const linked = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      status: documents.status,
      errorMessage: documents.errorMessage,
      chunksCount: documents.chunksCount,
    })
    .from(documents)
    .where(eq(documents.syncSourceId, id));

  let deletedFailed = 0;
  let detached = 0;
  const keepIds: number[] = [];

  for (const doc of linked) {
    // Only hard-delete never-usable write failures (no annotation value)
    const isWriteFailed =
      doc.status === "failed" &&
      Boolean(doc.errorMessage?.includes("Не удалось сохранить файл"));

    if (isWriteFailed) {
      documentDb.removeDocumentUploadFiles(doc.id, doc.filename);
      await documentDb.deleteDocument(doc.id);
      deletedFailed += 1;
    } else {
      // Indexed + soft orphans ("снят со страницы") stay in KB, just detach
      keepIds.push(doc.id);
      detached += 1;
    }
  }

  if (keepIds.length > 0) {
    await db
      .update(documents)
      .set({
        syncSourceId: null,
        // Restore soft-orphans so they remain searchable by title
        status: "indexed",
        processingStage: "completed",
        processingProgress: 100,
        errorMessage: null,
        processingMessage: "Отвязан от удалённого источника синхронизации",
        updatedAt: new Date(),
      } as any)
      .where(inArray(documents.id, keepIds));
  }

  await db.delete(knowledgeSyncSources).where(eq(knowledgeSyncSources.id, id));
  return { detached, deletedFailed };
}

export async function listDocumentsForSyncSource(sourceId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db
    .select({
      id: documents.id,
      title: documents.title,
      filename: documents.filename,
      status: documents.status,
      fileSize: documents.fileSize,
      sourceUrl: documents.sourceUrl,
      sourceSyncedAt: documents.sourceSyncedAt,
      errorMessage: documents.errorMessage,
      uploadedAt: documents.uploadedAt,
    })
    .from(documents)
    .where(eq(documents.syncSourceId, sourceId))
    .orderBy(desc(documents.updatedAt));
}

export async function countDocumentsForSyncSources(
  sourceIds: number[]
): Promise<Record<number, number>> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (!sourceIds.length) return {};
  const rows = await db
    .select({
      syncSourceId: documents.syncSourceId,
      cnt: sql<number>`COUNT(*)`,
    })
    .from(documents)
    .where(
      and(
        sql`${documents.syncSourceId} IS NOT NULL`,
        sql`${documents.syncSourceId} IN (${sql.join(
          sourceIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      )
    )
    .groupBy(documents.syncSourceId);

  const out: Record<number, number> = {};
  for (const id of sourceIds) out[id] = 0;
  for (const row of rows) {
    if (row.syncSourceId != null) out[row.syncSourceId] = Number(row.cnt) || 0;
  }
  return out;
}
