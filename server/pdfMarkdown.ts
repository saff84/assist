import fs from "fs";
import path from "path";
import { createRequire } from "module";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem, PDFPageProxy } from "pdfjs-dist/types/src/display/api";

export const PDF_MARKDOWN_VERSION = "layout-v2";
const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
export type PdfWord = {
  id: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type GridLine = { x1: number; y1: number; x2: number; y2: number };
type Table = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  xs: number[];
  ys: number[];
};
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
function unique(values: number[]): number[] {
  return values
    .sort((a, b) => a - b)
    .reduce<number[]>((out, value) => {
      if (!out.length || value - out[out.length - 1] > 1.5) out.push(value);
      return out;
    }, []);
}

/** PDF text is often split inside a word or number. Join by actual positions. */
export function positionedText(words: PdfWord[]): string {
  const lines: Array<{ y: number; words: PdfWord[] }> = [];
  for (const word of [...words].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find(
      line => Math.abs(line.y - word.y) <= Math.max(2, word.height * 0.6)
    );
    if (line) line.words.push(word);
    else lines.push({ y: word.y, words: [word] });
  }
  return lines
    .map(line => {
      let text = "",
        previous: PdfWord | undefined;
      for (const word of line.words.sort((a, b) => a.x - b.x)) {
        if (
          previous &&
          word.x - previous.x - previous.width >
            Math.max(0.8, word.height * 0.16) &&
          !/\s$/.test(text)
        )
          text += " ";
        const superscript =
          previous &&
          word.y - previous.y > previous.height * 0.2 &&
          word.height < previous.height * 0.9 &&
          /^\d+$/.test(word.text);
        text += superscript
          ? word.text.replace(/\d/g, digit => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(digit)])
          : word.text;
        previous = word;
      }
      return text.trim();
    })
    .join("\n");
}

type Matrix = [number, number, number, number, number, number];
const identity: Matrix = [1, 0, 0, 1, 0, 0];
function multiply(a: Matrix, b: number[]): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** Only painted paths count as borders; clipping rectangles are ignored. */
async function pageGrid(page: PDFPageProxy): Promise<GridLine[]> {
  const ops = await page.getOperatorList();
  const lines: GridLine[] = [],
    stack: Matrix[] = [];
  let matrix = identity,
    pending: GridLine[] = [],
    strokePending: GridLine[] = [];
  const paint = new Set<number>([
    pdfjs.OPS.stroke,
    pdfjs.OPS.closeStroke,
    pdfjs.OPS.fill,
    pdfjs.OPS.eoFill,
    pdfjs.OPS.fillStroke,
    pdfjs.OPS.eoFillStroke,
    pdfjs.OPS.closeFillStroke,
    pdfjs.OPS.closeEOFillStroke,
  ]);
  const strokes = new Set<number>([
    pdfjs.OPS.stroke,
    pdfjs.OPS.closeStroke,
    pdfjs.OPS.fillStroke,
    pdfjs.OPS.eoFillStroke,
    pdfjs.OPS.closeFillStroke,
    pdfjs.OPS.closeEOFillStroke,
  ]);
  const add = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    strokeOnly = false
  ) => {
    const point = (x: number, y: number) => [
      matrix[0] * x + matrix[2] * y + matrix[4],
      matrix[1] * x + matrix[3] * y + matrix[5],
    ];
    const a = point(x1, y1),
      b = point(x2, y2);
    if (
      (Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) >= 8) ||
      (Math.abs(a[1] - b[1]) < 1 && Math.abs(a[0] - b[0]) >= 8)
    )
      (strokeOnly ? strokePending : pending).push({
        x1: Math.min(a[0], b[0]),
        y1: Math.min(a[1], b[1]),
        x2: Math.max(a[0], b[0]),
        y2: Math.max(a[1], b[1]),
      });
  };
  ops.fnArray.forEach((operation, i) => {
    const args = ops.argsArray[i];
    if (operation === pdfjs.OPS.save) stack.push([...matrix]);
    else if (operation === pdfjs.OPS.restore) matrix = stack.pop() ?? identity;
    else if (operation === pdfjs.OPS.transform) matrix = multiply(matrix, args);
    else if (operation === pdfjs.OPS.constructPath) {
      const [commands, coords] = args as [number[], number[]];
      let offset = 0,
        x = 0,
        y = 0,
        startX = 0,
        startY = 0;
      for (const command of commands) {
        if (command === pdfjs.OPS.rectangle) {
          const [rx, ry, width, height] = coords.slice(offset, offset + 4);
          offset += 4;
          if (Math.abs(height) <= 2)
            add(rx, ry + height / 2, rx + width, ry + height / 2);
          else if (Math.abs(width) <= 2)
            add(rx + width / 2, ry, rx + width / 2, ry + height);
          else {
            add(rx, ry, rx + width, ry, true);
            add(rx + width, ry, rx + width, ry + height, true);
            add(rx + width, ry + height, rx, ry + height, true);
            add(rx, ry + height, rx, ry, true);
          }
        } else if (command === pdfjs.OPS.moveTo) {
          x = startX = coords[offset++];
          y = startY = coords[offset++];
        } else if (command === pdfjs.OPS.lineTo) {
          const nx = coords[offset++],
            ny = coords[offset++];
          add(x, y, nx, ny);
          x = nx;
          y = ny;
        } else if (command === pdfjs.OPS.closePath) {
          add(x, y, startX, startY);
          x = startX;
          y = startY;
        } else if (command === pdfjs.OPS.curveTo) {
          offset += 4;
          x = coords[offset++];
          y = coords[offset++];
        } else if (
          command === pdfjs.OPS.curveTo2 ||
          command === pdfjs.OPS.curveTo3
        ) {
          offset += 2;
          x = coords[offset++];
          y = coords[offset++];
        }
      }
    } else if (paint.has(operation)) {
      lines.push(...pending);
      if (strokes.has(operation)) lines.push(...strokePending);
      pending = [];
      strokePending = [];
    } else if (operation === pdfjs.OPS.endPath) {
      pending = [];
      strokePending = [];
    }
  });
  return lines;
}

function findTables(lines: GridLine[]): Table[] {
  const visited = new Set<number>(),
    tables: Table[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (visited.has(i)) continue;
    const group: GridLine[] = [],
      queue = [i];
    visited.add(i);
    while (queue.length) {
      const current = lines[queue.pop()!];
      group.push(current);
      lines.forEach((candidate, j) => {
        if (
          !visited.has(j) &&
          candidate.x1 <= current.x2 + 2 &&
          candidate.x2 >= current.x1 - 2 &&
          candidate.y1 <= current.y2 + 2 &&
          candidate.y2 >= current.y1 - 2
        ) {
          visited.add(j);
          queue.push(j);
        }
      });
    }
    const xs = unique(group.filter(l => l.x2 - l.x1 < 1).map(l => l.x1));
    const ys = unique(
      group.filter(l => l.y2 - l.y1 < 1).map(l => l.y1)
    ).reverse();
    if (
      xs.length >= 3 &&
      ys.length >= 3 &&
      xs[xs.length - 1] - xs[0] > 80 &&
      ys[0] - ys[ys.length - 1] > 25
    )
      tables.push({
        left: xs[0],
        right: xs[xs.length - 1],
        top: ys[0],
        bottom: ys[ys.length - 1],
        xs,
        ys,
      });
  }
  return tables;
}

function tableMarkdown(table: Table, words: PdfWord[]): string | null {
  const rows: PdfWord[][][] = Array.from({ length: table.ys.length - 1 }, () =>
    Array.from({ length: table.xs.length - 1 }, () => [])
  );
  for (const word of words) {
    const x = word.x + word.width / 2,
      y = word.y + word.height * 0.3;
    const column = table.xs.findIndex(
      (left, i) =>
        i < table.xs.length - 1 && x >= left - 1 && x <= table.xs[i + 1] + 1
    );
    const row = table.ys.findIndex(
      (top, i) =>
        i < table.ys.length - 1 && y <= top + 1 && y >= table.ys[i + 1] - 1
    );
    if (column < 0 || row < 0) return null;
    rows[row][column].push(word);
  }
  const values = rows.map(row =>
    row.map(items => positionedText(items).replace(/\n/g, " "))
  );
  if (values.length < 2 || values[0].filter(Boolean).length < 2) return null;
  let headerCount = 1;
  if (table.xs.length > 3) {
    const firstData = values.findIndex(
      (row, i) =>
        i > 0 &&
        /^\d{3,}/.test(row[0]) &&
        row.filter(v => /\d/.test(v)).length >= 2
    );
    if (firstData > 0 && firstData <= 3) headerCount = firstData;
  }
  const counts = new Map<string, number>();
  const headers = values[0].map((_, column) => {
    const name =
      values
        .slice(0, headerCount)
        .map(row => row[column])
        .filter(Boolean)
        .join(" ") || `Колонка ${column + 1}`;
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });
  return [
    `| ${headers.map(cell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...values.slice(headerCount).map(row => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

/** Catch omissions even when a table was recognized only partially. Whitespace,
 * bullet glyphs and superscript compatibility forms are formatting, not content. */
export function assertPdfTextCoverage(source: string, markdown: string): void {
  const count = (text: string) => {
    const chars = new Map<string, number>();
    for (const char of text
      .normalize("NFKC")
      .replace(/[\uf067\u2022]/g, "-")
      .replace(/\s/g, ""))
      chars.set(char, (chars.get(char) ?? 0) + 1);
    return chars;
  };
  const expected = count(source),
    actual = count(markdown);
  let missing = 0;
  expected.forEach((amount, char) => {
    missing += Math.max(0, amount - (actual.get(char) ?? 0));
  });
  if (missing)
    throw new Error(
      `Проверка полноты PDF: при преобразовании потеряно символов: ${missing}. Markdown не опубликован.`
    );
}

/** Every text item is emitted exactly once: in a table cell or ordinary text. */
export function layoutPageToMarkdown(
  words: PdfWord[],
  grid: GridLine[]
): { markdown: string; tables: number; covered: number } {
  const consumed = new Set<number>(),
    blocks: Array<{ y: number; x: number; text: string }> = [];
  let tables = 0;
  for (const table of findTables(grid)) {
    const items = words.filter(
      word =>
        !consumed.has(word.id) &&
        word.x + word.width / 2 >= table.left - 1 &&
        word.x + word.width / 2 <= table.right + 1 &&
        word.y + word.height * 0.3 >= table.bottom - 1 &&
        word.y + word.height * 0.3 <= table.top + 1
    );
    const markdown = tableMarkdown(table, items);
    if (!markdown) continue;
    items.forEach(item => consumed.add(item.id));
    blocks.push({ y: table.top, x: table.left, text: markdown });
    tables++;
  }
  const lines: Array<{ y: number; words: PdfWord[] }> = [];
  for (const word of words
    .filter(word => !consumed.has(word.id))
    .sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find(
      line => Math.abs(line.y - word.y) <= Math.max(2, word.height * 0.35)
    );
    if (line) line.words.push(word);
    else lines.push({ y: word.y, words: [word] });
  }
  for (const line of lines) {
    const raw = positionedText(line.words);
    const heading =
      !/\.{3}/.test(raw) &&
      /^\d{1,2}[.]?\s+[А-ЯЁ][А-ЯЁ\s.,()\-A-Z0-9]{4,}$/.test(raw);
    blocks.push({
      y: line.y,
      x: Math.min(...line.words.map(w => w.x)),
      text: heading ? `### ${raw}` : raw.replace(/^\s*[\uf067\u2022]\s*/, "- "),
    });
    line.words.forEach(word => consumed.add(word.id));
  }
  if (consumed.size !== words.length)
    throw new Error(
      "Проверка полноты PDF: часть текста не перенесена в Markdown"
    );
  const markdown = blocks
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map(block => block.text)
    .join("\n\n");
  assertPdfTextCoverage(words.map(word => word.text).join(""), markdown);
  return { markdown, tables, covered: consumed.size };
}

export async function pdfToMarkdown(
  filePath: string,
  title: string
): Promise<string> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(filePath)),
    cMapUrl: path.join(pdfjsRoot, "cmaps") + "/",
    standardFontDataUrl: path.join(pdfjsRoot, "standard_fonts") + "/",
    useSystemFonts: true,
  });
  try {
    const doc = await task.promise,
      pages: string[] = [];
    let characters = 0;
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number),
        text = await page.getTextContent();
      const words: PdfWord[] = text.items
        .filter(
          (item): item is TextItem =>
            "str" in item && item.str.trim().length > 0
        )
        .map((item, id) => ({
          id,
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height:
            item.height || Math.hypot(item.transform[2], item.transform[3]),
        }));
      characters += words.reduce((n, word) => n + word.text.length, 0);
      const result = layoutPageToMarkdown(words, await pageGrid(page));
      pages.push(
        `## Страница ${number}\n\n${words.length ? result.markdown : "> На странице нет извлекаемого текста. Проверьте изображение в PDF; для скана требуется OCR."}`
      );
      page.cleanup();
    }
    if (characters < 80)
      throw new Error(
        "В PDF недостаточно распознаваемого текста. Требуется OCR или подготовленный Markdown."
      );
    return (
      [
        `<!-- pdf-markdown:${PDF_MARKDOWN_VERSION} -->`,
        `# ${title.replace(/[\r\n]/g, " ")}`,
        "> Извлечено из PDF автоматически. Проверьте таблицы, единицы измерения и ограничения по оригиналу. Графики и изображения доступны в PDF.",
        ...pages,
      ].join("\n\n") + "\n"
    );
  } finally {
    await task.destroy();
  }
}
