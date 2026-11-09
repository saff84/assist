import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  exec: vi.fn(() => { throw new Error("Python must not run"); }),
  insert: vi.fn(),
}));
vi.mock("child_process", () => ({ execFileSync: mocks.exec }));
vi.mock("./uploadRouter", () => ({
  buildLexicalTerms: () => [], generateChunkEmbedding: vi.fn(),
}));
vi.mock("./documentDb", () => ({
  getDocumentById: async () => ({ id: 1, filename: "fixture.pdf", processingType: "catalog" }),
  getManualRegionsByIds: async () => [{
    id: 1, documentId: 1, pageNumber: 1, regionType: "table",
    coordinates: { normalizedBBox: { x: 0, y: 0, width: 1, height: 1 } },
  }],
  updateManualRegion: vi.fn(), getNextChunkIndex: async () => 0,
  insertDocumentChunks: mocks.insert, getDocumentChunkCount: async () => 1,
  updateDocumentChunksCount: vi.fn(),
}));
import { parsePdfDocument } from "./structuredParser";
import { generateChunkFromRegionSelection } from "./manualChunkGenerator";

let root: string;
let pdfPath: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "assist-no-ocr-"));
  fs.mkdirSync(path.join(root, "uploads", "documents"), { recursive: true });
  pdfPath = path.join(root, "uploads", "documents", "1_fixture.pdf");
  fs.writeFileSync(pdfPath, fixturePdf([
    "BT /F1 12 Tf 40 720 Td (Product | Value) Tj ET\n" +
    "BT /F1 12 Tf 40 700 Td (Pipe SANEXT | 16) Tj ET\n" +
    "BT /F1 12 Tf 40 680 Td (Valve SANEXT | 20) Tj ET",
  ]));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  // Existing server settings must not make the disabled feature mandatory.
  vi.stubEnv("TABLE_EXTRACTOR_REQUIRED", "true");
  vi.stubEnv("TABLE_EXTRACTOR_PYTHON", "nonexistent-python");
  mocks.exec.mockClear();
  mocks.insert.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.unlinkSync(pdfPath);
  fs.rmdirSync(path.dirname(pdfPath));
  fs.rmdirSync(path.join(root, "uploads"));
  fs.rmdirSync(root);
});

it("processes a text PDF with a table without Python even when legacy REQUIRED is true", async () => {
  const result = await parsePdfDocument(pdfPath);
  expect(result.numPages).toBe(1);
  expect(result.elements.map(element => element.content).join(" ")).toContain("Pipe");
  expect(mocks.exec).not.toHaveBeenCalled();
});

it("creates a chunk from a manual table region using PDF coordinates without OCR", async () => {
  fs.writeFileSync(pdfPath, fixturePdf([
    "BT /F1 12 Tf 40 720 Td (Product) Tj ET\n" +
    "BT /F1 12 Tf 300 720 Td (Value) Tj ET\n" +
    "BT /F1 12 Tf 40 700 Td (Pipe SANEXT) Tj ET\n" +
    "BT /F1 12 Tf 300 700 Td (16) Tj ET\n" +
    "BT /F1 12 Tf 40 680 Td (Valve SANEXT) Tj ET\n" +
    "BT /F1 12 Tf 300 680 Td (20) Tj ET",
  ]));
  const result = await generateChunkFromRegionSelection(1, [1], { regenerateEmbeddings: false });
  expect(result.totalChunks).toBe(1);
  const chunk = mocks.insert.mock.calls[0][0][0];
  expect(chunk.content).toContain("Pipe");
  expect(JSON.stringify(chunk.tableJson)).toContain("16");
  expect(mocks.exec).not.toHaveBeenCalled();
});

function fixturePdf(contents: string[]): Buffer {
  const fontId = 3 + contents.length * 2;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${contents.map((_, i) => `${3 + i} 0 R`).join(" ")}] /Count ${contents.length} >>`,
    ...contents.map(
      (_, i) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${3 + contents.length + i} 0 R >>`
    ),
    ...contents.map(
      content =>
        `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
    ),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      ""
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
