import { beforeEach, expect, it, vi } from "vitest";
import { defaultResponseModeration } from "../shared/responseModeration";
const mocks = vi.hoisted(() => ({ pipeline: vi.fn(), read: vi.fn(), record: vi.fn(), llm: vi.fn() }));
vi.mock("./intentPipeline", () => ({ runIntentPipeline: mocks.pipeline }));
vi.mock("./responseModerationStore", () => ({ responseModerationStore: { read: mocks.read, record: mocks.record } }));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.llm }));
import { processRAGQuery } from "./ragModule";
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue(defaultResponseModeration); mocks.record.mockResolvedValue(undefined); });

it.each(["website", "bitrix24", "test"] as const)("checks early pipeline replies before returning them to %s", async source => {
  mocks.pipeline.mockResolvedValue({ response: "Ты идиот", sources: [], responseTime: 1, tokensUsed: 0, needsClarification: true });
  const response = await processRAGQuery({ query: "вопрос", source });
  expect(response.response).toBe(defaultResponseModeration.fallback);
  expect(response.moderated).toBe(true);
  expect(mocks.llm).not.toHaveBeenCalled();
});
it("does not censor or prevent processing a rude user question when the answer is clean", async () => {
  const clean = { response: "Диаметр трубы 16 мм.", sources: [], responseTime: 1, tokensUsed: 10 };
  mocks.pipeline.mockResolvedValue(clean);
  const query = { query: "Ты идиот, какой диаметр трубы?", source: "website" as const };
  expect(await processRAGQuery(query)).toBe(clean);
  expect(mocks.pipeline).toHaveBeenCalledWith(query, undefined, expect.any(Function));
  expect(mocks.record).not.toHaveBeenCalled();
});
