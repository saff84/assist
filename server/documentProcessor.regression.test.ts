import { beforeEach, expect, it, vi } from "vitest";
const parser = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock("./structuredParser", () => ({
  parsePdfDocument: parser.parse, parseDocxDocument: parser.parse, parseXlsxDocument: parser.parse,
}));
vi.mock("./markdownParser", () => ({ parseMarkdownDocument: parser.parse }));
import { processDocument } from "./documentProcessor";
import type { StructuredDocument } from "./structuredParser";

export const fixture: StructuredDocument = {
  title: "Каталог SANEXT", numPages: 2,
  toc: [{ sectionPath: "1", title: "Трубы", level: 1, pageStart: 1, pageEnd: 2 }],
  sections: [{ sectionPath: "1", title: "Трубы", level: 1, pageStart: 1, pageEnd: 2 }],
  products: [{ sku: "5905", name: "Труба SANEXT", sectionPath: "1", pageNumber: 1 }],
  elements: [
    { pageNumber: 1, sectionPath: "1", elementType: "text", heading: "Трубы", content: "Труба SANEXT для водоснабжения. Перед монтажом проверьте соединения." },
    { pageNumber: 1, sectionPath: "1", elementType: "table", heading: "Номенклатура", content: "Номенклатура труб", tableRows: [
      { Артикул: "5905", Наименование: "Труба SANEXT", Диаметр: 16 },
      { Артикул: "5906", Наименование: "Труба SANEXT", Диаметр: 20 },
    ] },
    { pageNumber: 2, sectionPath: "1", elementType: "table", heading: "Технические характеристики", content: "Характеристики труб", tableRows: [
      { Параметр: "Рабочее давление", Значение: 10, Единица: "бар" },
      { Параметр: "Температура", Значение: 0, Единица: "°C" },
    ] },
  ],
};
beforeEach(() => { parser.parse.mockReset(); parser.parse.mockImplementation(async () => structuredClone(fixture)); });

it.each(["catalog", "instruction"] as const)("preserves table columns, values, products and section links for %s", async processingType => {
  const result = await processDocument("catalog.xlsx", processingType);
  expect(result.products).toEqual(expect.arrayContaining([
    expect.objectContaining({ sku: "5905", sectionPath: "1", pageNumber: 1 }),
  ]));
  const rows = result.chunks.flatMap(chunk => chunk.tableRows ?? []);
  expect(rows).toEqual(expect.arrayContaining(fixture.elements.flatMap(element => element.tableRows ?? [])));
  expect(rows.find(row => row.Параметр === "Температура")?.Значение).toBe(0);
  expect(result.chunks.every(chunk => chunk.sectionPath === "1")).toBe(true);
  expect(result.chunks.map(chunk => chunk.chunkIndex)).toEqual(result.chunks.map((_, index) => index));
  expect(result.totalTokens).toBe(result.chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0));
  expect(result.toc).toEqual([{ sectionPath: "1", title: "Трубы", level: 1, pageStart: 1, pageEnd: 2 }]);
});
