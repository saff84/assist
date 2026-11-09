import { afterEach, beforeEach, expect, it, vi } from "vitest";
const files = vi.hoisted(() => ({ mkdir: vi.fn(), appendFile: vi.fn() }));
vi.mock("fs/promises", () => ({ default: files }));
vi.mock("./db", () => ({ getUserById: vi.fn() }));
import { rasterImageType } from "./_core/rasterImage";
import { clientIp, consumeLimit, withRagCapacity } from "./_core/requestLimits";
import { signDocumentUrl, verifyDocumentAccess, requireDocumentAccess } from "./_core/documentAccess";
import { recordWidgetConsent, hasWidgetConsent } from "./widgetConsentReceipt";
import { widgetConsentSchema } from "../shared/widgetConsent";
import { registerFaqImageRoutes } from "./faqImageRoutes";
import { requireKnowledgeAuth } from "./_core/httpAuth";
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("JWT_SECRET", "unit-test-secret-012345678901234567890123456789"); });
afterEach(() => vi.unstubAllEnvs());

it("refuses HTML and SVG uploads regardless of claimed MIME, while allowing raster signatures", () => {
  expect(rasterImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
  expect(rasterImageType(Buffer.from("<!doctype html><script>alert(1)</script>"))).toBeNull();
  expect(rasterImageType(Buffer.from([137,80,78,71,13,10,26,10]))?.mimeType).toBe("image/png");
  expect(rasterImageType(Buffer.from([255,216,255,224]))?.mimeType).toBe("image/jpeg");
});
it("authenticates FAQ uploads before the multipart parser", () => {
  const routes: unknown[][] = [];
  registerFaqImageRoutes({ post: (...args: unknown[]) => routes.push(args), get: vi.fn() } as any);
  expect(routes[0][1]).toBe(requireKnowledgeAuth);
});
it("binds download links to one document and refuses unsigned access", async () => {
  const url = new URL(await signDocumentUrl("/api/documents/12/file?download=1"), "https://test.local");
  const token = url.searchParams.get("access")!;
  expect(url.searchParams.get("download")).toBe("1");
  expect(await verifyDocumentAccess(token, "/api/documents/12/file")).toBe(true);
  expect(await verifyDocumentAccess(token, "/api/documents/13/file")).toBe(false);
  expect(await verifyDocumentAccess(token, "/api/documents/12/companion")).toBe(false);
  const next = vi.fn(), res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await requireDocumentAccess({ cookies: {}, query: {}, path: "/api/documents/12/file" } as any, res as any, next);
  expect(res.status).toHaveBeenCalledWith(401); expect(next).not.toHaveBeenCalled();
});
it("records acceptance before returning a receipt and rejects replay in another session, origin or version", async () => {
  const config = { ...widgetConsentSchema.parse({ enabled: true }), version: "a".repeat(64) };
  const { token } = await recordWidgetConsent(config, "session-one", "https://shop.test");
  expect(files.appendFile).toHaveBeenCalledWith(expect.stringContaining("consent-audit"), expect.stringContaining(config.text), expect.anything());
  expect(await hasWidgetConsent(token, config.version, "session-one", "https://shop.test")).toBe(true);
  expect(await hasWidgetConsent(token, config.version, "session-two", "https://shop.test")).toBe(false);
  expect(await hasWidgetConsent(token, config.version, "session-one", "https://other.test")).toBe(false);
  expect(await hasWidgetConsent(token, "new-version", "session-one", "https://shop.test")).toBe(false);
  expect(await hasWidgetConsent(config.version, config.version, "session-one", "https://shop.test")).toBe(false);
});
it("does not acknowledge consent when the audit journal cannot be saved", async () => {
  files.appendFile.mockRejectedValue(new Error("Disk full"));
  await expect(recordWidgetConsent({ ...widgetConsentSchema.parse({ enabled: true }), version: "a".repeat(64) }, "dialog", "")).rejects.toThrow("Disk full");
});
it("ignores a client-supplied forwarded IP and enforces the request budget", () => {
  expect(clientIp({ ip: "trusted-client", headers: { "x-forwarded-for": "attacker-choice" } } as any)).toBe("trusted-client");
  expect(consumeLimit("security-test-budget", 1)).toBe(true);
  expect(consumeLimit("security-test-budget", 1)).toBe(false);
});
it("limits concurrent public RAG work and releases capacity after errors", async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const jobs = Array.from({ length: 4 }, () => withRagCapacity(() => blocked));
  await expect(withRagCapacity(async () => true)).rejects.toThrow("RAG_CAPACITY_EXCEEDED");
  release(); await Promise.all(jobs);
  await expect(withRagCapacity(async () => { throw new Error("LLM down"); })).rejects.toThrow("LLM down");
  await expect(withRagCapacity(async () => true)).resolves.toBe(true);
});
