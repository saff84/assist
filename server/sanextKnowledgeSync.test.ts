import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
  },
}));
vi.mock("./db", () => ({ getUserByEmail: vi.fn(async () => ({ id: 1 })) }));
vi.mock("./documentDb", () => ({
  getDocumentBySourceUrl: vi.fn(),
  createDocument: vi.fn(async () => 10),
  updateDocumentSyncRecord: vi.fn(),
  listDocumentsBySyncSourceId: vi.fn(async () => []),
  updateDocumentStatus: vi.fn(),
}));
vi.mock("./knowledgeSyncSourcesDb", () => ({
  ensureDefaultKnowledgeSyncSources: vi.fn(),
  getKnowledgeSyncSourceById: vi.fn(),
  updateKnowledgeSyncSource: vi.fn(),
}));
vi.mock("./installationKnowledge", () => ({
  preparePassportKnowledge: vi.fn(),
}));
import {
  runSanextKnowledgeSync,
  extractLinksWithRules,
  syncErrorMessage,
} from "./sanextKnowledgeSync";
import * as docs from "./documentDb";
import * as sources from "./knowledgeSyncSourcesDb";
import { preparePassportKnowledge } from "./installationKnowledge";
import { getUserByEmail } from "./db";

const rules = {
  hrefMustContain: "/upload/",
  fileExtension: ".pdf",
  titleSource: "link_text" as const,
  titleStripPrefix: "pdf",
  linkTextMustContain: null,
};
const source = {
  id: 1,
  name: "Сертификаты",
  pageUrl: "https://www.sanext.ru/certificates/",
  docType: "certificate",
  ...rules,
};
const pdf = Buffer.from("%PDF-1.7\n" + "x".repeat(150));
const page =
  '<a href="/upload/one.pdf">pdf Первый</a><a href="/upload/two.pdf">Второй</a>';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getUserByEmail).mockResolvedValue({ id: 1 } as any);
  vi.mocked(sources.getKnowledgeSyncSourceById).mockResolvedValue(
    source as any
  );
  vi.mocked(docs.createDocument).mockResolvedValue(10);
  vi.mocked(docs.listDocumentsBySyncSourceId).mockResolvedValue([]);
});

describe("sync diagnostics", () => {
  it("includes the underlying network error code", () => {
    expect(
      syncErrorMessage(
        new Error("fetch failed", {
          cause: { code: "ENOTFOUND", message: "Host not found" },
        })
      )
    ).toContain("ENOTFOUND");
  });
  it("deduplicates PDF links and preserves readable titles", () => {
    const links = extractLinksWithRules(page + page, source.pageUrl, rules);
    expect(links).toHaveLength(2);
    expect(links[0].title).toBe("Первый");
  });
  it("reports failed downloads and continues with the next file", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(page))
        .mockResolvedValueOnce(new Response("error", { status: 403 }))
        .mockResolvedValueOnce(new Response(pdf))
    );
    const result = await runSanextKnowledgeSync({ sourceId: 1 });
    expect(result.files.map(f => f.outcome)).toEqual(["failed", "added"]);
    expect(result.files[0].stage).toBe("Скачивание PDF");
    expect(result.files[0].message).toContain("403");
  });
  it("reports an HTML response masquerading as a PDF", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(page.slice(0, page.indexOf("<a", 1)))
        )
        .mockResolvedValueOnce(new Response("<html>blocked</html>"))
    );
    const result = await runSanextKnowledgeSync({ sourceId: 1 });
    expect(result.files[0].stage).toBe("Проверка PDF");
    expect(result.added).toBe(0);
  });
  it("reports conversion errors separately from saved passports", async () => {
    vi.mocked(sources.getKnowledgeSyncSourceById).mockResolvedValue({
      ...source,
      docType: "passport",
    } as any);
    vi.mocked(docs.getDocumentBySourceUrl).mockResolvedValue({
      id: 10,
      docType: "passport",
      syncSourceId: 1,
    } as any);
    vi.mocked(preparePassportKnowledge).mockRejectedValue(
      new Error("Требуется OCR")
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(page))
        .mockResolvedValue(new Response(pdf))
    );
    const result = await runSanextKnowledgeSync({ sourceId: 1 });
    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toMatchObject({
      outcome: "failed",
      stage: "PDF → Markdown",
      message: "Требуется OCR",
    });
  });
  it("does not orphan documents when link rules match nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>No files</html>"))
    );
    const result = await runSanextKnowledgeSync({ sourceId: 1 });
    expect(result.errors[0].stage).toBe("Поиск ссылок");
    expect(docs.listDocumentsBySyncSourceId).not.toHaveBeenCalled();
  });
  it("links a successfully prepared passport to its review draft", async () => {
    vi.mocked(sources.getKnowledgeSyncSourceById).mockResolvedValue({
      ...source,
      docType: "passport",
    } as any);
    vi.mocked(docs.getDocumentBySourceUrl).mockResolvedValue({
      id: 10,
      docType: "passport",
      syncSourceId: 1,
    } as any);
    vi.mocked(preparePassportKnowledge).mockResolvedValue({
      id: 20,
      state: "review",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response('<a href="/upload/one.pdf">Паспорт</a>')
        )
        .mockResolvedValue(new Response(pdf))
    );
    const result = await runSanextKnowledgeSync({ sourceId: 1 });
    expect(result.errors).toEqual([]);
    expect(result.files[0]).toMatchObject({
      outcome: "updated",
      stage: "Готово",
      knowledgeId: 20,
    });
  });
});
