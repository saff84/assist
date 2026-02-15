import fs from "fs";
import path from "path";
import { createRequire } from "module";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

import type { InsertDocumentChunk, ManualRegion } from "../drizzle/schema";
import * as documentDb from "./documentDb";
import { buildLexicalTerms, generateChunkEmbedding } from "./uploadRouter";
import { stripFootnoteMarkers } from "../shared/text";

const moduleRequire = createRequire(import.meta.url);
const PDFJS_BASE_PATH = path.dirname(moduleRequire.resolve("pdfjs-dist/package.json"));
const CMAP_PATH = path.join(PDFJS_BASE_PATH, "cmaps") + "/";
const STANDARD_FONT_PATH = path.join(PDFJS_BASE_PATH, "standard_fonts") + "/";

type NormalizedBBox = { x: number; y: number; width: number; height: number };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const LINE_THRESHOLD_FACTOR = 0.008;
const POSITION_TOLERANCE = 2;

const VARIANT_NEUTRAL_TERMS = new Set([
  "труба",
  "труб",
  "трубы",
  "трубн",
  "sanext",
  "санекст",
  "pex",
  "pe",
  "pexa",
  "pe-xa",
  "px",
  "pn",
  "sdr",
]);

type SearchMetadata = {
  original: string;
  normalized: string | null;
  slug: string | null;
  tokens: string[];
};

const CLEAN_TOKEN_REGEX = /[^0-9a-zа-яё]+/giu;

function tokenizeForMetadata(value?: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ё/g, "е")
    .split(CLEAN_TOKEN_REGEX)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function buildVariantMetadata(value?: string | null): SearchMetadata | null {
  if (!value) return null;
  const original = value.trim();
  if (!original) return null;
  const tokens = tokenizeForMetadata(original);
  if (!tokens.length) {
    return {
      original,
      normalized: null,
      slug: null,
      tokens: [],
    };
  }
  const filtered = tokens.filter((token) => !VARIANT_NEUTRAL_TERMS.has(token));
  if (!filtered.length) {
    return {
      original,
      normalized: null,
      slug: null,
      tokens: [],
    };
  }
  const normalized = filtered.join(" ").trim();
  const slug = filtered.join("-");
  return {
    original,
    normalized: normalized || null,
    slug: slug || null,
    tokens: Array.from(new Set(filtered)),
  };
}

function buildGroupMetadata(value?: string | null): SearchMetadata | null {
  if (!value) return null;
  const original = value.trim();
  if (!original) return null;
  const tokens = tokenizeForMetadata(original);
  if (!tokens.length) {
    return {
      original,
      normalized: null,
      slug: null,
      tokens: [],
    };
  }
  const normalized = tokens.join(" ").trim();
  const slug = tokens.join("-");
  return {
    original,
    normalized: normalized || null,
    slug: slug || null,
    tokens: Array.from(new Set(tokens)),
  };
}

interface TextItemWithPosition {
  text: string;
  x: number;
  y: number;
}

function estimateTokenCount(text: string): number {
  if (!text) return 0;
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(wordCount, Math.round(text.length / 4));
}

function detectLanguage(text: string): string {
  if (/[А-ЯЁа-яё]/.test(text)) return "ru";
  if (/[A-Za-z]/.test(text)) return "en";
  return "unknown";
}

function mapRegionTypeToElement(regionType: ManualRegion["regionType"]): "text" | "table" | "figure" | "list" {
  if (regionType === "faq_question" || regionType === "faq_answer" || regionType === "certificate_answer") {
    return "text";
  }
  if (regionType === "table_with_articles") {
    return "table";
  }
  return regionType;
}

function determineElementTypeFromRegions(
  regions: ManualRegion[]
): "text" | "table" | "figure" | "list" {
  if (
    regions.some(
      (region) =>
        region.regionType === "table" || region.regionType === "table_with_articles"
    )
  ) {
    return "table";
  }
  if (regions.some((region) => region.regionType === "figure")) {
    return "figure";
  }
  if (regions.some((region) => region.regionType === "list")) {
    return "list";
  }
  return "text";
}

function resolveNormalizedBBox(region: ManualRegion): NormalizedBBox | null {
  const coords = region.coordinates;
  if (!coords) return null;

  if (coords.normalizedBBox) {
    return coords.normalizedBBox;
  }

  const scaleAtCapture = coords.scaleAtCapture ?? 1;
  if (coords.bbox && coords.pageDimensions) {
    const displayWidth = coords.pageDimensions.width * scaleAtCapture;
    const displayHeight = coords.pageDimensions.height * scaleAtCapture;
    if (displayWidth > 0 && displayHeight > 0) {
      return {
        x: clamp(coords.bbox.x / displayWidth, 0, 1),
        y: clamp(coords.bbox.y / displayHeight, 0, 1),
        width: clamp(coords.bbox.width / displayWidth, 0, 1),
        height: clamp(coords.bbox.height / displayHeight, 0, 1),
      };
    }
  }

  if (coords.points && coords.points.length > 0 && coords.pageDimensions) {
    const xs = coords.points.map((p) => p.x);
    const ys = coords.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const displayWidth = coords.pageDimensions.width * scaleAtCapture;
    const displayHeight = coords.pageDimensions.height * scaleAtCapture;
    if (displayWidth > 0 && displayHeight > 0) {
      return {
        x: clamp(minX / displayWidth, 0, 1),
        y: clamp(minY / displayHeight, 0, 1),
        width: clamp((maxX - minX) / displayWidth, 0, 1),
        height: clamp((maxY - minY) / displayHeight, 0, 1),
      };
    }
  }

  return null;
}

function groupTextItemsIntoLines(
  items: TextItemWithPosition[],
  pageHeight: number
): string {
  if (!items.length) {
    return "";
  }

  const lineThreshold = Math.max(
    LINE_THRESHOLD_FACTOR * pageHeight,
    POSITION_TOLERANCE * 2
  );

  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) < lineThreshold) {
      return a.x - b.x;
    }
    return a.y - b.y;
  });

  const lines: string[] = [];
  let currentLine: string[] = [];
  let currentY: number | null = null;

  sorted.forEach((item) => {
    if (!item.text) {
      return;
    }
    if (currentY === null || Math.abs(item.y - currentY) < lineThreshold) {
      currentLine.push(item.text);
      currentY = currentY === null ? item.y : (currentY + item.y) / 2;
    } else {
      lines.push(currentLine.join(" "));
      currentLine = [item.text];
      currentY = item.y;
    }
  });

  if (currentLine.length > 0) {
    lines.push(currentLine.join(" "));
  }

  return stripFootnoteMarkers(lines.join("\n").replace(/\s+\n/g, "\n").trim());
}

function buildTableRowsFromItems(
  items: TextItemWithPosition[],
  pageWidth: number,
  pageHeight: number
): string[][] | null {
  if (!items.length) {
    return null;
  }

  const rowThreshold = Math.max(
    LINE_THRESHOLD_FACTOR * pageHeight,
    POSITION_TOLERANCE * 2
  );
  // Column spacing should be tied to page width, not height.
  const columnThreshold = Math.max(pageWidth * 0.02, POSITION_TOLERANCE * 6);

  const sorted = [...items].sort((a, b) => a.y - b.y);
  const rows: Array<{ y: number; cells: Array<{ x: number; text: string }> }> =
    [];

  sorted.forEach((item) => {
    if (!item.text) return;
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(item.y - lastRow.y) < rowThreshold) {
      lastRow.cells.push({ x: item.x, text: item.text });
    } else {
      rows.push({
        y: item.y,
        cells: [{ x: item.x, text: item.text }],
      });
    }
  });

  if (rows.length < 2) {
    return null;
  }

  rows.forEach((row) => row.cells.sort((a, b) => a.x - b.x));

  const anchors: number[] = [];
  rows.forEach((row) => {
    row.cells.forEach((cell) => {
      const existingIndex = anchors.findIndex(
        (anchor) => Math.abs(anchor - cell.x) < columnThreshold
      );
      if (existingIndex === -1) {
        anchors.push(cell.x);
      } else {
        anchors[existingIndex] =
          (anchors[existingIndex] + cell.x) / 2;
      }
    });
  });

  if (anchors.length < 2) {
    return null;
  }

  const sortedAnchors = [...anchors].sort((a, b) => a - b);

  const rowsWithColumns = rows.map((row) => {
    const cells = new Array(sortedAnchors.length).fill("");
    row.cells.forEach((cell) => {
      const idx = findClosestColumn(sortedAnchors, cell.x);
      if (idx === -1) return;
      cells[idx] = cells[idx]
        ? `${cells[idx]} ${cell.text}`.trim()
        : cell.text.trim();
    });
    return cells;
  });

  return rowsWithColumns;
}

function findClosestColumn(anchors: number[], value: number): number {
  if (!anchors.length) return -1;
  let closestIndex = 0;
  let closestDistance = Math.abs(anchors[0] - value);
  for (let i = 1; i < anchors.length; i += 1) {
    const distance = Math.abs(anchors[i] - value);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = i;
    }
  }
  return closestIndex;
}

function convertTableRowsToRecords(
  rows: string[][] | null,
  headersOverride?: string[]
): Array<Record<string, string>> | null {
  if (!rows || !rows.length) return null;
  const meaningfulRows = rows.filter((row) =>
    row.some((cell) => cell && cell.trim().length > 0)
  );
  if (!meaningfulRows.length) return null;

  if (headersOverride && headersOverride.length) {
    const normalized = meaningfulRows.map((row) => {
      const arr = row.map((cell) => cell?.trim() ?? "");
      while (arr.length < headersOverride.length) {
        arr.push("");
      }
      return arr;
    });

    return normalized.map((row) => {
      const record: Record<string, string> = {};
      headersOverride.forEach((column, idx) => {
        record[column] = row[idx] ?? "";
      });
      return record;
    });
  }

  if (meaningfulRows.length < 2) return null;

  const headerIndex = meaningfulRows.findIndex(
    (row) => row.filter((cell) => cell && cell.trim().length > 0).length >= 2
  );
  if (headerIndex === -1) return null;

  const headerRow = meaningfulRows[headerIndex].map((cell, idx) =>
    cell && cell.trim().length > 0 ? cell.trim() : `Колонка ${idx + 1}`
  );
  const columnNames = ensureUniqueHeaders(headerRow);

  const dataRows = meaningfulRows
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell && cell.trim().length > 0));

  if (!dataRows.length) return null;

  return dataRows.map((row) => {
    const record: Record<string, string> = {};
    columnNames.forEach((column, idx) => {
      record[column] = row[idx]?.trim() ?? "";
    });
    return record;
  });
}

function ensureUniqueHeaders(headers: string[]): string[] {
  const counts = new Map<string, number>();
  return headers.map((header) => {
    const key = header || "Колонка";
    const current = counts.get(key) ?? 0;
    counts.set(key, current + 1);
    if (current === 0) {
      return key;
    }
    return `${key} ${current + 1}`;
  });
}

function mergeTableJsonArrays(
  tables: Array<Array<Record<string, string>>>
): Array<Record<string, string>> | null {
  if (!tables.length) {
    return null;
  }

  let referenceColumns: string[] | null = null;
  const merged: Array<Record<string, string>> = [];
  let invalidStructure = false;

  tables.forEach((table) => {
    if (!table.length || invalidStructure) return;
    const columns = Object.keys(table[0]);
    if (!columns.length) return;
    if (!referenceColumns) {
      referenceColumns = columns;
    } else if (
      columns.length !== referenceColumns.length ||
      columns.some((col, idx) => col !== referenceColumns![idx])
    ) {
      invalidStructure = true;
      return;
    }
    merged.push(...table);
  });

  if (invalidStructure || !referenceColumns || !merged.length) {
    return null;
  }

  return merged;
}

function deriveTableStructure(rows: string[][] | null): TableStructure | null {
  if (!rows || !rows.length) return null;
  const width = Math.max(...rows.map((row) => row.length));
  if (!width) return null;

  const normalized = rows.map((row) => {
    const arr = row.map((cell) => sanitizeCellValue(cell));
    while (arr.length < width) {
      arr.push("");
    }
    return arr;
  });

  let headerEnd = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    const row = normalized[i];
    const nonEmpty = row.filter((cell) => cell.length > 0).length;
    if (!nonEmpty) {
      headerEnd = i + 1;
      continue;
    }
    const alphaCells = row.filter(hasAlpha).length;
    const digitCells = row.filter(hasDigit).length;
    if (
      alphaCells >= Math.max(1, Math.round(nonEmpty * 0.6)) &&
      digitCells <= Math.round(nonEmpty * 0.5)
    ) {
      headerEnd = i + 1;
    } else {
      break;
    }
  }

  if (headerEnd === 0) {
    headerEnd = 1;
  }

  const headerRows = normalized.slice(0, headerEnd);
  const bodyRows = normalized
    .slice(headerEnd)
    .filter((row) => row.some((cell) => cell.length > 0));
  if (!bodyRows.length) {
    return null;
  }

  const headers = new Array(width).fill("");
  headerRows.forEach((row) => {
    row.forEach((cell, idx) => {
      if (!cell) return;
      headers[idx] = headers[idx] ? `${headers[idx]} ${cell}`.trim() : cell;
    });
  });

  const cleaned = pruneTableColumns(headers, bodyRows);
  if (!cleaned.headers.length) {
    return null;
  }

  const uniqueHeaders = ensureUniqueHeaders(cleaned.headers);

  return {
    headers: uniqueHeaders,
    rows: cleaned.rows,
  };
}

function pruneTableColumns(headers: string[], rows: string[][]) {
  const keepIndexes: number[] = [];

  headers.forEach((header, idx) => {
    const headerNormalized = header.trim();
    const nonEmptyCells = rows.filter(
      (row) => (row[idx] ?? "").trim().length > 0
    ).length;
    const isPlaceholder =
      headerNormalized.length === 0 ||
      /^колон/iu.test(headerNormalized) ||
      /^column/i.test(headerNormalized);

    if (!isPlaceholder || nonEmptyCells > 1) {
      keepIndexes.push(idx);
    }
  });

  if (!keepIndexes.length) {
    keepIndexes.push(
      ...headers.map((_, idx) => idx).slice(0, Math.min(headers.length, 3))
    );
  }

  const filteredHeaders = keepIndexes.map((idx) => headers[idx]?.trim() || "");
  const filteredRows = rows.map((row) =>
    keepIndexes.map((idx) => row[idx]?.trim() || "")
  );

  return { headers: filteredHeaders, rows: filteredRows };
}

function sanitizeCellValue(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function hasAlpha(value: string | undefined): boolean {
  if (!value) return false;
  return /[A-Za-zА-Яа-яЁё]/.test(value);
}

function hasDigit(value: string | undefined): boolean {
  if (!value) return false;
  return /\d/.test(value);
}

interface ExtractedRegionContent {
  text: string;
  tableMatrix?: string[][];
  tableJson?: Array<Record<string, string>>;
  tableStructure?: TableStructure | null;
  tableTitle?: string | null;
}

interface TableStructure {
  headers: string[];
  rows: string[][];
}

type ManualItemGroup = {
  groupId: number;
  groupName: string;
  itemId: number;
  itemName: string;
};

async function extractTextForRegion(
  page: pdfjsLib.PDFPageProxy,
  viewport: pdfjsLib.PageViewport,
  region: ManualRegion,
  normalizedBBox: NormalizedBBox
): Promise<ExtractedRegionContent> {
  const textContent = await page.getTextContent();
  const tolerance = POSITION_TOLERANCE;
  const bounds = {
    minX: normalizedBBox.x * viewport.width,
    maxX: (normalizedBBox.x + normalizedBBox.width) * viewport.width,
    minY: normalizedBBox.y * viewport.height,
    maxY: (normalizedBBox.y + normalizedBBox.height) * viewport.height,
  };

  const itemsWithPosition: TextItemWithPosition[] = (textContent.items as TextItem[])
    .map((item) => {
      const raw = (item.str || "").replace(/\s+/g, " ").trim();
      if (!raw) {
        return null;
      }
      const [vx, vy] = viewport.convertToViewportPoint(
        item.transform[4],
        item.transform[5]
      );
      return {
        text: raw,
        x: vx,
        y: vy,
      };
    })
    .filter((entry): entry is TextItemWithPosition => Boolean(entry));

  const filtered = itemsWithPosition.filter(
    (item) =>
      item.x >= bounds.minX - tolerance &&
      item.x <= bounds.maxX + tolerance &&
      item.y >= bounds.minY - tolerance &&
      item.y <= bounds.maxY + tolerance
  );

  const plainText = groupTextItemsIntoLines(filtered, viewport.height);

  let tableMatrix: string[][] | undefined;
  let tableStructure: TableStructure | null = null;
  let tableJson: Array<Record<string, string>> | null = null;
  const isTableRegion =
    region.regionType === "table" ||
    region.regionType === "table_with_articles" ||
    region.isNomenclatureTable;

  if (isTableRegion) {
    const rows = buildTableRowsFromItems(filtered, viewport.width, viewport.height);
    if (rows && rows.length) {
      tableMatrix = rows;
      tableStructure = deriveTableStructure(rows);
      // Important: when we derived headers, we must use ONLY body rows for JSON.
      // Otherwise header/title rows end up in data and the table looks "shifted".
      const rowsForJson = tableStructure?.rows ?? rows;
      const headersForJson = tableStructure?.headers;
      tableJson = convertTableRowsToRecords(rowsForJson, headersForJson);
    }
  }

  return {
    text: plainText,
    tableMatrix,
    tableJson: tableJson ?? undefined,
    tableStructure,
    tableTitle: typeof region.notes === "string" ? region.notes : null,
  };
}

export async function generateChunksFromManualRegions(
  documentId: number,
  options?: { regenerateEmbeddings?: boolean; annotatedByUserId?: number }
) {
  const document = await documentDb.getDocumentById(documentId);
  if (!document) {
    throw new Error("Документ не найден");
  }

  const isPassportDoc =
    document.docType === "passport" || document.processingType === "passport";
  const passportTitle =
    (typeof document.title === "string" ? document.title : "")
      .trim() || "Паспорт";

  const manualRegions = await documentDb.getDocumentManualRegions(documentId);
  if (manualRegions.length === 0) {
    throw new Error("Нет сохранённых областей для ручной разметки");
  }

  const uploadsDir = path.join(process.cwd(), "uploads", "documents");
  const pdfPath = path.resolve(uploadsDir, `${documentId}_${document.filename}`);
  if (!fs.existsSync(pdfPath)) {
    throw new Error("Файл документа не найден. Загрузите документ заново.");
  }

  const pdfData = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjsLib.getDocument({
    data: pdfData,
    cMapUrl: CMAP_PATH,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_PATH,
    useSystemFonts: true,
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;
  const regionsByPage = new Map<number, ManualRegion[]>();
  manualRegions.forEach((region) => {
    const collection = regionsByPage.get(region.pageNumber) ?? [];
    collection.push(region);
    regionsByPage.set(region.pageNumber, collection);
  });

  const chunkRecords: InsertDocumentChunk[] = [];
  const warnings: string[] = [];
  let chunkIndex = 0;
  let skippedRegions = 0;

  for (const [pageNumber, regions] of regionsByPage.entries()) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });

    for (const region of regions) {
      const normalizedBBox = resolveNormalizedBBox(region);
      if (!normalizedBBox) {
        warnings.push(
          `Область #${region.id ?? "?"} на странице ${region.pageNumber} не содержит координат`
        );
        skippedRegions += 1;
        continue;
      }

      const extracted = await extractTextForRegion(
        page,
        viewport,
        region,
        normalizedBBox
      );

      const extractedText = extracted.text;

      if (!extractedText) {
        warnings.push(
          `Не удалось извлечь текст из области #${region.id ?? "?"} на странице ${region.pageNumber}`
        );
        skippedRegions += 1;
        continue;
      }

      if (region.id) {
        await documentDb.updateManualRegion(region.id, {
          extractedText,
        });
      }

      const passportSection =
        typeof region.notes === "string" ? region.notes.trim() : "";
      if (isPassportDoc && passportSection.length === 0) {
        warnings.push(
          `Паспорт: область #${region.id ?? "?"} (стр. ${region.pageNumber}) без подзаголовка`
        );
      }

      const content = isPassportDoc
        ? `Паспорт: ${passportTitle}${
            passportSection ? `\nРаздел: ${passportSection}` : ""
          }\n\n${extractedText}`.trim()
        : extractedText;

      let embeddingVector: number[] | null = null;
      if (options?.regenerateEmbeddings !== false) {
        try {
          embeddingVector = await generateChunkEmbedding(content);
        } catch (error) {
          console.error(
            `[ManualChunkGenerator] Failed to generate embedding for region ${region.id}:`,
            error
          );
          warnings.push(
            `Эмбеддинг не сгенерирован для области #${region.id ?? "?"} (Ollama может ещё загружать модель). Чанк создан без эмбеддинга.`
          );
        }
      }

      chunkRecords.push({
        documentId,
        chunkIndex,
        content,
        tokenCount: estimateTokenCount(content),
        embedding: embeddingVector ? JSON.stringify(embeddingVector) : null,
        pageNumber: region.pageNumber,
        sectionPath: isPassportDoc
          ? [passportTitle, passportSection].filter(Boolean).join(" — ")
          : null,
        elementType: mapRegionTypeToElement(region.regionType),
        tableJson: extracted.tableJson ?? null,
        language: detectLanguage(content),
        bm25Terms: buildLexicalTerms(content),
        chunkMetadata: {
          annotationType: region.regionType,
          isManualRegion: true,
          manualRegionId: region.id,
          isNomenclatureTable: region.isNomenclatureTable,
          productGroupId: region.productGroupId,
          notes: region.notes,
          passportTitle: isPassportDoc ? passportTitle : null,
          passportSection: isPassportDoc ? passportSection || null : null,
          bbox: region.coordinates?.normalizedBBox ?? normalizedBBox,
        },
      });

      chunkIndex += 1;
    }
  }

  await documentDb.deleteDocumentChunks(documentId);
  await documentDb.deleteDocumentAnnotations(documentId);

  if (chunkRecords.length > 0) {
    await documentDb.insertDocumentChunks(chunkRecords);
  }

  if (options?.annotatedByUserId) {
    for (const chunk of chunkRecords) {
      const rawType = (chunk.chunkMetadata as any)?.annotationType as string | undefined;
      const annotationType =
        rawType === "table" || rawType === "table_with_articles" || rawType === "figure" || rawType === "list"
          ? (rawType as "table" | "table_with_articles" | "figure" | "list")
          : "text";
      const rawNotes = (chunk.chunkMetadata as any)?.notes as string | null | undefined;
      await documentDb.upsertChunkAnnotation({
        documentId,
        chunkIndex: chunk.chunkIndex,
        annotationType,
        isNomenclatureTable: Boolean((chunk.chunkMetadata as any)?.isNomenclatureTable),
        productGroupId: ((chunk.chunkMetadata as any)?.productGroupId as number | null | undefined) ?? null,
        notes: rawNotes ?? null,
        annotatedBy: options.annotatedByUserId,
      });
    }
  }

  await documentDb.updateDocumentChunksCount(documentId, chunkRecords.length);
  await documentDb.updateDocumentProgress(
    documentId,
    "completed",
    100,
    chunkRecords.length
      ? `Создано чанков: ${chunkRecords.length}`
      : "Ручные области обработаны, но текст не найден"
  );

  return {
    createdChunks: chunkRecords.length,
    skippedRegions,
    warnings,
  };
}

/**
 * Generate one chunk per product item (inside a product group).
 * Each item == one logical product in the catalog (variant).
 */
export async function generateChunksFromManualProductItems(
  documentId: number,
  options?: { regenerateEmbeddings?: boolean; annotatedByUserId?: number }
) {
  const document = await documentDb.getDocumentById(documentId);
  if (!document) {
    throw new Error("Документ не найден");
  }

  const manualRegions = await documentDb.getDocumentManualRegions(documentId);
  if (manualRegions.length === 0) {
    throw new Error("Нет сохранённых областей для ручной разметки");
  }

  const regionsWithItem = manualRegions.filter(
    (r) => typeof (r as any).productItemId === "number" && (r as any).productItemId
  );
  const warnings: string[] = [];
  const skippedRegions = manualRegions.length - regionsWithItem.length;
  if (skippedRegions > 0) {
    warnings.push(
      `Пропущено областей без выбранного товара: ${skippedRegions}. Назначьте товар для области и повторите.`
    );
  }

  const uploadsDir = path.join(process.cwd(), "uploads", "documents");
  const pdfPath = path.resolve(uploadsDir, `${documentId}_${document.filename}`);
  if (!fs.existsSync(pdfPath)) {
    throw new Error("Файл документа не найден. Загрузите документ заново.");
  }

  const pdfData = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjsLib.getDocument({
    data: pdfData,
    cMapUrl: CMAP_PATH,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_PATH,
    useSystemFonts: true,
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;

  // Collect item metadata
  const itemIds = Array.from(
    new Set(
      regionsWithItem
        .map((r) => (r as any).productItemId as number)
        .filter((id) => typeof id === "number" && id > 0)
    )
  );

  const items: ManualItemGroup[] = [];
  for (const itemId of itemIds) {
    const item = await documentDb.getProductItem(itemId);
    if (!item) {
      warnings.push(`Товар #${itemId} не найден (области будут пропущены)`);
      continue;
    }
    const group = await documentDb.getProductGroup(item.groupId);
    if (!group || group.documentId !== documentId) {
      warnings.push(
        `Группа товара #${itemId} недоступна (области будут пропущены)`
      );
      continue;
    }
    items.push({
      groupId: group.id,
      groupName: group.name,
      itemId: item.id,
      itemName: item.name,
    });
  }

  if (items.length === 0) {
    throw new Error("Нет товаров для генерации чанков");
  }

  const chunkRecords: InsertDocumentChunk[] = [];

  // For each item, extract all its regions text/tables and build one chunk
  for (const it of items) {
    const regions = regionsWithItem
      .filter((r) => (r as any).productItemId === it.itemId)
      .sort((a, b) => {
        if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
        return (a.id ?? 0) - (b.id ?? 0);
      });

    const pageCache = new Map<number, pdfjsLib.PDFPageProxy>();
    const viewportCache = new Map<number, pdfjsLib.PageViewport>();

    const regionTexts: Array<{
      region: ManualRegion;
      text: string;
      tableJson?: Array<Record<string, string>> | null;
      tableStructure?: TableStructure | null;
      tableTitle?: string | null;
      normalizedBBox: NormalizedBBox;
    }> = [];

    for (const region of regions) {
      const normalizedBBox = resolveNormalizedBBox(region);
      if (!normalizedBBox) {
        warnings.push(
          `Область #${region.id ?? "?"} товара "${it.itemName}" не содержит координат`
        );
        continue;
      }

      let page = pageCache.get(region.pageNumber);
      if (!page) {
        page = await pdf.getPage(region.pageNumber);
        pageCache.set(region.pageNumber, page);
      }
      let viewport = viewportCache.get(region.pageNumber);
      if (!viewport) {
        viewport = page.getViewport({ scale: 1 });
        viewportCache.set(region.pageNumber, viewport);
      }

      const extracted = await extractTextForRegion(
        page,
        viewport,
        region,
        normalizedBBox
      );
      const extractedText = extracted.text;
      if (!extractedText) {
        warnings.push(
          `Не удалось извлечь текст из области #${region.id ?? "?"} товара "${it.itemName}"`
        );
        continue;
      }

      if (region.id) {
        await documentDb.updateManualRegion(region.id, { extractedText });
      }

      regionTexts.push({
        region,
        text: extractedText,
        tableJson: extracted.tableJson ?? null,
        tableStructure: extracted.tableStructure ?? null,
        tableTitle: extracted.tableTitle ?? region.notes ?? null,
        normalizedBBox,
      });
    }

    if (regionTexts.length === 0) continue;

    const combinedText = regionTexts
      .map((e) => e.text)
      .filter((t) => t && t.trim().length > 0)
      .join("\n\n")
      .trim();
    if (!combinedText) continue;

    const tableCandidates = regionTexts
      .map((e) => e.tableJson)
      .filter(
        (t): t is Array<Record<string, string>> => Array.isArray(t) && t.length > 0
      );
    const mergedTableJson = mergeTableJsonArrays(tableCandidates);

    const variantInfo = buildVariantMetadata(it.itemName);
    const groupInfo = buildGroupMetadata(it.groupName);
    const metadataTagSet = new Set<string>();
    (groupInfo?.tokens ?? []).forEach((t) => metadataTagSet.add(t));
    (variantInfo?.tokens ?? []).forEach((t) => metadataTagSet.add(t));
    if (groupInfo?.slug) metadataTagSet.add(`product:${groupInfo.slug}`);
    if (variantInfo?.slug) metadataTagSet.add(`variant:${variantInfo.slug}`);

    const sectionPath = `${it.groupName} — ${it.itemName}`.slice(0, 512);
    const content = combinedText;

    let embeddingVector: number[] | null = null;
    if (options?.regenerateEmbeddings !== false) {
      try {
        embeddingVector = await generateChunkEmbedding(content);
      } catch (error) {
        console.error(
          `[ManualChunkGenerator] Failed to generate embedding for item ${it.itemId}:`,
          error
        );
        warnings.push(
          `Эмбеддинг не сгенерирован для товара "${it.itemName}". Чанк создан без эмбеддинга.`
        );
      }
    }

    const elementType = determineElementTypeFromRegions(
      regionTexts.map((e) => e.region)
    );

    chunkRecords.push({
      documentId,
      chunkIndex: chunkRecords.length,
      content,
      tokenCount: estimateTokenCount(content),
      embedding: embeddingVector ? JSON.stringify(embeddingVector) : null,
      pageNumber: Math.min(
        ...regionTexts.map((e) => e.region.pageNumber ?? Number.MAX_SAFE_INTEGER)
      ),
      sectionPath,
      elementType,
      tableJson: mergedTableJson ?? null,
      language: detectLanguage(content),
      bm25Terms: buildLexicalTerms(content),
      chunkMetadata: {
        annotationType: "manual_product_item",
        isManualRegion: true,
        productGroupId: it.groupId,
        productGroupName: it.groupName,
        productVariantName: it.itemName,
        productVariantNormalized: variantInfo?.normalized ?? null,
        productVariantSlug: variantInfo?.slug ?? null,
        tags: Array.from(metadataTagSet),
        manualRegionIds: regionTexts
          .map((e) => e.region.id)
          .filter((id): id is number => typeof id === "number"),
        productItemId: it.itemId,
        productItemName: it.itemName,
        regions: regionTexts.map((e) => ({
          regionId: e.region.id,
          pageNumber: e.region.pageNumber,
          type: e.region.regionType,
          bbox: e.normalizedBBox,
          text: e.text,
          tableJson: e.tableJson ?? null,
          tableStructure: e.tableStructure ?? null,
          tableTitle: e.tableTitle ?? null,
          isNomenclatureTable: e.region.isNomenclatureTable ?? false,
          notes: (e.region as any).notes ?? null,
        })),
      } as any,
    });
  }

  await documentDb.deleteDocumentChunks(documentId);
  await documentDb.deleteDocumentAnnotations(documentId);
  if (chunkRecords.length > 0) {
    await documentDb.insertDocumentChunks(chunkRecords);
  }

  if (options?.annotatedByUserId) {
    for (const chunk of chunkRecords) {
      const md = (chunk.chunkMetadata as any) ?? {};
      await documentDb.upsertChunkAnnotation({
        documentId,
        chunkIndex: chunk.chunkIndex,
        annotationType: "manual_region_group",
        isNomenclatureTable: Boolean(md?.isNomenclatureTable),
        productGroupId: (md?.productGroupId as number | null) ?? null,
        notes: (md?.productVariantName as string | null) ?? null,
        annotatedBy: options.annotatedByUserId,
      });
    }
  }

  await documentDb.updateDocumentChunksCount(documentId, chunkRecords.length);
  await documentDb.updateDocumentProgress(
    documentId,
    "completed",
    100,
    chunkRecords.length
      ? `Создано товарных чанков: ${chunkRecords.length}`
      : "Товарные области обработаны, но чанки не созданы"
  );

  return {
    createdChunks: chunkRecords.length,
    skippedRegions,
    warnings,
  };
}

export async function generateWarrantyFaqChunksFromManualRegions(
  documentId: number,
  options?: { regenerateEmbeddings?: boolean }
) {
  const document = await documentDb.getDocumentById(documentId);
  if (!document) {
    throw new Error("Документ не найден");
  }

  const manualRegions = await documentDb.getDocumentManualRegions(documentId);
  const faqRegions = manualRegions.filter(
    (region) => region.regionType === "faq_question" || region.regionType === "faq_answer"
  );

  if (faqRegions.length === 0) {
    throw new Error("Нет сохранённых областей FAQ (вопрос/ответ)");
  }

  const uploadsDir = path.join(process.cwd(), "uploads", "documents");
  const pdfPath = path.resolve(uploadsDir, `${documentId}_${document.filename}`);
  if (!fs.existsSync(pdfPath)) {
    throw new Error("Файл документа не найден. Загрузите документ заново.");
  }

  const pdfData = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjsLib.getDocument({
    data: pdfData,
    cMapUrl: CMAP_PATH,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_PATH,
    useSystemFonts: true,
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;
  const pageCache = new Map<number, pdfjsLib.PDFPageProxy>();
  const viewportCache = new Map<number, pdfjsLib.PageViewport>();

  const warnings: string[] = [];
  const pairs = new Map<number, ManualRegion[]>();
  let skippedRegions = 0;

  faqRegions.forEach((region) => {
    const pairId = region.qaPairId;
    if (!pairId || pairId <= 0) {
      warnings.push(
        `Область #${region.id ?? "?"} (стр. ${region.pageNumber}) не привязана к паре (qaPairId)`
      );
      skippedRegions += 1;
      return;
    }
    const bucket = pairs.get(pairId) ?? [];
    bucket.push(region);
    pairs.set(pairId, bucket);
  });

  const sortedPairIds = Array.from(pairs.keys()).sort((a, b) => a - b);
  const chunkRecords: InsertDocumentChunk[] = [];

  let pairIndex = 0;
  for (const pairId of sortedPairIds) {
    pairIndex += 1;
    const regions = (pairs.get(pairId) ?? []).slice().sort((a, b) => {
      if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
      return (a.id ?? 0) - (b.id ?? 0);
    });

    const questionRegions = regions.filter((r) => r.regionType === "faq_question");
    const answerRegions = regions.filter((r) => r.regionType === "faq_answer");

    if (!questionRegions.length || !answerRegions.length) {
      warnings.push(
        `Пара #${pairId}: требуется минимум 1 вопрос и 1 ответ (найдено: вопрос=${questionRegions.length}, ответ=${answerRegions.length})`
      );
      continue;
    }

    const extractFor = async (region: ManualRegion) => {
      const normalizedBBox = resolveNormalizedBBox(region);
      if (!normalizedBBox) {
        warnings.push(
          `Пара #${pairId}: область #${region.id ?? "?"} не содержит координат`
        );
        return null;
      }

      let page = pageCache.get(region.pageNumber);
      if (!page) {
        page = await pdf.getPage(region.pageNumber);
        pageCache.set(region.pageNumber, page);
      }

      let viewport = viewportCache.get(region.pageNumber);
      if (!viewport) {
        viewport = page.getViewport({ scale: 1 });
        viewportCache.set(region.pageNumber, viewport);
      }

      const extracted = await extractTextForRegion(page, viewport, region, normalizedBBox);
      const extractedText = extracted.text;
      if (!extractedText) {
        warnings.push(
          `Пара #${pairId}: не удалось извлечь текст из области #${region.id ?? "?"} (стр. ${region.pageNumber})`
        );
        return null;
      }

      if (region.id) {
        await documentDb.updateManualRegion(region.id, { extractedText });
      }

      return {
        region,
        normalizedBBox,
        text: extractedText,
      };
    };

    const extractedQuestions = (
      await Promise.all(questionRegions.map((r) => extractFor(r)))
    ).filter(Boolean) as Array<{ region: ManualRegion; normalizedBBox: NormalizedBBox; text: string }>;
    const extractedAnswers = (
      await Promise.all(answerRegions.map((r) => extractFor(r)))
    ).filter(Boolean) as Array<{ region: ManualRegion; normalizedBBox: NormalizedBBox; text: string }>;

    if (!extractedQuestions.length || !extractedAnswers.length) {
      warnings.push(`Пара #${pairId}: пустой текст после извлечения (вопрос/ответ)`);
      continue;
    }

    const questionText = extractedQuestions.map((q) => q.text).join("\n").trim();
    const answerText = extractedAnswers.map((a) => a.text).join("\n").trim();

    const combinedText = stripFootnoteMarkers(
      `Вопрос:\n${questionText}\n\nОтвет:\n${answerText}`.trim()
    );

    let embeddingVector: number[] | null = null;
    if (options?.regenerateEmbeddings !== false) {
      try {
        embeddingVector = await generateChunkEmbedding(combinedText);
      } catch (error) {
        console.error(
          `[ManualChunkGenerator] Failed to generate embedding for FAQ pair ${pairId}:`,
          error
        );
        warnings.push(
          `Эмбеддинг не сгенерирован для FAQ-пары #${pairId} (Ollama может ещё загружать модель). Чанк создан без эмбеддинга.`
        );
      }
    }

    const pageNumber = Math.min(
      ...regions.map((r) => r.pageNumber ?? Number.MAX_SAFE_INTEGER)
    );

    chunkRecords.push({
      documentId,
      chunkIndex: chunkRecords.length,
      content: combinedText,
      tokenCount: estimateTokenCount(combinedText),
      embedding: embeddingVector ? JSON.stringify(embeddingVector) : null,
      pageNumber: Number.isFinite(pageNumber) ? pageNumber : null,
      sectionPath: `FAQ #${pairId}`,
      elementType: "text",
      tableJson: null,
      language: detectLanguage(combinedText),
      bm25Terms: buildLexicalTerms(combinedText),
      chunkMetadata: {
        annotationType: "warranty_faq",
        isManualRegion: true,
        faqPairId: pairId,
        questionRegionIds: extractedQuestions
          .map((q) => q.region.id)
          .filter((id): id is number => typeof id === "number"),
        answerRegionIds: extractedAnswers
          .map((a) => a.region.id)
          .filter((id): id is number => typeof id === "number"),
        regions: [
          ...extractedQuestions.map((q) => ({
            role: "question",
            regionId: q.region.id,
            pageNumber: q.region.pageNumber,
            bbox: q.normalizedBBox,
          })),
          ...extractedAnswers.map((a) => ({
            role: "answer",
            regionId: a.region.id,
            pageNumber: a.region.pageNumber,
            bbox: a.normalizedBBox,
          })),
        ],
        tags: ["warranty_faq", "faq"],
      },
    });
  }

  await documentDb.deleteDocumentChunks(documentId);
  if (chunkRecords.length > 0) {
    await documentDb.insertDocumentChunks(chunkRecords);
  }

  await documentDb.updateDocumentChunksCount(documentId, chunkRecords.length);
  await documentDb.updateDocumentProgress(
    documentId,
    "completed",
    100,
    chunkRecords.length
      ? `Создано FAQ-чанков: ${chunkRecords.length}`
      : "FAQ области обработаны, но чанки не созданы"
  );

  return {
    createdChunks: chunkRecords.length,
    skippedRegions,
    warnings,
  };
}

export async function generateChunkFromRegionSelection(
  documentId: number,
  regionIds: number[],
  options?: {
    regenerateEmbeddings?: boolean;
    chunkTitle?: string;
    productGroupId?: number;
    annotatedByUserId?: number;
  }
) {
  if (!regionIds || regionIds.length === 0) {
    throw new Error("Выберите хотя бы одну область для создания чанка");
  }

  const document = await documentDb.getDocumentById(documentId);
  if (!document) {
    throw new Error("Документ не найден");
  }

  const isPassportDoc =
    document.docType === "passport" || document.processingType === "passport";
  const passportTitle =
    (typeof document.title === "string" ? document.title : "")
      .trim() || "Паспорт";

  const regions = await documentDb.getManualRegionsByIds(documentId, regionIds);
  if (regions.length === 0) {
    throw new Error("Не удалось найти выбранные области");
  }

  const missingIds = regionIds.filter(
    (id) => !regions.some((region) => region.id === id)
  );
  if (missingIds.length > 0) {
    throw new Error(`Некоторые области не найдены или принадлежат другому документу: ${missingIds.join(", ")}`);
  }

  const uploadsDir = path.join(process.cwd(), "uploads", "documents");
  const pdfPath = path.resolve(uploadsDir, `${documentId}_${document.filename}`);
  if (!fs.existsSync(pdfPath)) {
    throw new Error("Файл документа не найден. Загрузите документ заново.");
  }

  const pdfData = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjsLib.getDocument({
    data: pdfData,
    cMapUrl: CMAP_PATH,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_PATH,
    useSystemFonts: true,
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;
  const pageCache = new Map<number, pdfjsLib.PDFPageProxy>();
  const viewportCache = new Map<number, pdfjsLib.PageViewport>();

const regionTexts: Array<{
  region: ManualRegion;
  text: string;
  tableJson?: Array<Record<string, string>> | null;
  tableStructure?: TableStructure | null;
  tableTitle?: string | null;
  normalizedBBox: NormalizedBBox;
}> = [];
  const warnings: string[] = [];

  const sortedRegions = [...regions].sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) {
      return a.pageNumber - b.pageNumber;
    }
    return (a.id ?? 0) - (b.id ?? 0);
  });

  for (const region of sortedRegions) {
    const normalizedBBox = resolveNormalizedBBox(region);
    if (!normalizedBBox) {
      warnings.push(
        `Область #${region.id ?? "?"} на странице ${region.pageNumber} не содержит координат`
      );
      continue;
    }

    let page = pageCache.get(region.pageNumber);
    if (!page) {
      page = await pdf.getPage(region.pageNumber);
      pageCache.set(region.pageNumber, page);
    }

    let viewport = viewportCache.get(region.pageNumber);
    if (!viewport) {
      viewport = page.getViewport({ scale: 1 });
      viewportCache.set(region.pageNumber, viewport);
    }

    const extracted = await extractTextForRegion(
      page,
      viewport,
      region,
      normalizedBBox
    );

    const extractedText = extracted.text;

    if (!extractedText) {
      warnings.push(
        `Не удалось извлечь текст из области #${region.id ?? "?"} на странице ${region.pageNumber}`
      );
      continue;
    }

    if (region.id) {
      await documentDb.updateManualRegion(region.id, {
        extractedText,
      });
    }

    regionTexts.push({
      region,
      text: extractedText,
      tableJson: extracted.tableJson ?? null,
      tableStructure: extracted.tableStructure ?? null,
      tableTitle: extracted.tableTitle ?? region.notes ?? null,
      normalizedBBox,
    });
  }

  if (regionTexts.length === 0) {
    throw new Error("Не удалось извлечь текст из выбранных областей");
  }

  const assignedProductGroupId = isPassportDoc ? null : options?.productGroupId ?? null;
  let assignedProductGroup: Awaited<ReturnType<typeof documentDb.getProductGroup>> | null = null;
  if (assignedProductGroupId) {
    assignedProductGroup = await documentDb.getProductGroup(assignedProductGroupId);
    if (!assignedProductGroup || assignedProductGroup.documentId !== documentId) {
      throw new Error("Указанная товарная группа недоступна для этого документа");
    }
  }

  const passportSection = isPassportDoc
    ? (options?.chunkTitle ?? regionTexts.find((e) => e.region.notes)?.region.notes ?? "")
        .trim()
    : "";
  if (isPassportDoc && passportSection.length === 0) {
    warnings.push("Паспорт: укажите подзаголовок (раздел) для создаваемого чанка");
  }

  const variantInfo = isPassportDoc ? null : buildVariantMetadata(options?.chunkTitle ?? null);
  const groupInfo = isPassportDoc ? null : buildGroupMetadata(assignedProductGroup?.name ?? null);
  const metadataTags = (() => {
    if (isPassportDoc) return [];
    const metadataTagSet = new Set<string>();
    (groupInfo?.tokens ?? []).forEach((token) => metadataTagSet.add(token));
    (variantInfo?.tokens ?? []).forEach((token) => metadataTagSet.add(token));
    if (groupInfo?.slug) {
      metadataTagSet.add(`product:${groupInfo.slug}`);
    }
    if (variantInfo?.slug) {
      metadataTagSet.add(`variant:${variantInfo.slug}`);
    }
    return Array.from(metadataTagSet);
  })();

  const combinedText = regionTexts
    .map((entry) => entry.text)
    .filter((text) => text && text.trim().length > 0)
    .join("\n\n")
    .trim();
  const tableCandidates = regionTexts
    .map((entry) => entry.tableJson)
    .filter(
      (
        table
      ): table is Array<Record<string, string>> =>
        Array.isArray(table) && table.length > 0
    );
  const mergedTableJson = mergeTableJsonArrays(tableCandidates);


  if (!combinedText) {
    throw new Error("Содержимое выбранных областей пустое");
  }

  const content = isPassportDoc
    ? `Паспорт: ${passportTitle}${passportSection ? `\nРаздел: ${passportSection}` : ""}\n\n${combinedText}`.trim()
    : combinedText;

  let embeddingVector: number[] | null = null;
  if (options?.regenerateEmbeddings !== false) {
    try {
      embeddingVector = await generateChunkEmbedding(content);
    } catch (error) {
      console.error(
        `[ManualChunkGenerator] Failed to generate embedding for selected regions:`,
        error
      );
      warnings.push(
        "Эмбеддинг не сгенерирован для выбранных областей (Ollama может ещё загружать модель). Чанк создан без эмбеддинга."
      );
    }
  }

  const chunkIndex = await documentDb.getNextChunkIndex(documentId);

  const elementType = determineElementTypeFromRegions(
    regionTexts.map((entry) => entry.region)
  );
  const passportSectionLabel = isPassportDoc
    ? [passportTitle, passportSection].filter(Boolean).join(" — ")
    : null;
  const sectionLabel =
    passportSectionLabel ??
    groupInfo?.original ??
    variantInfo?.original ??
    options?.chunkTitle ??
    regionTexts.find((entry) => entry.region.notes)?.region.notes ??
    null;
  const chunkMetadata = {
    annotationType: "manual_region_group",
    manualRegionIds: regionTexts
      .map((entry) => entry.region.id)
      .filter((id): id is number => typeof id === "number"),
    isManualRegion: true,
    title: isPassportDoc ? passportSectionLabel : options?.chunkTitle ?? null,
    passportTitle: isPassportDoc ? passportTitle : null,
    passportSection: isPassportDoc ? passportSection || null : null,
    section: groupInfo?.original ?? undefined,
    subsection: variantInfo?.original ?? undefined,
    isNomenclatureTable: regionTexts.some(
      (entry) => entry.region.isNomenclatureTable
    ),
    productGroupIds: regionTexts
      .map((entry) => entry.region.productGroupId)
      .filter((id): id is number => typeof id === "number"),
    assignedProductGroupId,
    productGroupId: assignedProductGroupId ?? null,
    productGroupName: assignedProductGroup?.name ?? null,
    productGroupSlug: groupInfo?.slug ?? null,
    productVariantName: options?.chunkTitle?.trim() || null,
    productVariantNormalized: variantInfo?.normalized ?? null,
    productVariantSlug: variantInfo?.slug ?? null,
    tags: metadataTags.length ? metadataTags : undefined,
    regions: regionTexts.map((entry) => ({
      regionId: entry.region.id,
      pageNumber: entry.region.pageNumber,
      type: entry.region.regionType,
      bbox: entry.normalizedBBox,
      text: entry.text,
      tableJson: entry.tableJson ?? null,
      tableStructure: entry.tableStructure ?? null,
      tableTitle: entry.tableTitle ?? null,
      isNomenclatureTable: entry.region.isNomenclatureTable ?? false,
      notes: entry.region.notes ?? null,
    })),
  };

  await documentDb.insertDocumentChunks([
    {
      documentId,
      chunkIndex,
      content,
      tokenCount: estimateTokenCount(content),
      embedding: embeddingVector ? JSON.stringify(embeddingVector) : null,
      pageNumber: Math.min(
        ...regionTexts.map((entry) => entry.region.pageNumber ?? Number.MAX_SAFE_INTEGER)
      ),
      sectionPath: sectionLabel,
      elementType,
      tableJson: mergedTableJson,
      language: detectLanguage(content),
      bm25Terms: buildLexicalTerms(content),
      chunkMetadata,
    },
  ]);

  if (options?.annotatedByUserId) {
    try {
      await documentDb.upsertChunkAnnotation({
        documentId,
        chunkIndex,
        annotationType: "manual_region_group",
        isNomenclatureTable: chunkMetadata.isNomenclatureTable ?? false,
        productGroupId: assignedProductGroupId,
        notes: chunkMetadata.title ?? null,
        annotatedBy: options.annotatedByUserId,
      });
    } catch (error) {
      console.error("[ManualChunkGenerator] Failed to upsert annotation for manual chunk:", error);
    }
  } else {
    console.warn("[ManualChunkGenerator] annotatedByUserId not provided; chunk annotation was not created");
  }

  const totalChunks = await documentDb.getDocumentChunkCount(documentId);
  await documentDb.updateDocumentChunksCount(documentId, totalChunks);

  return {
    createdChunkIndex: chunkIndex,
    totalChunks,
    warnings,
  };
}

