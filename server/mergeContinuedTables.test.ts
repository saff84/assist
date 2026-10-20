import { expect, it } from "vitest";
import { mergeContinuedTables } from "./mergeContinuedTables";
import { parseMarkdownDocument } from "./markdownParser";
import fs from "fs";
import os from "os";
import path from "path";

const table = (row: string, header = "Flow") => `| ${header} | Pressure |\n| --- | --- |\n| ${row} | 16 |`;
it("joins multiple pages once, retaining all rows, repeated values, notes and page markers", async () => {
  const source = ["## Страница 4", "Таблица 2 – Hydraulic", table("0,01"),
    "Footnote", "## Страница 5", "Продолжение таблицы 2", table("0,02"),
    "## Страница 6", "Окончание таблицы 2", table("0,02"), "END"].join("\n\n");
  const result = mergeContinuedTables(source);
  expect(result.match(/^\| ---/gm)).toHaveLength(1);
  expect(result).toContain("| 0,01 | 16 |\n| 0,02 | 16 |\n| 0,02 | 16 |");
  expect(result).toContain("Footnote");
  expect(result).toContain("## Страница 6");
  expect(result).toContain("END");
  expect(mergeContinuedTables(result)).toBe(result);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "continued-table-"));
  try {
    const file = path.join(dir, "result.md");
    fs.writeFileSync(file, result);
    const parsed = await parseMarkdownDocument(file);
    const tables = parsed.elements.filter(e => e.elementType === "table");
    expect(tables).toHaveLength(1);
    expect(tables[0].tableRows).toHaveLength(3);
    expect(parsed.numPages).toBe(6);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});

it.each([
  ["Продолжение таблицы 3", table("2")],
  ["Продолжение таблицы 2", table("2", "Temperature")],
  ["Продолжение таблицы 2", table("2", "Pressure")],
])("keeps mismatched table parts and reports the reason: %s", (label, next) => {
  const result = mergeContinuedTables(["Таблица 2 – Data", table("1"), label, next].join("\n\n"));
  expect(result.match(/^\| ---/gm)).toHaveLength(2);
  expect(result).toContain("Не удалось объединить");
});

it("does not join similar tables without explicit continuation or across a new section", () => {
  for (const middle of ["## Страница 5", "### 8. NEW SECTION\n\nПродолжение таблицы 2", "Продолжение таблицы 2\n\nUnrelated prose"]) {
    const result = mergeContinuedTables(["Таблица 2 – Data", table("1"), middle, table("2")].join("\n\n"));
    expect(result.match(/^\| ---/gm)).toHaveLength(2);
  }
});
