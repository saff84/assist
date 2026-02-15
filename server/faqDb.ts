import { desc, eq, sql } from "drizzle-orm";
import { faqEntries } from "../drizzle/schema";
import type { InsertFaqEntry } from "../drizzle/schema";
import { getDb } from "./db";

export type FaqImage = {
  key: string;
  filename: string;
  mimeType: string;
  url: string;
};

export async function createFaqEntry(entry: InsertFaqEntry): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(faqEntries).values(entry);
  return result[0].insertId as number;
}

export async function getFaqEntryById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [row] = await db.select().from(faqEntries).where(eq(faqEntries.id, id));
  return row ?? null;
}

export async function deleteFaqEntry(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(faqEntries).where(eq(faqEntries.id, id));
}

export async function updateFaqEntry(
  id: number,
  patch: Partial<
    Pick<
      InsertFaqEntry,
      "title" | "answerText" | "content" | "images" | "embedding" | "bm25Terms" | "tags" | "updatedAt"
    >
  >
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(faqEntries)
    .set({
      ...patch,
      updatedAt: patch.updatedAt ?? new Date(),
    })
    .where(eq(faqEntries.id, id));
}

export async function listFaqEntries(options?: { search?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const search = options?.search?.trim();

  const where =
    search && search.length > 0
      ? sql`${faqEntries.title} LIKE ${`%${search}%`} OR ${faqEntries.answerText} LIKE ${`%${search}%`}`
      : undefined;

  const query = db.select().from(faqEntries);
  const rows = where ? await query.where(where).orderBy(desc(faqEntries.updatedAt)) : await query.orderBy(desc(faqEntries.updatedAt));
  return rows;
}

export async function listAllFaqEntriesForRetrieval() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .select({
      id: faqEntries.id,
      title: faqEntries.title,
      content: faqEntries.content,
      embedding: faqEntries.embedding,
      bm25Terms: faqEntries.bm25Terms,
      images: faqEntries.images,
      tags: faqEntries.tags,
      updatedAt: faqEntries.updatedAt,
    })
    .from(faqEntries)
    .orderBy(desc(faqEntries.updatedAt));
}

export async function hasAnyFaqEntries(): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [row] = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(faqEntries);

  return (row?.cnt ?? 0) > 0;
}
