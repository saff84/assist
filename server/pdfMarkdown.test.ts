import { describe, expect, it } from "vitest";
import {
  pdfToMarkdown,
  layoutPageToMarkdown,
  positionedText,
  assertPdfTextCoverage,
  type PdfWord,
  type GridLine,
} from "./pdfMarkdown";
import { parseMarkdownDocument } from "./markdownParser";
import fs from "fs";
import os from "os";
import path from "path";

function fixturePdf(contents: string[]): Buffer {
  const fontId = 3 + contents.length * 2;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${contents.map((_, i) => `${3 + i} 0 R`).join(" ")}] /Count ${contents.length} >>`,
    ...contents.map(
      (_, i) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${3 + contents.length + i} 0 R >>`
    ),
    ...contents.map(
      content =>
        `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
    ),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      ""
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
const text = (x: number, y: number, value: string) =>
  `BT /F1 10 Tf ${x} ${y} Td (${value}) Tj ET`;
const word = (id: number, value: string, x: number, y: number): PdfWord => ({
  id,
  text: value,
  x,
  y,
  width: value.length * 5,
  height: 10,
});

describe("lossless PDF to Markdown", () => {
  it("rejects silent loss of the final sentence", () => {
    expect(() =>
      assertPdfTextCoverage(
        "Pressure 16. Service life 15 years.",
        "Pressure 16."
      )
    ).toThrow("Markdown не опубликован");
  });
  it("reads actual PDF paths and retains text before, after and between tables, including the final sentence", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "passport-layout-"));
    try {
      const source = path.join(dir, "source.pdf"),
        target = path.join(dir, "result.md");
      const table =
        [50, 250, 500].map(x => `${x} 600 0.5 100 re f`).join("\n") +
        "\n" +
        [600, 630, 660, 700].map(y => `50 ${y} 450 0.5 re f`).join("\n");
      fs.writeFileSync(
        source,
        fixturePdf([
          [
            text(50, 750, "Manufacturer and application before the table."),
            table,
            text(55, 680, "Parameter"),
            text(255, 680, "Value"),
            text(55, 645, "Pressure"),
            text(255, 645, "16 bar"),
            text(55, 615, "Kit"),
            text(255, 615, "Valve and TWO adapters"),
            text(
              50,
              550,
              "Task: determine the valve setting. This is prose, not a table."
            ),
          ].join("\n"),
          [
            text(50, 750, "Hydraulic setting starts at 5."),
            text(50, 700, "Calculation result: 3.5."),
            text(50, 50, "Service life at least 15 years. END OF PASSPORT."),
          ].join("\n"),
        ])
      );
      const markdown = await pdfToMarkdown(source, "Test passport");
      expect(markdown).toContain(
        "Manufacturer and application before the table."
      );
      expect(markdown).toContain("| Pressure | 16 bar |");
      expect(markdown).toContain("| Kit | Valve and TWO adapters |");
      expect(markdown).toContain("Task: determine the valve setting.");
      expect(markdown).toContain("Hydraulic setting starts at 5.");
      expect(markdown).toContain(
        "Service life at least 15 years. END OF PASSPORT."
      );
      expect(markdown.match(/^\| ---/gm)).toHaveLength(1);
      fs.writeFileSync(target, markdown);
      const parsed = await parseMarkdownDocument(target);
      expect(parsed.numPages).toBe(2);
      expect(
        parsed.elements.find(element => element.elementType === "table")
          ?.tableRows
      ).toEqual([
        { Parameter: "Pressure", Value: "16 bar" },
        { Parameter: "Kit", Value: "Valve and TWO adapters" },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves short text and does not classify prose as a table", () => {
    const words = [
      word(0, "BEGIN", 10, 100),
      word(1, "Task: determine the pressure.", 10, 70),
      word(2, "END", 10, 10),
    ];
    const result = layoutPageToMarkdown(words, []);
    expect(result.covered).toBe(3);
    expect(result.tables).toBe(0);
    expect(result.markdown).toContain("BEGIN");
    expect(result.markdown).toContain("END");
  });

  it("preserves two separate tables and surrounding text", () => {
    const grid: GridLine[] = [],
      words: PdfWord[] = [];
    for (const top of [700, 400]) {
      [50, 250, 500].forEach(x =>
        grid.push({ x1: x, x2: x, y1: top - 100, y2: top })
      );
      [top, top - 50, top - 100].forEach(y =>
        grid.push({ x1: 50, x2: 500, y1: y, y2: y })
      );
      words.push(
        word(words.length, "Parameter", 55, top - 20),
        word(words.length + 1, "Value", 255, top - 20),
        word(words.length + 2, "Setting", 55, top - 70),
        word(words.length + 3, "5", 255, top - 70)
      );
    }
    words.push(
      word(8, "Between tables", 50, 500),
      word(9, "Final line", 50, 250)
    );
    const result = layoutPageToMarkdown(words, grid);
    expect(result.tables).toBe(2);
    expect(result.covered).toBe(words.length);
    expect(result.markdown).toContain("Between tables");
    expect(result.markdown).toContain("Final line");
  });

  it("joins adjacent PDF fragments without breaking numbers", () => {
    expect(
      positionedText([
        { ...word(0, "1", 10, 50), width: 5 },
        word(1, "6", 15, 50),
      ])
    ).toBe("16");
  });

  it("flattens three header levels and merged size groups, including decimal-flow continuation rows", async () => {
    const fixture = (flows: string[], data: string[][]) => {
      const xs = Array.from({ length: 11 }, (_, i) => 50 + i * 100);
      const ys = [700, 670, 640, 610, 580, 550];
      const grid: GridLine[] = xs.map((x, i) => ({
        x1: x,
        x2: x,
        y1: 550,
        y2: [0, 1, 4, 7, 10].includes(i) ? 700 : 670,
      }));
      ys.forEach((y, i) =>
        grid.push({ x1: i === 1 ? 150 : 50, x2: 1050, y1: y, y2: y })
      );
      const words: PdfWord[] = [];
      const add = (value: string, column: number, row: number, span = 1) => {
        words.push(
          word(
            words.length,
            value,
            xs[column] + span * 50 - value.length * 2.5,
            680 - row * 30
          )
        );
      };
      add("Расход", 0, 0);
      ["16 x 2,2", "20 x 2,8", "25 x 3,5"].forEach((size, i) =>
        add(size, 1 + i * 3, 0, 3)
      );
      [
        "v",
        "20 °C",
        "80 °C",
        "v",
        "20 °C",
        "80 °C",
        "v",
        "20 °C",
        "80 °C",
      ].forEach((label, i) => add(label, i + 1, 1));
      [
        "л/с",
        "м/с",
        "Па/м",
        "Па/м",
        "м/с",
        "Па/м",
        "Па/м",
        "м/с",
        "Па/м",
        "Па/м",
      ].forEach((unit, i) => add(unit, i, 2));
      data.forEach((row, r) =>
        [flows[r], ...row].forEach((value, c) => add(value, c, r + 3))
      );
      return layoutPageToMarkdown(words, grid);
    };
    const first = fixture(
      ["0,01", "0,02"],
      [
        ["0,09", "23", "16", "0,06", "10", "6", "0,04", "4", "1"],
        ["0,19", "45", "54", "0,12", "19", "19", "0,08", "8", "7"],
      ]
    );
    const continuation = fixture(
      ["0.05", "0.06"],
      [
        ["0,47", "355", "279", "0,31", "127", "96", "0,20", "44", "33"],
        ["0,57", "489", "387", "0,37", "175", "136", "0,24", "61", "46"],
      ]
    );
    expect(first.tables).toBe(1);
    expect(continuation.tables).toBe(1);
    expect(first.markdown).not.toContain("Колонка");
    expect(first.markdown).toContain("16 x 2,2 · 20 °C · Па/м");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydraulic-md-"));
    try {
      const file = path.join(dir, "result.md");
      fs.writeFileSync(
        file,
        `## Страница 4\n\n${first.markdown}\n\n## Страница 5\n\nПродолжение таблицы 2\n\n${continuation.markdown}`
      );
      const parsed = await parseMarkdownDocument(file);
      const tables = parsed.elements.filter(
        element => element.elementType === "table"
      );
      expect(tables).toHaveLength(2);
      expect(tables[0].tableRows).toHaveLength(2);
      expect(Object.keys(tables[0].tableRows![0])).toHaveLength(10);
      expect(tables[0].tableRows![0]["16 x 2,2 · 80 °C · Па/м"]).toBe("16");
      expect(tables[1].tableRows![0]["Расход · л/с"]).toBe("0.05");
      expect(tables[1].tableRows![0]["16 x 2,2 · 20 °C · Па/м"]).toBe("355");
      expect(Object.keys(tables[1].tableRows![0])).toEqual(
        Object.keys(tables[0].tableRows![0])
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps source text instead of inventing names for unknown columns", () => {
    const grid: GridLine[] = [50, 250, 500].map(x => ({
      x1: x,
      x2: x,
      y1: 600,
      y2: 700,
    }));
    [600, 650, 700].forEach(y => grid.push({ x1: 50, x2: 500, y1: y, y2: y }));
    const result = layoutPageToMarkdown(
      [
        word(0, "Known", 55, 680),
        word(1, "Entry", 55, 630),
        word(2, "123", 255, 630),
      ],
      grid
    );
    expect(result.tables).toBe(0);
    expect(result.markdown).toContain("123");
    expect(result.markdown).not.toContain("Колонка");
  });

  it("rejects an image-only PDF instead of publishing empty knowledge", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "passport-scan-"));
    try {
      const source = path.join(dir, "scan.pdf");
      fs.writeFileSync(source, fixturePdf([""]));
      await expect(pdfToMarkdown(source, "Scan")).rejects.toThrow("OCR");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
