import { beforeEach, expect, it, vi } from "vitest";
import { defaultResponseModeration } from "../shared/responseModeration";
const store = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), events: vi.fn(), record: vi.fn() }));
vi.mock("./responseModerationStore", async importOriginal => ({
  ...await importOriginal<typeof import("./responseModerationStore")>(), responseModerationStore: store,
}));
import { responseModerationRouter } from "./responseModerationRouter";
beforeEach(() => { vi.clearAllMocks(); store.read.mockResolvedValue(defaultResponseModeration); store.save.mockImplementation(async value => value); store.events.mockResolvedValue([]); });
it.each([null, { role: "editor", mustChangePassword: false }, { role: "admin", mustChangePassword: true }])("denies settings, preview and journal to unauthorized callers: %j", async user => {
  const caller = responseModerationRouter.createCaller({ user } as any);
  await expect(caller.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller.save(defaultResponseModeration)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller.preview({ text: "пример", settings: defaultResponseModeration })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller.events()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(store.save).not.toHaveBeenCalled();
});
it("admin previews unsaved rules without changing settings or writing a journal entry", async () => {
  const caller = responseModerationRouter.createCaller({ user: { role: "admin", mustChangePassword: false } } as any);
  const result = await caller.preview({ text: "разговор с хамами", settings: { ...defaultResponseModeration, terms: "хам" } });
  expect(result.blocked).toBe(true);
  expect(store.save).not.toHaveBeenCalled(); expect(store.record).not.toHaveBeenCalled();
});
it("admin can save settings and read events, but cannot save a forbidden fallback", async () => {
  const caller = responseModerationRouter.createCaller({ user: { role: "admin", mustChangePassword: false } } as any);
  await caller.save({ ...defaultResponseModeration, enabled: false });
  expect(store.save).toHaveBeenCalledOnce();
  await expect(caller.save({ ...defaultResponseModeration, fallback: "Ты идиот" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(store.save).toHaveBeenCalledOnce();
  await expect(caller.events()).resolves.toEqual([]);
});
