import fs from "fs";
import type {
  DocumentSection,
  StructuredDocument,
  StructuredElement,
} from "./structuredParser";

/**
 * Parse a Markdown/GFM knowledge file into the same StructuredDocument
 * shape used by PDF/DOCX processors. Headings become sections; pipe tables
 * become table elements with typed rows — ideal for RAG (no OCR noise).
 */
export async function parseMarkdownDocument(
  filePath: string
): Promise<StructuredDocument> {
  const raw = fs.readFileSync(filePath, "utf-8");
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const sections: DocumentSection[] = [];
  const elements: StructuredElement[] = [];

  let title: string | undefined;
  let currentSectionPath = "root";
  let currentHeading = pathBasenameTitle(filePath);
  let sectionCounter = 0;
  let buffer: string[] = [];
  const pageNumber = 1;
  let hasExplicitHeading = false;

  const flushText = () => {
    const content = buffer.join("\n").trim();
    buffer = [];
    if (!content) return;
    elements.push({
      pageNumber,
      sectionPath: currentSectionPath,
      heading: currentHeading,
      elementType: "text",
      content,
      language: "ru",
    });
  };

  const ensureRootSection = () => {
    if (sections.length > 0) return;
    sections.push({
      sectionPath: "root",
      title: currentHeading,
      level: 1,
      pageStart: pageNumber,
      pageEnd: pageNumber,
      isNumericSection: false,
    });
  };

  const startSection = (level: number, headingTitle: string) => {
    flushText();
    hasExplicitHeading = true;
    sectionCounter += 1;
    currentHeading = headingTitle.trim() || `Раздел ${sectionCounter}`;
    currentSectionPath = String(sectionCounter);
    if (!title && level <= 2) {
      title = currentHeading;
    }
    sections.push({
      sectionPath: currentSectionPath,
      title: currentHeading,
      level: Math.min(Math.max(level, 1), 6),
      pageStart: pageNumber,
      pageEnd: pageNumber,
      isNumericSection: true,
    });
  };

  const parseTableBlock = (
    startIndex: number
  ): { endIndex: number; rows: Array<Record<string, string>>; markdown: string } | null => {
    const headerLine = lines[startIndex]?.trim() ?? "";
    if (!headerLine.includes("|")) return null;
    const divider = lines[startIndex + 1]?.trim() ?? "";
    if (!/^\|?\s*:?-{3,}/.test(divider)) return null;

    const splitRow = (line: string) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());

    const headers = splitRow(headerLine).filter((h) => h.length > 0);
    if (headers.length === 0) return null;

    const rows: Array<Record<string, string>> = [];
    let i = startIndex + 2;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line.includes("|") || line.startsWith("#")) break;
      if (!line || /^```/.test(line)) break;
      const cells = splitRow(line);
      if (cells.every((c) => !c)) {
        i += 1;
        continue;
      }
      const row: Record<string, string> = {};
      headers.forEach((header, idx) => {
        row[header] = cells[idx] ?? "";
      });
      rows.push(row);
      i += 1;
    }

    if (rows.length === 0) return null;
    return {
      endIndex: i - 1,
      rows,
      markdown: lines.slice(startIndex, i).join("\n"),
    };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      startSection(headingMatch[1].length, headingMatch[2]);
      continue;
    }

    if (line.trim().startsWith("|") && i + 1 < lines.length) {
      const table = parseTableBlock(i);
      if (table) {
        flushText();
        if (currentSectionPath === "root") ensureRootSection();
        elements.push({
          pageNumber,
          sectionPath: currentSectionPath,
          heading: currentHeading,
          elementType: "table",
          content: table.markdown,
          tableRows: table.rows,
          language: "ru",
        });
        i = table.endIndex;
        continue;
      }
    }

    if (/^```/.test(line.trim())) {
      buffer.push(line);
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buffer.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) buffer.push(lines[i]);
      continue;
    }

    buffer.push(line);
  }

  flushText();
  if (elements.length > 0 && sections.length === 0) {
    ensureRootSection();
  }
  if (!hasExplicitHeading && sections.length === 0) {
    ensureRootSection();
  }

  return {
    title: title || pathBasenameTitle(filePath),
    numPages: 1,
    sections,
    toc: sections,
    elements,
    products: [],
  };
}

function pathBasenameTitle(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() || "Документ";
  return base.replace(/\.[^.]+$/i, "").replace(/[_-]+/g, " ").trim() || "Документ";
}
