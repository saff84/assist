import { afterEach, beforeEach, expect, it, vi } from "vitest";
const rag = vi.hoisted(() => ({ processRAGQuery: vi.fn() }));
vi.mock("./ragModule", () => rag);
import { documentRouter } from "./documentRouter";
import { bitrix24Router } from "./bitrix24Router";
beforeEach(() => { vi.resetAllMocks(); rag.processRAGQuery.mockResolvedValue({ response: "Ответ", sources: [] }); });
afterEach(() => vi.unstubAllEnvs());
const question = { query: "5905", source: "test" as const };
it("does not let anonymous users bypass widget safeguards through tRPC", async () => {
  await expect(documentRouter.createCaller({ user: null } as any).askAssistant(question)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(rag.processRAGQuery).not.toHaveBeenCalled();
});
it("retains the authorized editor test panel", async () => {
  const result = await documentRouter.createCaller({ user: { id: 1, role: "editor", mustChangePassword: false } } as any).askAssistant(question);
  expect(result.response).toBe("Ответ");
  expect(rag.processRAGQuery).toHaveBeenCalledWith(expect.objectContaining({ source: "test", userId: 1 }), expect.objectContaining({ includeDiagnostics: true }));
});
it("refuses unauthenticated Bitrix callbacks and hides integration config", async () => {
  vi.stubEnv("BITRIX24_INBOUND_SECRET", "test-inbound-secret-012345678901234567890123");
  const caller = bitrix24Router.createCaller({ user: null, req: { headers: {}, ip: "bitrix-test" } } as any);
  await expect(caller.webhook({ messageId: "1", text: "5905" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(caller.getConfig()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(rag.processRAGQuery).not.toHaveBeenCalled();
});
it("accepts authenticated Bitrix callbacks and never returns the outgoing secret URL", async () => {
  vi.stubEnv("BITRIX24_INBOUND_SECRET", "test-inbound-secret-012345678901234567890123");
  vi.stubEnv("BITRIX24_WEBHOOK_URL", "https://private.test/secret-token");
  const caller = bitrix24Router.createCaller({ user: { role: "admin" }, req: { headers: { authorization: `Bearer ${process.env.BITRIX24_INBOUND_SECRET}` }, ip: "bitrix-authorized" } } as any);
  expect((await caller.webhook({ messageId: "1", text: "5905" })).success).toBe(true);
  expect(JSON.stringify(await caller.getConfig())).not.toContain("secret-token");
});
