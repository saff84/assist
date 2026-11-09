import { expect, it } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import XLSX from "./xlsx";
import { parseXlsxDocument } from "./structuredParser";

it.each(["xlsx", "biff8"] as const)("reads Russian catalog data and zero values from a real %s workbook", async format => {
  const extension = format === "xlsx" ? "xlsx" : "xls";
  const file = path.join(os.tmpdir(), `sanext-security-${crypto.randomUUID()}.${extension}`);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Артикул", "Наименование", "Диаметр", "Температура"],
    ["5905", "Труба SANEXT", 16, 0],
    ["5906", "Труба SANEXT", 20, 90],
  ]), "Трубы SANEXT");
  try {
    XLSX.writeFile(workbook, file, { bookType: format, codepage: 1251 });
    const parsed = await parseXlsxDocument(file);
    expect(parsed.sections[0]).toMatchObject({ title: "Трубы SANEXT", sectionPath: "1" });
    expect(parsed.products.map(product => product.sku)).toEqual(["5905", "5906"]);
    expect(parsed.elements[0].tableRows?.[0]).toMatchObject({ Артикул: "5905", Наименование: "Труба SANEXT", Диаметр: 16, Температура: 0 });
  } finally { fs.rmSync(file, { force: true }); }
});
