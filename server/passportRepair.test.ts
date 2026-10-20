import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("fs", () => ({
  default: { existsSync: vi.fn(), writeFileSync: vi.fn() },
}));
vi.mock("./documentDb", () => ({
  getDocumentById: vi.fn(),
  updateDocumentStatus: vi.fn(),
  updateDocumentProgress: vi.fn(),
  deleteDocumentChunks: vi.fn(),
  updateDocumentChunksCount: vi.fn(),
}));
vi.mock("./installationKnowledge", () => ({
  installationPath: (id: number, file: string) => `${id}_${file}`,
  preparePassportKnowledge: vi.fn(),
  indexInstallationMarkdown: vi.fn(),
}));
vi.mock("./pdfMarkdown", () => ({ pdfToMarkdown: vi.fn() }));
import fs from "fs";
import * as docs from "./documentDb";
import {
  preparePassportKnowledge,
  indexInstallationMarkdown,
} from "./installationKnowledge";
import { pdfToMarkdown } from "./pdfMarkdown";
import { startPassportRepair, getPassportRepairStatus } from "./passportRepair";

const passport = {
  id: 10,
  docType: "passport",
  fileType: "pdf",
  filename: "pipe.pdf",
  status: "indexed",
};
const derived = {
  id: 20,
  docType: "installation",
  fileType: "md",
  filename: "passport-10.md",
  status: "indexed",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(docs.getDocumentById).mockImplementation(
    async id => (id === 10 ? passport : derived) as any
  );
  vi.mocked(preparePassportKnowledge).mockResolvedValue({
    id: 20,
    state: "review",
  });
  vi.mocked(indexInstallationMarkdown).mockResolvedValue({ chunks: 12 });
});
const done = async (jobId: string) => {
  await vi.waitFor(() =>
    expect(getPassportRepairStatus(jobId).state).not.toBe("running")
  );
  return getPassportRepairStatus(jobId);
};

describe("selected passport repair", () => {
  it("forces conversion and indexes the existing knowledge document from the PDF", async () => {
    const task = await startPassportRepair(10);
    expect(await done(task.jobId)).toMatchObject({
      state: "done",
      documentId: 20,
      chunks: 12,
    });
    expect(preparePassportKnowledge).toHaveBeenCalledWith(10, { force: true });
    expect(indexInstallationMarkdown).toHaveBeenCalledWith(20);
    expect(docs.updateDocumentStatus).not.toHaveBeenCalledWith(
      10,
      expect.anything(),
      expect.anything()
    );
  });
  it("resolves an MD back to its source passport", async () => {
    const task = await startPassportRepair(20);
    expect(await done(task.jobId)).toMatchObject({
      state: "done",
      documentId: 20,
    });
    expect(preparePassportKnowledge).toHaveBeenCalledWith(10, { force: true });
  });
  it("gives every run a new job ID so the UI cannot reuse a cached completion", async () => {
    const first = await startPassportRepair(20);
    await done(first.jobId);
    const second = await startPassportRepair(20);
    expect(second.jobId).not.toBe(first.jobId);
    expect((await done(second.jobId)).state).toBe("done");
  });
  it("does not run the same passport twice through its PDF and MD cards", async () => {
    let release!: (value: { id: number; state: string }) => void;
    vi.mocked(preparePassportKnowledge).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = resolve;
        })
    );
    const task = await startPassportRepair(10);
    await expect(startPassportRepair(20)).rejects.toThrow("уже обновляется");
    release({ id: 20, state: "review" });
    expect((await done(task.jobId)).state).toBe("done");
  });
  it("reports index failures and keeps failed knowledge out of search", async () => {
    vi.mocked(indexInstallationMarkdown).mockRejectedValueOnce(
      new Error("Ollama unavailable")
    );
    const task = await startPassportRepair(20);
    expect(await done(task.jobId)).toMatchObject({
      state: "failed",
      message: "Ollama unavailable",
    });
    expect(docs.updateDocumentStatus).toHaveBeenCalledWith(
      20,
      "failed",
      "Ollama unavailable"
    );
  });
  it("leaves data untouched when the original PDF is absent", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await expect(startPassportRepair(20)).rejects.toThrow("PDF отсутствует");
    expect(preparePassportKnowledge).not.toHaveBeenCalled();
    expect(indexInstallationMarkdown).not.toHaveBeenCalled();
  });
  it("rebuilds manually uploaded knowledge from its companion PDF", async () => {
    vi.mocked(docs.getDocumentById).mockResolvedValue({
      id: 40,
      docType: "installation",
      fileType: "md",
      filename: "pipe.md",
      downloadFilename: "pipe.pdf",
      title: "Pipe",
    } as any);
    vi.mocked(pdfToMarkdown).mockResolvedValue("# Corrected table");
    const task = await startPassportRepair(40);
    expect(await done(task.jobId)).toMatchObject({
      state: "done",
      documentId: 40,
    });
    expect(pdfToMarkdown).toHaveBeenCalledWith("40_download_pipe.pdf", "Pipe");
    expect(docs.deleteDocumentChunks).toHaveBeenCalledWith(40);
    expect(indexInstallationMarkdown).toHaveBeenCalledWith(40);
  });
});
