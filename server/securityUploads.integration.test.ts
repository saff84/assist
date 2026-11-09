import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "http";
const store = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("./_core/httpAuth", () => ({ requireKnowledgeAuth: (req: any, res: any, next: any) => {
  if (req.headers.authorization === "Bearer test-user") next(); else res.status(401).end();
} }));
vi.mock("fs/promises", () => ({ default: {
  mkdir: vi.fn(),
  writeFile: vi.fn(async (file: string, bytes: Buffer) => { store.set(file, bytes); }),
  open: vi.fn(async (file: string) => {
    const bytes = store.get(file); if (!bytes) throw new Error("Not found");
    return { stat: async () => ({ isFile: () => true, size: bytes.length }),
      read: async (target: Buffer) => { bytes.copy(target); return { bytesRead: Math.min(target.length, bytes.length) }; }, close: async () => {} };
  }),
} }));
import { registerFaqImageRoutes } from "./faqImageRoutes";
let server: Server, base: string;
beforeAll(async () => {
  const app = express(); registerFaqImageRoutes(app); server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => store.clear());
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==", "base64");
async function upload(bytes: Buffer, filename: string, authorized = true) {
  const form = new FormData(); form.append("file", new Blob([new Uint8Array(bytes)]), filename);
  return fetch(`${base}/api/faq-images/upload`, { method: "POST", body: form, headers: authorized ? { Authorization: "Bearer test-user" } : {} });
}
it("refuses anonymous uploads before writing data", async () => {
  expect((await upload(png, "image.png", false)).status).toBe(401); expect(store.size).toBe(0);
});
it("keeps the existing one-file multipart upload working for authenticated users", async () => {
  const response = await upload(png, "image.png");
  expect(response.status).toBe(200);
  const image = await response.json();
  expect(image.mimeType).toBe("image/png"); expect(image.url).toMatch(/^\/api\/faq-images\/.*\.png$/);
  expect(store.size).toBe(1);
});
it("does not accept HTML disguised as PNG", async () => {
  expect((await upload(Buffer.from("<html><script>alert(1)</script></html>"), "image.png")).status).toBe(400);
  expect(store.size).toBe(0);
});
