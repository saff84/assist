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
  });
});

