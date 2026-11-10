import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { defaultResponseModeration } from "../shared/responseModeration";
import { createResponseModerationStore, validateModerationSettings, type ModerationEvent } from "./responseModerationStore";

let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), "assist-moderation-")); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); });
it("starts enabled with an initial dictionary, persists edits and supports restart", async () => {
  const store = createResponseModerationStore(directory);
  expect(await store.read()).toEqual(defaultResponseModeration);
  await store.save({ ...defaultResponseModeration, enabled: false });
  expect((await createResponseModerationStore(directory).read()).enabled).toBe(false);
  await store.save(defaultResponseModeration);
  expect((await store.read()).enabled).toBe(true);
});
it("rejects a forbidden fallback and keeps the previous good configuration", async () => {
  const store = createResponseModerationStore(directory);
  await store.save(defaultResponseModeration);
  await expect(store.save({ ...defaultResponseModeration, fallback: "Ты идиот" })).rejects.toThrow("Запасной ответ");
  expect((await store.read()).fallback).toBe(defaultResponseModeration.fallback);
});
it("does not silently disable protection on malformed stored settings", async () => {
  const store = createResponseModerationStore(directory);
  await fs.writeFile(path.join(directory, "response-moderation.json"), "{broken");
  await expect(store.read()).rejects.toThrow("настройки модерации");
  await store.save(defaultResponseModeration);
  expect((await store.read()).enabled).toBe(true);
});
it("serializes concurrent events and never stores original questions/answers", async () => {
  const store = createResponseModerationStore(directory);
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => store.record("website", "term", ["идиот"], `private original ${i}`)));
  expect(results.every(result => result.status === "fulfilled")).toBe(true);
  const events = await store.events();
  expect(events).toHaveLength(8);
  expect(new Set(events.map(event => event.id)).size).toBe(8);
  const stored = await fs.readFile(path.join(directory, "response-moderation-events.json"), "utf8");
  expect(stored).not.toContain("private original");
  expect(events[0].responseHash).toMatch(/^[a-f0-9]{64}$/);
});
it("keeps at most 100 recent events and discards old records on append", async () => {
  const store = createResponseModerationStore(directory);
  const existing: ModerationEvent[] = Array.from({ length: 101 }, (_, index) => ({ id: String(index), at: new Date().toISOString(), channel: "test", reason: "term", rules: [], responseHash: "a".repeat(64) }));
  existing[0].at = "2000-01-01T00:00:00Z";
  await fs.writeFile(path.join(directory, "response-moderation-events.json"), JSON.stringify(existing));
  await store.record("test", "term", ["идиот"], "private");
  const result = await store.events();
  expect(result).toHaveLength(100);
  expect(result.some(event => event.id === "0")).toBe(false);
});
it("validates fallback against custom terms as well", () => {
  expect(() => validateModerationSettings({ ...defaultResponseModeration, terms: "ответ" })).toThrow("Запасной ответ");
});
it("rejects malformed journal records instead of returning data that breaks the admin page", async () => {
  const store = createResponseModerationStore(directory);
  await fs.writeFile(path.join(directory, "response-moderation-events.json"), JSON.stringify([{ at: new Date().toISOString() }]));
  await expect(store.events()).rejects.toThrow("журнал модерации");
});
