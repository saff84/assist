import { parsePdfDocument, type StructuredDocument } from "./structuredParser";

const cell = (value: unknown) =>
  String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");

/** Serialize extracted content without inventing compatibility or technical facts. */
export function structuredPdfToMarkdown(
  doc: StructuredDocument,
  title: string
): string {
  const elements = doc.elements.filter(
    e => e.content.trim() || e.tableRows?.length
  );
  if (elements.reduce((n, e) => n + e.content.trim().length, 0) < 80) {
    throw new Error(
      "В PDF недостаточно распознаваемого текста. Возможно, это скан: требуется OCR или загрузка подготовленного Markdown."
    );
  }
  const lines = [
    `# ${title.replace(/[\r\n]/g, " ")}`,
    "",
    "> Извлечено из PDF автоматически. Проверьте таблицы, единицы измерения и ограничения по оригиналу.",
    "",
  ];
  const extractedPages = new Set(elements.map(element => element.pageNumber));
  const missingPages = Array.from(
    { length: doc.numPages ?? 0 },
    (_, index) => index + 1
  ).filter(page => !extractedPages.has(page));
  if (missingPages.length)
    lines.push(
      `> Внимание: на страницах ${missingPages.join(", ")} не извлечён текст. Проверьте оригинал: может потребоваться OCR.`,
      ""
    );
  let page = -1;
  let heading = "";
  for (const element of elements) {
    if (element.pageNumber !== page) {
      page = element.pageNumber;
      lines.push(`## Страница ${page}`, "");
      heading = "";
    }
    if (element.heading && element.heading !== heading) {
      heading = element.heading;
      lines.push(`### ${heading.replace(/[\r\n]/g, " ")}`, "");
    }
    if (element.tableRows?.length) {
      const keys = Array.from(
        new Set(element.tableRows.flatMap(row => Object.keys(row)))
      );
      lines.push(
        `| ${keys.map(cell).join(" | ")} |`,
        `| ${keys.map(() => "---").join(" | ")} |`
      );
      for (const row of element.tableRows)
        lines.push(`| ${keys.map(key => cell(row[key])).join(" | ")} |`);
    } else {
      lines.push(element.content);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function pdfToMarkdown(
  filePath: string,
  title: string
): Promise<string> {
  return structuredPdfToMarkdown(await parsePdfDocument(filePath), title);
}
