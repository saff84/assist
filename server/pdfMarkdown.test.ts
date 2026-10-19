import { describe, expect, it, vi } from "vitest";
vi.mock("./structuredParser", () => ({ parsePdfDocument: vi.fn() }));
import { structuredPdfToMarkdown } from "./pdfMarkdown";
import { parseMarkdownDocument } from "./markdownParser";
import fs from "fs";
import os from "os";
import path from "path";

describe("PDF to Markdown", () => {
  it("preserves source pages, headings and GFM tables", async () => {
    const markdown = structuredPdfToMarkdown(
      {
        sections: [],
        toc: [],
        products: [],
        numPages: 3,
        elements: [
          {
            pageNumber: 2,
            sectionPath: "1",
            heading: "Монтаж",
            elementType: "text",
            content: "Необходимо соблюдать требования паспорта. ".repeat(4),
          },
          {
            pageNumber: 3,
            sectionPath: "2",
            heading: "Параметры",
            elementType: "table",
            content: "Таблица характеристик",
            tableRows: [{ Артикул: "1234", Давление: "10 | 16 бар" }],
          },
        ],
      },
      "Паспорт трубы"
    );
    expect(markdown).toContain("## Страница 2");
    expect(markdown).toContain("| 1234 | 10 \\| 16 бар |");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "passport-md-"));
    const file = path.join(dir, "passport.md");
    try {
      fs.writeFileSync(file, markdown);
      const parsed = await parseMarkdownDocument(file);
      expect(
        parsed.elements.find(e => e.elementType === "table")?.pageNumber
      ).toBe(3);
      expect(parsed.numPages).toBe(3);
      expect(parsed.elements.find(e => e.elementType === "table")?.tableRows?.[0]).toEqual({ Артикул: "1234", Давление: "10 | 16 бар" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects scans instead of creating an empty knowledge document", () => {
    expect(() =>
      structuredPdfToMarkdown(
        { sections: [], toc: [], products: [], elements: [] },
        "Скан"
      )
    ).toThrow("OCR");
  });
});
