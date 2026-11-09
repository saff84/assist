import type { Request } from "express";

const buckets = new Map<string, { count: number; until: number }>();
export function clientIp(req: Request): string {
  // Express applies the configured proxy trust; never trust the raw header.
  return req.ip || req.socket?.remoteAddress || "unknown";
}
export function consumeLimit(key: string, maximum = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.until <= now) {
    if (buckets.size >= 10_000) {
      for (const [id, entry] of buckets) if (entry.until <= now) buckets.delete(id);
      if (buckets.size >= 10_000) return false;
    }
    bucket = { count: 0, until: now + windowMs };
    buckets.set(key, bucket);
  }
  if (bucket.count >= maximum) return false;
  bucket.count += 1;
  return true;
}
let activeRagRequests = 0;
export async function withRagCapacity<T>(run: () => Promise<T>): Promise<T> {
  if (activeRagRequests >= 4) throw new Error("RAG_CAPACITY_EXCEEDED");
  activeRagRequests += 1;
  try { return await run(); } finally { activeRagRequests -= 1; }
}
