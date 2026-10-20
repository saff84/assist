import { describe, expect, it, vi } from "vitest";
import {
  getCachedSectionChunks,
  invalidateDocumentSectionCache,
} from "./sectionCache";

describe("section cache after document repair", () => {
  it("reloads repaired chunks while keeping other documents cached", async () => {
    const first = vi.fn().mockResolvedValue([{ content: "old table" }]);
    const other = vi.fn().mockResolvedValue([{ content: "other passport" }]);
    await getCachedSectionChunks(1, "1", first);
    await getCachedSectionChunks(2, "1", other);
    invalidateDocumentSectionCache(1);
    first.mockResolvedValue([{ content: "corrected table" }]);
    expect(await getCachedSectionChunks(1, "1", first)).toEqual([
      { content: "corrected table" },
    ]);
    await getCachedSectionChunks(2, "1", other);
    expect(first).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(1);
  });
  it("does not restore stale table data from an old in-flight request", async () => {
    let release!: (value: any[]) => void;
    const old = getCachedSectionChunks(
      3,
      "1",
      () =>
        new Promise(resolve => {
          release = resolve;
        })
    );
    await Promise.resolve();
    invalidateDocumentSectionCache(3);
    const fresh = vi.fn().mockResolvedValue([{ content: "new" }]);
    await getCachedSectionChunks(3, "1", fresh);
    release([{ content: "old" }]);
    await old;
    expect(await getCachedSectionChunks(3, "1", fresh)).toEqual([
      { content: "new" },
    ]);
    expect(fresh).toHaveBeenCalledTimes(1);
  });
  it("retries loading after a database failure", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue([{ content: "fixed" }]);
    await expect(getCachedSectionChunks(4, "1", load)).rejects.toThrow(
      "database unavailable"
    );
    expect(await getCachedSectionChunks(4, "1", load)).toEqual([
      { content: "fixed" },
    ]);
  });
});
