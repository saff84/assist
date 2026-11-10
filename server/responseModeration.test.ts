import { beforeEach, expect, it, vi } from "vitest";
import { defaultResponseModeration, defaultModerationFallback } from "../shared/responseModeration";
import type { RAGResponse } from "./ragModule";
const store = vi.hoisted(() => ({ read: vi.fn(), record: vi.fn() }));
vi.mock("./responseModerationStore", () => ({ responseModerationStore: store }));
import { moderateAssistantResponse } from "./responseModeration";

const reply = (response: string): RAGResponse => ({ response, responseTime: 20, tokensUsed: 100,
  sources: [{ documentId: 1, filename: "Каталог.pdf", chunkIndex: 0, relevance: 1 }],
  chunks: [{ documentId: 1, chunkIndex: 0, filename: "Каталог.pdf", pageNumber: 1, sectionPath: "1", elementType: "text", relevance: 1, hasTable: false }],
  attachments: [{ type: "document", documentId: 1, filename: "Каталог.pdf", title: "Каталог", fileType: "pdf", docType: "catalog", previewUrl: "/file", downloadUrl: "/download" }],
  diagnostics: { context: "original context", usedSources: [], retrieval: {} as never },
});
beforeEach(() => { vi.clearAllMocks(); store.read.mockResolvedValue(defaultResponseModeration); store.record.mockResolvedValue(undefined); });

it.each(["website", "bitrix24", "test"] as const)("replaces unsafe output and removes side-channel payloads for %s", async channel => {
  const result = await moderateAssistantResponse(reply("Ты идиот"), channel);
  expect(result).toMatchObject({ response: defaultModerationFallback, moderated: true, sources: [], attachments: [] });
  expect(result.chunks).toBeUndefined(); expect(result.diagnostics).toBeUndefined();
  expect(store.record).toHaveBeenCalledWith(channel, "term", expect.any(Array), "Ты идиот");
});
it("returns clean answers unchanged, including their original sources", async () => {
  const input = reply("Диаметр трубы — 16 мм.");
  expect(await moderateAssistantResponse(input, "website")).toBe(input);
  expect(store.record).not.toHaveBeenCalled();
});
it("also checks visible attachment titles and source labels", async () => {
  const input = reply("Вот документ."); input.attachments![0].title = "Идиотский каталог";
  expect((await moderateAssistantResponse(input, "website")).moderated).toBe(true);
});
it("honors the disabled setting", async () => {
  store.read.mockResolvedValue({ ...defaultResponseModeration, enabled: false });
  const input = reply("Ты идиот");
  expect(await moderateAssistantResponse(input, "test")).toBe(input);
  expect(store.record).not.toHaveBeenCalled();
});
it("uses a safe fallback on corrupt settings without failing the request", async () => {
  store.read.mockRejectedValue(new Error("broken config"));
  expect((await moderateAssistantResponse(reply("original text"), "website")).response).toBe(defaultModerationFallback);
  expect(store.record).toHaveBeenCalledWith("website", "settings_error", [], "original text");
});
it("journal errors do not expose the blocked answer or fail the response", async () => {
  store.record.mockRejectedValue(new Error("disk full"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try { expect((await moderateAssistantResponse(reply("Ты идиот"), "website")).response).toBe(defaultModerationFallback); }
  finally { warn.mockRestore(); }
});
