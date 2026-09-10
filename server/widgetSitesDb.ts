import { eq, sql, desc } from "drizzle-orm";
import { getDb } from "./db";
import { widgetSites } from "../drizzle/schema";

export async function trackWidgetOrigin(
  origin: string | undefined,
  kind: "topics" | "chat"
): Promise<void> {
  const normalized = origin?.trim();
  if (!normalized || normalized === "null") return;

  const db = await getDb();
  if (!db) return;

  try {
    const existing = await db
      .select({ id: widgetSites.id })
      .from(widgetSites)
      .where(eq(widgetSites.origin, normalized))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(widgetSites).values({
        origin: normalized,
        requestCount: 1,
        chatCount: kind === "chat" ? 1 : 0,
      });
      return;
    }

    if (kind === "chat") {
      await db
        .update(widgetSites)
        .set({
          requestCount: sql`${widgetSites.requestCount} + 1`,
          chatCount: sql`${widgetSites.chatCount} + 1`,
          lastSeenAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(widgetSites.id, existing[0].id));
    } else {
      await db
        .update(widgetSites)
        .set({
          requestCount: sql`${widgetSites.requestCount} + 1`,
          lastSeenAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(widgetSites.id, existing[0].id));
    }
  } catch (error) {
    console.warn("[Widget] Failed to track origin:", error);
  }
}

export async function listWidgetSites(limit = 100) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(widgetSites)
    .orderBy(desc(widgetSites.lastSeenAt))
    .limit(limit);
}

export async function countWidgetSites(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const rows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(widgetSites);
  return Number(rows[0]?.count ?? 0);
}
