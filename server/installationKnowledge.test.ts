import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
    writeFileSync: vi.fn(),
    copyFileSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 200 })),
  },
}));
vi.mock("./documentDb", () => ({
  getDocumentById: vi.fn(),
  getAllDocuments: vi.fn(),
  createDocument: vi.fn(),
  updateDocumentStatus: vi.fn(),
  deleteDocumentChunks: vi.fn(),
  updateDocumentChunksCount: vi.fn(),
  updateDocumentDownloadFilename: vi.fn(),
  updateDocumentSyncRecord: vi.fn(),
  updateDocumentProgress: vi.fn(),
  insertDocumentChunks: vi.fn(),
  replaceDocumentSections: vi.fn(),
  updateDocumentMetadata: vi.fn(),
}));
vi.mock("./pdfMarkdown", () => ({ pdfToMarkdown: vi.fn() }));
vi.mock("./documentProcessor", () => ({ processDocument: vi.fn() }));
vi.mock("./embeddingClient", () => ({ generateEmbeddingVector: vi.fn() }));
vi.mock("./rag/config", () => ({
  getRagConfig: () => ({ retrieval: { stopwords: { extra: [] } } }),
}));
import * as docs from "./documentDb";
import { pdfToMarkdown } from "./pdfMarkdown";
import { processDocument } from "./documentProcessor";
import { generateEmbeddingVector } from "./embeddingClient";
import {
  preparePassportKnowledge,
  indexInstallationMarkdown,
} from "./installationKnowledge";

const passport = {
  id: 10,
  docType: "passport",
  filename: "original.pdf",
  title: "Паспорт",
  uploadedBy: 1,
  syncSourceId: 1,
  contentHash: "new",
  status: "indexed",
};
const derived = {
  id: 20,
  docType: "installation",
  fileType: "md",
  filename: "passport-10.md",
  contentHash: "old",
  syncSourceId: 1,
  status: "indexed",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(docs.getDocumentById).mockImplementation(
    async id => (id === 10 ? passport : derived) as any
  );
  vi.mocked(docs.getAllDocuments).mockResolvedValue([derived] as any);
  vi.mocked(pdfToMarkdown).mockResolvedValue(
    "# Паспорт\n" + "Требования монтажа. ".repeat(10)
  );
  vi.mocked(processDocument).mockResolvedValue({
    chunks: [
      {
        chunkIndex: 0,
        content: "Текст",
        tokenCount: 2,
        sectionPath: "1",
        elementType: "text",
        metadata: { pageRange: "3-4" },
      },
    ],
  } as any);
  vi.mocked(generateEmbeddingVector).mockResolvedValue({
    embedding: [1, 2],
  } as any);
});

describe("installation knowledge lifecycle", () => {
  it("creates a review draft and invalidates previous chunks on PDF changes", async () => {
    expect(await preparePassportKnowledge(10)).toEqual({
      id: 20,
      state: "review",
    });
    expect(docs.deleteDocumentChunks).toHaveBeenCalledWith(20);
    expect(docs.updateDocumentSyncRecord).toHaveBeenCalledWith(
      20,
      expect.objectContaining({ contentHash: "new", status: "processing" })
    );
    expect(generateEmbeddingVector).not.toHaveBeenCalled();
  });
  it("leaves unchanged reviewed knowledge intact", async () => {
    vi.mocked(docs.getAllDocuments).mockResolvedValue([
      { ...derived, contentHash: "new" },
    ] as any);
    expect(await preparePassportKnowledge(10)).toEqual({
      id: 20,
      state: "indexed",
    });
    expect(pdfToMarkdown).not.toHaveBeenCalled();
    expect(docs.deleteDocumentChunks).not.toHaveBeenCalled();
  });
  it("disables stale knowledge if the changed PDF cannot be parsed", async () => {
    vi.mocked(pdfToMarkdown).mockRejectedValueOnce(new Error("OCR"));
    await expect(preparePassportKnowledge(10)).rejects.toThrow("OCR");
    expect(docs.updateDocumentStatus).toHaveBeenCalledWith(
      20,
      "failed",
      expect.any(String)
    );
  });
  it("indexes reviewed content with original page numbers", async () => {
    expect(await indexInstallationMarkdown(20)).toEqual({ chunks: 1 });
    expect(docs.insertDocumentChunks).toHaveBeenCalledWith([
      expect.objectContaining({ pageNumber: 3, embedding: "[1,2]" }),
    ]);
    expect(docs.updateDocumentSyncRecord).toHaveBeenCalledWith(
      20,
      expect.objectContaining({ status: "indexed" })
    );
  });
  it("never reports success when embeddings fail", async () => {
    vi.mocked(generateEmbeddingVector).mockResolvedValueOnce({
      error: "Ollama unavailable",
    } as any);
    await expect(indexInstallationMarkdown(20)).rejects.toThrow(
      "Ollama unavailable"
    );
    expect(docs.insertDocumentChunks).not.toHaveBeenCalled();
    expect(docs.updateDocumentStatus).toHaveBeenLastCalledWith(
      20,
      "failed",
      expect.stringContaining("Ollama")
    );
  });
});
