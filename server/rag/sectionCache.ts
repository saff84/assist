import type { ChunkBaseInfo } from "../documentDb";

const cache = new Map<string, ChunkBaseInfo[]>();
const pending = new Map<string, Promise<ChunkBaseInfo[]>>();

export function invalidateDocumentSectionCache(documentId: number) {
  const prefix = `${documentId}:`;
  cache.forEach((_, key) => {
    if (key.startsWith(prefix)) cache.delete(key);
  });
  pending.forEach((_, key) => {
    if (key.startsWith(prefix)) pending.delete(key);
  });
}

export async function getCachedSectionChunks(
  documentId: number,
  sectionPath: string,
  load: () => Promise<ChunkBaseInfo[]>
) {
  const key = `${documentId}:${sectionPath}`;
  const existing = cache.get(key);
  if (existing) return existing;
  let request = pending.get(key);
  if (!request) {
    request = Promise.resolve().then(load);
    pending.set(key, request);
  }
  try {
    const rows = await request;
    // An old in-flight read must not repopulate the cache after chunk replacement.
    if (pending.get(key) === request) cache.set(key, rows);
    return rows;
  } finally {
    if (pending.get(key) === request) pending.delete(key);
  }
}
