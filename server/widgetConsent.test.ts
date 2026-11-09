import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), rag: vi.fn(), track: vi.fn() }));
vi.mock("./widgetConsentStore", () => ({ readWidgetConsent: mocks.read }));
vi.mock("./ragModule", () => ({ processRAGQuery: mocks.rag }));
vi.mock("./documentDb", () => ({}));
vi.mock("./faqDb", () => ({}));
vi.mock("./widgetSitesDb", () => ({ trackWidgetOrigin: mocks.track }));
vi.mock("fs/promises", () => ({ default: { mkdir: vi.fn(), appendFile: vi.fn() } }));
import { registerWidgetRoutes } from "./widgetRoutes";
import { widgetConsentSchema } from "../shared/widgetConsent";
import { WidgetApiClient, WidgetConsentRequiredError } from "../client/src/widget/api";
import { widgetAdminRouter } from "./widgetAdminRouter";
import { defaultWidgetAppearance } from "../shared/widgetAppearance";
import { recordWidgetConsent } from "./widgetConsentReceipt";

const config = { ...widgetConsentSchema.parse({ enabled: true }), version: "a".repeat(64) };
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("JWT_SECRET", "unit-test-secret-012345678901234567890123456789");
  mocks.read.mockResolvedValue(config);
  mocks.rag.mockResolvedValue({ response: "Ответ", sources: [] });
});

async function chat(consentToken?: string) {
  const routes = new Map<string, Function>();
  registerWidgetRoutes({ get: () => {}, post: (path: string, handler: Function) => routes.set(path, handler) } as any);
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
  await routes.get("/api/widget/chat")!({ body: { query: "Вопрос", sessionId: "dialog", consentToken }, headers: {}, ip: String(Math.random()), socket: {} }, res);
  return res;
}

it.each([undefined, "old-version"])("does not run RAG or track chat without current consent: %s", async version => {
  const res = await chat(version);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith({ error: "CONSENT_REQUIRED", consent: config });
  expect(mocks.rag).not.toHaveBeenCalled();
  expect(mocks.track).not.toHaveBeenCalled();
});
it("answers the original question after acceptance", async () => {
  const { token } = await recordWidgetConsent(config, "dialog", "");
  await chat(token);
  expect(mocks.rag).toHaveBeenCalledWith(expect.objectContaining({ query: "Вопрос", sessionId: "dialog" }), expect.anything());
});
it("keeps the existing chat flow when consent is disabled", async () => {
  mocks.read.mockResolvedValue({ ...config, enabled: false });
  await chat();
  expect(mocks.rag).toHaveBeenCalledOnce();
});
it("does not run RAG when consent settings cannot be read", async () => {
  mocks.read.mockRejectedValue(new Error("Invalid settings"));
  const res = await chat();
  expect(res.status).toHaveBeenCalledWith(500);
  expect(mocks.rag).not.toHaveBeenCalled();
});
it("recognizes changed consent on the client so the question can be retried after acceptance", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "CONSENT_REQUIRED", consent: config }) }));
  try {
    await expect(new WidgetApiClient("").askAssistant({ query: "Вопрос", sessionId: "dialog" })).rejects.toBeInstanceOf(WidgetConsentRequiredError);
  } finally { vi.unstubAllGlobals(); }
});

it.each([null, "editor"])("protects all new widget settings from non-admin access: %s", async role => {
  const caller = widgetAdminRouter.createCaller({ user: role ? { role } : null } as any);
  await expect(caller.getConsent()).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller.saveConsent(config)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller.getAppearance()).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller.saveAppearance(defaultWidgetAppearance)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocks.read).not.toHaveBeenCalled();
});

it("times out stalled consent requests so the user can retry without sending their question", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener("abort", () => reject(new Error("Aborted")));
  }));
  vi.stubGlobal("fetch", fetch);
  try {
    const request = new WidgetApiClient("").getConsent();
    const rejection = expect(request).rejects.toThrow("Aborted");
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe("/api/widget/consent");
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});

it("preserves non-consent conflict error details and reads the response only once", async () => {
  const json = vi.fn().mockResolvedValue({ error: "Another conflict" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json }));
  try {
    await expect(new WidgetApiClient("").askAssistant({ query: "Вопрос", sessionId: "dialog" })).rejects.toThrow("Another conflict");
    expect(json).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});
