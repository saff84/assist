import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./documentDb", () => ({
  getAllDocuments: vi.fn(),
  getDocumentById: vi.fn(),
  updateDocumentStatus: vi.fn(),
}));
vi.mock("./installationKnowledge", () => ({
  installationPath: vi.fn(),
  preparePassportKnowledge: vi.fn(),
  indexInstallationMarkdown: vi.fn(),
  hasSamePassportSource: vi.fn(),
}));
vi.mock("./installationReviewStore", () => ({
  readInstallationReview: vi.fn(),
}));
vi.mock("./pdfMarkdown", () => ({ pdfToMarkdown: vi.fn() }));
import * as docs from "./documentDb";
import {
  indexInstallationMarkdown,
  hasSamePassportSource,
  preparePassportKnowledge,
} from "./installationKnowledge";
import { readInstallationReview } from "./installationReviewStore";
import {
  startInstallationReviewRecovery,
  getPassportRepairStatus,
} from "./passportRepair";
import { canRecoverInstallationReview } from "../shared/documentReview";

const candidate = {
  id: 20,
  filename: "passport-10.md",
  title: "Reviewed pipe",
  docType: "installation",
  fileType: "md",
  status: "processing",
  processingMessage: "Ожидает проверки Markdown",
  documentMetadata: {},
  tocJson: [],
  pages: 5,
};
const source = {
  id: 10,
  docType: "passport",
  status: "indexed",
  contentHash: "pdf-hash",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(docs.getAllDocuments).mockResolvedValue([candidate] as any);
  vi.mocked(docs.getDocumentById).mockImplementation(
    async id => (id === 10 ? source : candidate) as any
  );
  vi.mocked(hasSamePassportSource).mockReturnValue(true);
  vi.mocked(readInstallationReview).mockReturnValue(null);
  vi.mocked(indexInstallationMarkdown).mockResolvedValue({ chunks: 12 });
});
const done = async (jobId: string) => {
  await vi.waitFor(() =>
    expect(getPassportRepairStatus(jobId).state).not.toBe("running")
  );
  return getPassportRepairStatus(jobId);
};

describe("recovery of previously indexed documents", () => {
  it("does not treat a new never-approved MD as reviewed", () => {
    expect(
      canRecoverInstallationReview({
        ...candidate,
        documentMetadata: null,
        tocJson: null,
        pages: null,
      })
    ).toBe(false);
    expect(canRecoverInstallationReview(candidate)).toBe(true);
    expect(canRecoverInstallationReview({...candidate,status:"failed",documentMetadata:{customFields:{installationReview:{kind:"manual"},installationRequiresReview:false}}})).toBe(true);
    expect(canRecoverInstallationReview({...candidate,documentMetadata:{customFields:{installationRequiresReview:true}}})).toBe(false);
    expect(canRecoverInstallationReview({...candidate,documentMetadata:{customFields:{installationSourceHash:"new",previousInstallationReview:{sourcePdfHash:"old"}}}})).toBe(false);
  });
  it("reindexes an existing legacy MD without converting or overwriting it", async () => {
    const task = await startInstallationReviewRecovery([20]);
    expect(await done(task.jobId)).toMatchObject({
      state: "done",
      restored: 1,
      errors: [],
    });
    expect(indexInstallationMarkdown).toHaveBeenCalledWith(20, undefined, {
      reviewKind: "recovered",
    });
    expect(preparePassportKnowledge).not.toHaveBeenCalled();
  });
  it("uses the preserved approved snapshot when available", async () => {
    vi.mocked(readInstallationReview).mockReturnValue({
      markdown: "# Original manual corrections",
      review: { sourcePdfHash: "pdf-hash" },
    } as any);
    const task = await startInstallationReviewRecovery([20]);
    await done(task.jobId);
    expect(indexInstallationMarkdown).toHaveBeenCalledWith(
      20,
      "# Original manual corrections",
      { reviewKind: "recovered" }
    );
  });
  it("does not restore approval to a changed PDF", async () => {
    vi.mocked(readInstallationReview).mockReturnValue({
      markdown: "# Old",
      review: { sourcePdfHash: "old-pdf" },
    } as any);
    const task = await startInstallationReviewRecovery([20]);
    expect(await done(task.jobId)).toMatchObject({
      state: "failed",
      restored: 0,
      errors: [
        expect.objectContaining({
          id: 20,
          message: expect.stringContaining("PDF изменился"),
        }),
      ],
    });
    expect(indexInstallationMarkdown).not.toHaveBeenCalled();
  });
  it("continues with other documents after one indexing failure", async () => {
    const second = {
      ...candidate,
      id: 21,
      filename: "passport-11.md",
      title: "Other pipe",
    };
    vi.mocked(docs.getAllDocuments).mockResolvedValue([
      candidate,
      second,
    ] as any);
    vi.mocked(docs.getDocumentById).mockImplementation(
      async id =>
        (id === 10 || id === 11
          ? { ...source, id }
          : id === 21
            ? second
            : candidate) as any
    );
    vi.mocked(indexInstallationMarkdown)
      .mockRejectedValueOnce(new Error("Embedding unavailable"))
      .mockResolvedValue({ chunks: 10 });
    const task = await startInstallationReviewRecovery([20, 21]);
    expect(await done(task.jobId)).toMatchObject({
      state: "done",
      restored: 1,
      processed: 2,
      errors: [
        expect.objectContaining({ id: 20, message: "Embedding unavailable" }),
      ],
    });
    expect(indexInstallationMarkdown).toHaveBeenCalledTimes(2);
  });
});
