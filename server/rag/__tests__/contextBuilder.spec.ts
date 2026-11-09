import { describe, expect, it } from "vitest";

import { buildContext } from "../contextBuilder";

describe("contextBuilder", () => {
  it("limits context by chunks and token budget", () => {
    const result = buildContext(
      [
        {
          documentId: 1,
          filename: "Пособие по монтажу SANEXT.pdf",
          documentType: "instruction",
          sectionPath: "1.1",
          sectionTitle: "Монтаж",
          pageStart: 5,
          pageEnd: 6,
          chunkIndex: 0,
          chunkContent:
            "Перед началом работ убедитесь в герметичности соединений и выполните опрессовку системы.",
          relevance: 0.82,
          boostsApplied: ["installation_instruction_priority"],
        },
        {
          documentId: 2,
          filename: "Каталог фитингов SANEXT.xlsx",
          documentType: "catalog",
          sectionPath: "A.2",
          sectionTitle: "Фитинги",
          pageStart: 12,
          pageEnd: 12,
          chunkIndex: 1,
          chunkContent:
            "Фитинг SANEXT 16x2 имеет рабочее давление 10 бар и комплектуется кольцом EVOH.",
          relevance: 0.74,
          boostsApplied: ["catalog_priority"],
        },
      ],
      {
        maxChunks: 2,
        maxChunksPerDoc: 2,
        maxTokens: 150,
        chunkTokenLimit: 40,
      }
    );

    expect(result.usedSources).toHaveLength(2);
    expect(result.context).toContain("Источник #1");
    expect(result.context).toContain("Документ: Пособие по монтажу SANEXT.pdf");
    expect(result.context).toContain("Страницы: 5–6");
    expect(result.context).toContain("Фрагмент:");
    expect(result.totalTokens).toBeLessThanOrEqual(150);
  });

  it("drops chunks when token budget exceeded", () => {
    const result = buildContext(
      [
        {
          documentId: 1,
          filename: "Пособие по монтажу SANEXT.pdf",
          documentType: "instruction",
          sectionPath: "1.1",
          sectionTitle: "Монтаж",
          pageStart: 5,
          pageEnd: 6,
          chunkIndex: 0,
          chunkContent: "A".repeat(1000),
          relevance: 0.9,
          boostsApplied: [],
        },
        {
          documentId: 2,
          filename: "Каталог SANEXT.xlsx",
          documentType: "catalog",
          sectionPath: "A.2",
          sectionTitle: "Фитинги",
          pageStart: 12,
          pageEnd: 12,
          chunkIndex: 1,
          chunkContent: "B".repeat(1000),
          relevance: 0.8,
          boostsApplied: [],
        },
      ],
      {
        maxChunks: 2,
        maxChunksPerDoc: 2,
        maxTokens: 120,
        chunkTokenLimit: 10,
      }
    );

    expect(result.usedSources).toHaveLength(1);
    expect(result.context).toContain("[Источник #1]");
    expect(result.context).toContain("…»");
    expect(result.totalTokens).toBeLessThanOrEqual(120);
  });

  it("keeps fitting text unchanged and skips an oversized table without cutting rows", () => {
    const source = {
      documentId: 1, filename: "doc.pdf", documentType: "instruction" as const,
      chunkIndex: 0, chunkContent: "Проверьте герметичность соединений.", relevance: 0.9, boostsApplied: [],
    };
    const caps = { maxChunks: 2, maxChunksPerDoc: 2, maxTokens: 80, chunkTokenLimit: 900 };
    const table = { ...source, chunkIndex: 1, chunkContent: "| Параметр | Значение |\n| --- | --- |\n" + "| Давление | 10 бар |\n".repeat(100) };
    const result = buildContext([table, source], caps);
    expect(result.usedSources).toEqual([source]);
    expect(result.context).toContain(`«${source.chunkContent}»`);
    expect(result.context).not.toContain("Параметр");
    expect(result.totalTokens).toBeLessThanOrEqual(caps.maxTokens);
  });

  it.each([20, 21, 40, 41, 120])("retains a long text fragment within a %i-token budget", maxTokens => {
    const source = {
      documentId: 1, filename: "a", documentType: "instruction" as const,
      chunkIndex: 0, chunkContent: "Текст ".repeat(1000), relevance: 0.9, boostsApplied: [],
    };
    const result = buildContext([source], { maxChunks: 1, maxChunksPerDoc: 1, maxTokens, chunkTokenLimit: 900 });
    expect(result.usedSources).toHaveLength(1);
    expect(result.context).toContain("Текст");
    expect(result.totalTokens).toBeLessThanOrEqual(maxTokens);
  });
});

