import fs from "fs";
import path from "path";
import { createRequire } from "module";
import XLSX from "xlsx";
import mammoth from "mammoth";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export type ElementType = "text" | "table" | "figure" | "list" | "header";

export interface PageHeader {
  pageNumber: number;
  mainSection?: string; // Например, "Трубы SANEXT"
  subsection?: string; // Например, "Труба «Стабил»"
  sectionPath?: string; // Извлеченный sectionPath из header'а (например, "1.3")
  yPosition?: number; // Y-координата header'а (обычно вверху страницы)
}

export interface DocumentSection {
  sectionPath: string;
  title: string;
  level: number;
  pageStart?: number;
  pageEnd?: number;
  parentPath?: string;
  isNumericSection?: boolean; // true для числовых секций (1, 1.1, 2.1.1), false для warranty
  // Позиция начала и конца раздела на странице (для точного определения границ)
  startLineIndex?: number; // Индекс строки начала раздела на странице
  endLineIndex?: number; // Индекс строки конца раздела на странице
  startY?: number; // Y-координата (baseline) начала раздела
  endY?: number; // Y-координата (baseline) конца раздела
}

export interface StructuredElement {
  pageNumber: number;
  sectionPath: string;
  heading?: string;
  elementType: ElementType;
  content: string;
  tableRows?: Array<Record<string, string | number | null>>;
  language?: string;
}

export interface StructuredProduct {
  sku: string;
  name?: string;
  attributes?: Record<string, string | number | null>;
  sectionPath?: string;
  pageNumber?: number;
}

export interface StructuredDocument {
  title?: string;
  numPages?: number;
  sections: DocumentSection[];
  toc: DocumentSection[];
  elements: StructuredElement[];
  products: StructuredProduct[];
}

// Паттерн для числовых секций: НЕ допускает точку после последней цифры
// Примеры: "1.1 Труба", "1.2 Труба", "2.1.1 Соединительный" - ВАЛИДНО
// Примеры: "1.1. Труба", "1.2. Труба" - НЕВАЛИДНО (точка после последней цифры)
const SECTION_PATTERN = /^\s*(\d+(?:\.\d+){0,3})\s+(.+?)\s*$/;

// Специальный паттерн для "Гарантийные обязательства и сертификаты SANEXT"
const WARRANTY_PATTERN = /гарантийные\s+обязательства\s+и\s+сертификаты\s+sanext/i;

// Patterns that should NOT be treated as sections
const NOT_SECTION_PATTERNS: RegExp[] = [
  /^[\d\s]+$/, // Pure numbers (page numbers, etc.)
  /^\d{4,}$/, // Long numbers (like "0001", "47105" - likely SKUs or codes)
  /^[°C]?\s*-?\d+\s*[°C]?$/, // Temperature ranges like "-60 °C" or "°C -60 °C"
  /^[А-ЯЁа-яёA-Za-z]+\s*[:\-]\s*\d+[x×]\d+/, // Product specs like "Труба: 16x2,2"
  /^\d+\s*[x×]\s*\d+/, // Dimensions like "16x2,2"
  /^[А-ЯЁа-яёA-Za-z]+\s*[:\-]\s*\d+/, // Simple key-value like "Артикул: 47105"
];

const BULLET_PATTERN = /^(\u2022|-|\*|\d+\.)\s+/;
const MAX_SECTION_TITLE_LENGTH = 300;
const moduleRequire = createRequire(import.meta.url);
const PDFJS_BASE_PATH = path.dirname(moduleRequire.resolve("pdfjs-dist/package.json"));
const CMAP_PATH = path.join(PDFJS_BASE_PATH, "cmaps") + "/";
const STANDARD_FONT_PATH = path.join(PDFJS_BASE_PATH, "standard_fonts") + "/";

function sanitizeSectionTitle(title: string): string {
  const normalized = normalizeText(title);
  if (normalized.length === 0) {
    return "";
  }
  if (normalized.length > MAX_SECTION_TITLE_LENGTH) {
    return normalized.slice(0, MAX_SECTION_TITLE_LENGTH);
  }
  return normalized;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Нормализация строки перед матчингом секций:
 * - замена NBSP и спец-пробелов на обычный пробел
 * - trim по краям
 * - унификация точек и дефисов
 */
function normalizeLine(text: string): string {
  if (!text) return "";
  
  // Замена неразрывных пробелов и других спец-пробелов на обычный
  let normalized = text
    .replace(/\u00A0/g, " ") // NBSP
    .replace(/\u2000-\u200B/g, " ") // Различные пробелы Unicode
    .replace(/\u202F/g, " ") // Узкий неразрывный пробел
    .replace(/\uFEFF/g, ""); // BOM
  
  // Унификация точек (разные Unicode точки к обычной)
  normalized = normalized.replace(/[\u2024\u2025\uFE52\uFF0E]/g, ".");
  
  // Унификация дефисов
  normalized = normalized.replace(/[\u2010-\u2015\u2212]/g, "-");
  
  // Trim
  normalized = normalized.trim();
  
  return normalized;
}

/**
 * Нормализация sectionPath: только цифры и точки, максимум 4 уровня
 * Примеры: "1.1." -> "1.1", "2.1.1" -> "2.1.1", "1.2.3.4.5" -> "1.2.3.4"
 */
function normalizeSectionPath(path: string): string {
  if (!path) return "";
  
  // Убираем конечную точку
  let normalized = path.replace(/\.$/, "");
  
  // Заменяем запятые на точки (если вдруг появятся)
  normalized = normalized.replace(/,/g, ".");
  
  // Оставляем только цифры и точки
  normalized = normalized.replace(/[^\d.]/g, "");
  
  // Ограничиваем до 4 уровней
  const parts = normalized.split(".").filter(p => p.length > 0);
  if (parts.length > 4) {
    normalized = parts.slice(0, 4).join(".");
  }
  
  return normalized;
}

/**
 * Извлечение header'а страницы
 * Header обычно находится вверху страницы (первые 10-15% высоты)
 * Структура: основная надпись (например, "Трубы SANEXT") и подраздел (например, "Труба «Стабил»")
 */
function extractPageHeader(
  pageWithFonts: PdfPageWithFonts,
  pageNumber: number,
  pageHeight: number = 800 // Примерная высота страницы в пикселях
): PageHeader | null {
  // Проверяем, что есть строки на странице
  if (!pageWithFonts || !pageWithFonts.lines || pageWithFonts.lines.length === 0) {
    return null;
  }
  
  const header: PageHeader = {
    pageNumber,
    yPosition: 0,
  };
  
  // Header обычно находится в верхней части страницы
  // В PDF координаты могут идти снизу вверх или сверху вниз
  // Определяем header по первым строкам (первые 3-5 строк обычно header)
  const headerLines: PdfLineWithFont[] = [];
  const maxHeaderLines = 5; // Максимум строк для header'а
  
  // Берем первые строки страницы как потенциальный header
  for (let i = 0; i < Math.min(maxHeaderLines, pageWithFonts.lines.length); i++) {
    const line = pageWithFonts.lines[i];
    // Пропускаем пустые строки или строки без текста
    if (!line || !line.text || !line.text.trim()) continue;
    headerLines.push(line);
  }
  
  if (headerLines.length === 0) return null;
  
  // Определяем Y-позицию header'а (используем baseline первой строки)
  if (headerLines[0].baseline !== null && headerLines[0].baseline !== undefined) {
    header.yPosition = headerLines[0].baseline;
  }
  
  // Анализируем header'ы
  // Паттерн 1: "Трубы SANEXT" - основной раздел (обычно первая строка)
  // Паттерн 2: "Труба «Стабил»" или "1.3. Труба «Стабил»" - подраздел (обычно вторая строка)
  
  for (let i = 0; i < headerLines.length; i++) {
    const line = headerLines[i];
    const text = normalizeLine(line.text.trim());
    
    // Проверяем на основной раздел (обычно первая строка header'а)
    if (!header.mainSection && i === 0) {
      // Паттерн: "Трубы SANEXT" или подобное
      if (/^[А-ЯЁа-яёA-Za-z\s]+SANEXT/i.test(text) || 
          (/^[А-ЯЁа-яёA-Za-z\s]+$/.test(text) && text.length > 5 && text.length < 50 && !/\d/.test(text))) {
        header.mainSection = text;
        continue;
      }
    }
    
    // Проверяем на подраздел (обычно вторая строка header'а или строка с номером раздела)
    if (!header.subsection) {
      // Паттерн 1: "1.3. Труба «Стабил»" - с номером раздела
      const sectionMatch = text.match(/^(\d+(?:\.\d+){0,3})\s+(.+)$/);
      if (sectionMatch) {
        header.sectionPath = normalizeSectionPath(sectionMatch[1]);
        header.subsection = sectionMatch[2].trim();
        continue;
      }
      
      // Паттерн 2: "Труба «Стабил»" (без номера, но с кавычками)
      const subsectionMatch = text.match(/^[А-ЯЁа-яёA-Za-z\s]+[«"']([А-ЯЁа-яёA-Za-z\s]+)[»"']/);
      if (subsectionMatch) {
        header.subsection = text;
        continue;
      }
      
      // Паттерн 3: Просто название подраздела без кавычек (если это не основной раздел)
      if (i > 0 && text.length > 3 && text.length < 100 && /[А-ЯЁа-яё]/.test(text)) {
        // Проверяем, что это не номер страницы или другой служебный текст
        if (!/^\d+$/.test(text) && !/^(кПа|бар|МПа|кг|м|см|мм|г|кДж|К|°[СC]|Вт|кВт|м\/с|м\/с²|м³|см³|г\/см³|лет|год|час|сут|%|Dнар\.?|Dнар)$/i.test(text)) {
          header.subsection = text;
          continue;
        }
      }
    }
  }
  
  // Если нашли хотя бы основную информацию
  if (header.mainSection || header.subsection) {
    console.log(`[PageHeader] Страница ${pageNumber}: mainSection="${header.mainSection}", subsection="${header.subsection}", sectionPath="${header.sectionPath}"`);
    return header;
  }
  
  return null;
}

/**
 * Валидация и корректировка границ разделов на основе header'ов страниц
 */
function correctSectionBoundariesWithHeaders(
  sections: DocumentSection[],
  pageHeaders: Map<number, PageHeader>
): DocumentSection[] {
  const correctedSections = [...sections];
  const sectionMap = new Map<string, DocumentSection>();
  correctedSections.forEach(s => sectionMap.set(s.sectionPath, s));
  
  // Группируем header'ы по sectionPath
  const headersBySection = new Map<string, number[]>();
  for (const [pageNumber, header] of pageHeaders.entries()) {
    if (header.sectionPath) {
      if (!headersBySection.has(header.sectionPath)) {
        headersBySection.set(header.sectionPath, []);
      }
      headersBySection.get(header.sectionPath)!.push(pageNumber);
    }
  }
  
  // Корректируем границы разделов на основе header'ов
  for (const [sectionPath, pageNumbers] of headersBySection.entries()) {
    // Проверяем, что есть страницы
    if (!pageNumbers || pageNumbers.length === 0) {
      continue;
    }
    
    const section = sectionMap.get(sectionPath);
    if (!section) {
      // Если раздел не найден, но есть header'ы - создаем новый раздел
      const firstPageNumber = pageNumbers[0];
      const firstHeader = pageHeaders.get(firstPageNumber);
      if (firstHeader && firstHeader.subsection) {
        const minPage = Math.min(...pageNumbers);
        const maxPage = Math.max(...pageNumbers);
        const newSection: DocumentSection = {
          sectionPath,
          title: firstHeader.subsection,
          level: sectionPath.split('.').length,
          pageStart: minPage,
          pageEnd: maxPage,
          isNumericSection: true,
        };
        correctedSections.push(newSection);
        sectionMap.set(sectionPath, newSection);
        console.log(`[SectionCorrection] Создан новый раздел ${sectionPath} на основе header'ов: страницы ${newSection.pageStart}-${newSection.pageEnd}`);
      }
      continue;
    }
    
    // Сортируем страницы (создаем копию, чтобы не изменять оригинальный массив)
    const sortedPages = [...pageNumbers].sort((a, b) => a - b);
    const minPage = Math.min(...sortedPages);
    const maxPage = Math.max(...sortedPages);
    
    // Корректируем границы, если они отличаются
    if (section.pageStart !== minPage || section.pageEnd !== maxPage) {
      console.log(
        `[SectionCorrection] Раздел ${sectionPath}: ` +
        `было ${section.pageStart}-${section.pageEnd}, ` +
        `стало ${minPage}-${maxPage} (на основе header'ов)`
      );
      
      section.pageStart = minPage;
      section.pageEnd = maxPage;
    }
  }
  
  // Также проверяем страницы без header'ов с sectionPath, но с subsection
  // Можем использовать их для валидации существующих разделов
  for (const [pageNumber, header] of pageHeaders.entries()) {
    if (!header.sectionPath && header.subsection) {
      // Ищем раздел, который должен быть на этой странице
      const expectedSection = correctedSections.find(s => 
        s.pageStart! <= pageNumber && s.pageEnd! >= pageNumber
      );
      
      if (expectedSection) {
        // Проверяем соответствие названия
        const headerKeywords = header.subsection.toLowerCase().split(/\s+/).filter(k => k.length > 3);
        const sectionTitleLower = expectedSection.title.toLowerCase();
        const hasMatchingKeywords = headerKeywords.some(keyword => 
          sectionTitleLower.includes(keyword)
        );
        
        if (!hasMatchingKeywords) {
          console.log(
            `[SectionValidation] Предупреждение: Страница ${pageNumber} header "${header.subsection}" ` +
            `не соответствует разделу "${expectedSection.title}" (${expectedSection.sectionPath})`
          );
        }
      }
    }
  }
  
  return correctedSections;
}

type PdfMetadata = {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string | string[];
};

type PdfLineWithFont = {
  text: string;
  fontSize: number;
  isBold: boolean;
  baseline?: number | null; // Y-координата строки (baseline из transform[5])
};

type PdfPageWithFonts = {
  lines: PdfLineWithFont[];
  averageFontSize: number;
};

type PdfExtractionResult = {
  meta: PdfMetadata & { numPages: number };
  pages: string[];
  pagesWithFonts: PdfPageWithFonts[];
};

function calculateFontSize(transform: number[]): number {
  if (!transform || transform.length < 4) {
    return 12; // Default font size
  }
  // Transform matrix: [a, b, c, d, e, f]
  // Font size is typically sqrt(a^2 + b^2) or sqrt(c^2 + d^2)
  // For most PDFs, it's simpler to use the height from transform
  const a = transform[0] || 0;
  const b = transform[1] || 0;
  const c = transform[2] || 0;
  const d = transform[3] || 0;
  
  // Calculate font size from transform matrix
  const fontSize1 = Math.sqrt(a * a + b * b);
  const fontSize2 = Math.sqrt(c * c + d * d);
  
  // Use the larger value (usually more accurate)
  return Math.max(fontSize1, fontSize2) || 12;
}

function assemblePageText(items: Array<TextItem & { hasEOL?: boolean }>): string {
  const lines: string[] = [];
  let currentLine: string[] = [];
  let lastBaseline: number | null = null;

  items.forEach((rawItem) => {
    const item = rawItem as TextItem & { hasEOL?: boolean };
    const str = (item.str || "").replace(/\s+/g, " ").trim();

    if (!str) {
      return;
    }

    const transform = item.transform || [];
    const baseline = transform.length >= 6 ? transform[5] : null;

    const isNewLine =
      baseline !== null &&
      lastBaseline !== null &&
      Math.abs(baseline - lastBaseline) > 6 &&
      currentLine.length > 0;

    if (isNewLine || item.hasEOL) {
      lines.push(currentLine.join(" "));
      currentLine = [];
      lastBaseline = null;
    }

    currentLine.push(str);
    lastBaseline = baseline ?? lastBaseline;
  });

  if (currentLine.length > 0) {
    lines.push(currentLine.join(" "));
  }

  return lines.join("\n");
}

function isBoldFont(fontName: string | undefined): boolean {
  if (!fontName) return false;
  const fontNameLower = fontName.toLowerCase();
  // Проверяем наличие "Bold", "BoldItalic", "Bold-Italic" или просто "B" в названии шрифта
  // Также проверяем различные варианты написания
  const isBold = /bold/i.test(fontNameLower) || 
                 /^[A-Z][a-z]+-Bold/i.test(fontNameLower) ||
                 /-Bold/i.test(fontNameLower) ||
                 /\bB\b/i.test(fontNameLower) ||
                 /black/i.test(fontNameLower) || // Black часто используется как жирный
                 /heavy/i.test(fontNameLower); // Heavy также часто используется как жирный
  
  // Логирование для отладки
  if (fontName && !isBold) {
    // Логируем только если шрифт не определен как жирный, чтобы понять какие шрифты используются
    // console.log(`[StructuredParser] Font "${fontName}" is not detected as bold`);
  }
  
  return isBold;
}

function assemblePageTextWithFonts(items: Array<TextItem & { hasEOL?: boolean }>): PdfPageWithFonts {
  const lines: PdfLineWithFont[] = [];
  let currentLine: string[] = [];
  let currentLineFontSizes: number[] = [];
  let currentLineIsBold: boolean[] = [];
  let currentLineBaselines: number[] = []; // ✅ Добавляем отслеживание baseline
  let lastBaseline: number | null = null;
  const allFontSizes: number[] = [];

  items.forEach((rawItem) => {
    const item = rawItem as TextItem & { hasEOL?: boolean };
    const str = (item.str || "").replace(/\s+/g, " ").trim();

    if (!str) {
      return;
    }

    const transform = item.transform || [];
    const baseline = transform.length >= 6 ? transform[5] : null;
    const fontSize = calculateFontSize(transform);
    allFontSizes.push(fontSize);
    
    // Проверка жирного шрифта через fontName
    // Пробуем разные способы получения названия шрифта из PDF.js TextItem
    const fontName = (item as any).fontName || 
                     (item as any).font?.name || 
                     (item as any).fontName?.name ||
                     (item as any).font?.loadedName ||
                     undefined;
    const isBold = isBoldFont(fontName);
    
    // Дополнительная проверка через font-weight если доступно
    const fontWeight = (item as any).font?.weight || (item as any).fontWeight;
    const isBoldByWeight = fontWeight && (fontWeight >= 600 || fontWeight === 'bold' || fontWeight === 'Bold');
    
    // Используем жирный шрифт если хотя бы один из способов определил его как жирный
    const finalIsBold = isBold || isBoldByWeight || false;

    const isNewLine =
      baseline !== null &&
      lastBaseline !== null &&
      Math.abs(baseline - lastBaseline) > 6 &&
      currentLine.length > 0;

    if (isNewLine || item.hasEOL) {
      const lineText = currentLine.join(" ");
      const avgFontSize = currentLineFontSizes.length > 0
        ? currentLineFontSizes.reduce((a, b) => a + b, 0) / currentLineFontSizes.length
        : 12;
      // Строка считается жирной, если хотя бы половина символов жирная
      const lineIsBold = currentLineIsBold.filter(b => b).length > currentLineIsBold.length / 2;
      // ✅ Вычисляем средний baseline для строки
      const avgBaseline = currentLineBaselines.length > 0
        ? currentLineBaselines.reduce((a, b) => a + b, 0) / currentLineBaselines.length
        : null;
      lines.push({ text: lineText, fontSize: avgFontSize, isBold: lineIsBold, baseline: avgBaseline });
      currentLine = [];
      currentLineFontSizes = [];
      currentLineIsBold = [];
      currentLineBaselines = [];
      lastBaseline = null;
    }

    currentLine.push(str);
    currentLineFontSizes.push(fontSize);
    currentLineIsBold.push(finalIsBold);
    if (baseline !== null) {
      currentLineBaselines.push(baseline);
    }
    lastBaseline = baseline ?? lastBaseline;
  });

  if (currentLine.length > 0) {
    const lineText = currentLine.join(" ");
    const avgFontSize = currentLineFontSizes.length > 0
      ? currentLineFontSizes.reduce((a, b) => a + b, 0) / currentLineFontSizes.length
      : 12;
    const lineIsBold = currentLineIsBold.filter(b => b).length > currentLineIsBold.length / 2;
    const avgBaseline = currentLineBaselines.length > 0
      ? currentLineBaselines.reduce((a, b) => a + b, 0) / currentLineBaselines.length
      : null;
    lines.push({ text: lineText, fontSize: avgFontSize, isBold: lineIsBold, baseline: avgBaseline });
  }

  // Calculate average font size for the page
  const averageFontSize = allFontSizes.length > 0
    ? allFontSizes.reduce((a, b) => a + b, 0) / allFontSizes.length
    : 12;

  return {
    lines: lines.filter(line => line.text.trim().length > 0),
    averageFontSize,
  };
}

async function parsePdfWithPages(filePath: string): Promise<PdfExtractionResult> {
  const dataBuffer = fs.readFileSync(filePath);
  const data = new Uint8Array(dataBuffer);
  const loadingTask = pdfjsLib.getDocument({
    data,
    cMapUrl: CMAP_PATH,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_PATH,
    useSystemFonts: true,
    isEvalSupported: false,
  });

  const doc = await loadingTask.promise;
  const pages: string[] = [];
  const pagesWithFonts: PdfPageWithFonts[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = assemblePageText(textContent.items as Array<TextItem & { hasEOL?: boolean }>);
    const pageWithFonts = assemblePageTextWithFonts(textContent.items as Array<TextItem & { hasEOL?: boolean }>);
    pages.push(pageText);
    pagesWithFonts.push(pageWithFonts);
  }

  let meta: PdfMetadata = {};
  try {
    const metadata = await doc.getMetadata();
    if (metadata?.info) {
      meta = {
        title: metadata.info.Title || undefined,
        author: metadata.info.Author || undefined,
        subject: metadata.info.Subject || undefined,
        keywords: metadata.info.Keywords || undefined,
      };
    }
  } catch {
    meta = {};
  }

  return {
    meta: {
      ...meta,
      numPages: doc.numPages,
    },
    pages,
    pagesWithFonts,
  };
}

function splitIntoParagraphs(pageText: string): string[] {
  const blocks = pageText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  if (blocks.length > 1) {
    return blocks;
  }

  // Fallback to sentence-based splitting
  const sentences = pageText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  if (sentences.length <= 3) {
    return [normalizeText(pageText)];
  }

  const paragraphSize = 4;
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += paragraphSize) {
    const chunk = sentences.slice(i, i + paragraphSize).join(" ");
    paragraphs.push(normalizeText(chunk));
  }

  return paragraphs;
}

/**
 * Split text into potential table blocks
 * Tables are often separated by blank lines or have consistent structure
 * CRITICAL: This function helps detect multiple tables within a section
 */
function splitIntoTableBlocks(text: string): string[] {
  const lines = text.split(/\n+/).map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length === 0) return [];
  
  const blocks: string[] = [];
  let currentBlock: string[] = [];
  let lastLineWasTableLike = false;
  let consecutiveTableLines = 0;
  
  lines.forEach((line, index) => {
    // Check if this line looks like a table row
    const isTableLike = 
      (/\s{2,}/.test(line) && line.split(/\s{2,}/).length >= 2) || // Multiple columns with spaces
      (/[А-ЯЁа-яёA-Za-z]+\s*[:–—]\s*/.test(line)) || // Key-value pattern
      (/^\d{3,}\s+/.test(line)) || // Starts with article code
      (/(артикул|наименование|характеристика|единица|измерения|значение|номенклатура)/gi.test(line)) || // Table keywords
      (/\|/.test(line) && line.split(/\|/).length >= 2); // Pipe-separated columns
    
    if (isTableLike) {
      consecutiveTableLines++;
      if (!lastLineWasTableLike && currentBlock.length > 0) {
        // Previous non-table block ended, start new table block
        blocks.push(currentBlock.join("\n"));
        currentBlock = [];
      }
      currentBlock.push(line);
      lastLineWasTableLike = true;
    } else {
      // Check if we had a table block (at least 2 consecutive table lines)
      if (lastLineWasTableLike && consecutiveTableLines >= 2 && currentBlock.length > 0) {
        // Table block ended - save it as separate block
        blocks.push(currentBlock.join("\n"));
        currentBlock = [];
      }
      currentBlock.push(line);
      lastLineWasTableLike = false;
      consecutiveTableLines = 0;
    }
  });
  
  // Add remaining block
  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join("\n"));
  }
  
  // If we have multiple blocks that look like tables, return them separately
  // Otherwise, return original text as single block
  const tableBlocks = blocks.filter(block => {
    const blockLines = block.split(/\n+/).filter(l => l.trim().length > 0);
    return guessElementType(block) === "table" && blockLines.length >= 2;
  });
  
  // If we found multiple table blocks, return them separately
  // Otherwise, return all blocks (tables and text mixed)
  return tableBlocks.length > 1 ? tableBlocks : blocks.filter(block => block.trim().length > 0);
}

function detectSectionFromLine(
  line: string,
  fontSize?: number,
  averageFontSize?: number,
  isBold?: boolean
): { path: string; title: string; level: number; sectionPath: string; isNumericSection: boolean } | null {
  // Нормализация строки перед матчингом
  const normalized = normalizeLine(line);
  
  if (!normalized || normalized.length < 3) {
    return null;
  }
  
  // Специальный случай: "Гарантийные обязательства и сертификаты SANEXT"
  if (WARRANTY_PATTERN.test(normalized)) {
    return {
      path: "warranty",
      title: "Гарантийные обязательства и сертификаты SANEXT",
      level: 1,
      sectionPath: "warranty",
      isNumericSection: false,
    };
  }
  
  // Фильтрация ложных срабатываний: единицы измерения, артикулы, размерности
  if (/^(кПа|бар|МПа|кг|м|см|мм|г|кДж|К|°[СC]|Вт|кВт|м\/с|м\/с²|м³|см³|г\/см³|лет|год|час|сут|%|Dнар\.?|Dнар)$/i.test(normalized)) {
    return null;
  }
  
  // Пропускаем строки только с числами (номера страниц)
  if (/^\d+(\s+\d+)*$/.test(normalized)) {
    return null;
  }
  
  // Пропускаем очень короткие строки без букв
  if (!/[А-ЯЁа-яёA-Za-z]/.test(normalized)) {
    return null;
  }
  
  // КРИТИЧЕСКИ ВАЖНО: Раздел определяется если выполнены ОБЯЗАТЕЛЬНЫЕ условия:
  // 1. Формат N.N[.N] (числовой паттерн) - ОБЯЗАТЕЛЬНО
  // 2. Крупный шрифт (минимум на 10% больше среднего) - ОБЯЗАТЕЛЬНО для PDF
  // 3. Жирный шрифт (bold) - ЖЕЛАТЕЛЬНО, но не блокирует если недоступно
  
  // ОБЯЗАТЕЛЬНАЯ проверка шрифта: заголовок раздела ДОЛЖЕН быть больше среднего размера шрифта на странице
  // Правило: заголовок раздела = раздел только если шрифт больше среднего
  // Примечание: для PDF проверка выполняется, для DOCX - пропускается (mammoth не предоставляет размер шрифта)
  if (fontSize !== undefined && averageFontSize !== undefined) {
    // Заголовок должен быть минимум на 10% больше среднего размера шрифта
    const minSectionFontSize = Math.max(averageFontSize * 1.1, averageFontSize + 1);
    if (fontSize < minSectionFontSize) {
      // Шрифт слишком маленький - это НЕ заголовок раздела
      return null;
    }
  }
  
  // ПРЕДПОЧТИТЕЛЬНАЯ проверка жирного шрифта: заголовок раздела ЖЕЛАТЕЛЬНО должен быть жирным
  // Правило: если информация о жирном шрифте доступна И шрифт НЕ жирный - это может быть не раздел
  // Но если информация недоступна - не блокируем определение раздела
  // Примечание: для PDF проверка выполняется как предпочтение, для DOCX - пропускается
  // Если шрифт не жирный, но формат и размер правильные - все равно считаем разделом (может быть стиль документа)
  // Только если явно указано что шрифт НЕ жирный И размер шрифта близок к среднему - отклоняем
  if (isBold !== undefined && fontSize !== undefined && averageFontSize !== undefined) {
    // Если шрифт не жирный И размер шрифта близок к среднему (менее 15% больше) - возможно это не раздел
    const fontSizeRatio = fontSize / averageFontSize;
    if (!isBold && fontSizeRatio < 1.15) {
      // Шрифт не жирный и размер недостаточно большой - это НЕ заголовок раздела
      return null;
    }
    // Если шрифт не жирный, но размер достаточно большой (>= 15% больше) - все равно считаем разделом
  }
  
  // Проверка против NOT_SECTION_PATTERNS
  for (const notPattern of NOT_SECTION_PATTERNS) {
    if (notPattern.test(normalized)) {
      return null;
    }
  }
  
  // Распознавание по паттерну: ^\s*(\d+(?:\.\d+){0,3})\s+(.+?)\s*$
  // Важно: паттерн НЕ допускает точку после последней цифры (например, "1.1." не валидно)
  const match = normalized.match(SECTION_PATTERN);
  if (!match) {
    return null;
  }
  
  const rawPath = match[1];
  const rest = match[2].trim();
  
  // Валидация: rest должен содержать текст (не только числа/символы)
  if (!rest || rest.length < 3 || /^[\d.\s\-–—]+$/.test(rest)) {
    return null;
  }
  
  // Фильтрация: пропускаем единицы измерения и артикулы
  if (/^(кПа|бар|МПа|кг|м|см|мм|г|кДж|К|°[СC]|Вт|кВт|м\/с|м\/с²|м³|см³|г\/см³|лет|год|час|сут|%|Dнар\.?|Dнар)$/i.test(rest)) {
    return null;
  }
  
  // Пропускаем длинные числовые коды (артикулы)
  if (/^\d{4,}$/.test(rawPath)) {
    return null;
  }
  
  // Нормализация sectionPath: только цифры и точки, максимум 4 уровня
  const sectionPath = normalizeSectionPath(rawPath);
  if (!sectionPath || sectionPath.length === 0) {
    return null;
  }
  
  // Нормализация title: удаляем хвостовые пробелы
  const title = sanitizeSectionTitle(rest);
  if (!title || title.length < 3) {
    return null;
  }
  
  // Вычисление уровня (1-4)
  const pathParts = sectionPath.split('.');
  const level = Math.min(pathParts.length, 4);
  
  return {
    path: sectionPath, // Для обратной совместимости
    title,
    level,
    sectionPath, // Нормализованный путь
    isNumericSection: true,
  };
}

function guessElementType(text: string): ElementType {
  if (BULLET_PATTERN.test(text)) {
    return "list";
  }
  
  const lines = text.split(/\n+/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return "text";
  
  // Improved table detection - check for various table patterns
  // Pattern 1: Key-value pairs with colons or dashes
  const hasKeyValuePattern = /[А-ЯЁа-яёA-Za-z]+\s*[:–—]\s*[\d\s,.\-–—]+/.test(text);
  const linesWithKeyValue = lines.filter(line => 
    /^[А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z\s\-–—]+?\s*[:–—]\s*.+$/.test(line.trim())
  ).length;
  
  // Pattern 2: Table structure markers
  const hasTableStructure = text.includes("|") || /\d+\s+[x×]\s*\d+/.test(text) || /\d+[;,]\s+\d+/.test(text);
  
  // Pattern 3: Multiple columns separated by multiple spaces (tabular data)
  // Check if multiple lines have similar structure with multiple spaces
  const linesWithMultipleSpaces = lines.filter(line => {
    const parts = line.trim().split(/\s{2,}/);
    return parts.length >= 2 && parts.every(p => p.trim().length > 0);
  }).length;
  
  // Pattern 4: Repeated table-related keywords (like "Артикул", "Наименование", etc.)
  const tableKeywords = /(артикул|наименование|характеристика|размер|диаметр|толщина|материал|цена|количество|номенклатура|габаритные|тип|резьба|наличие|покрытие|коробка|шт|единица|измерения|значение|рабочее|давление|температура|испытательное|макс|мин|радиус|изгиба|плотность|прочность|разрыве|удлинение|коэф|линейного|расширения|теплоемкость|диффузия|кислорода|шероховатость)/gi;
  const hasRepeatedPatterns = tableKeywords.test(text) && 
    (text.match(tableKeywords) || []).length >= 2;
  
  // Pattern 4b: Table structure with "Характеристика | Единица измерения | Значение"
  const hasThreeColumnStructure = /(характеристика|единица|измерения|значение)/gi.test(text) && 
    lines.some(line => {
      const parts = line.split(/\s{2,}|\|/).filter(p => p.trim().length > 0);
      return parts.length >= 2;
    });
  
  // Pattern 5: Data rows with numbers/values (like "15 15 1/2", "20 20 3/4", "8701 BP 1/2\"")
  const hasDataRows = lines.some(line => {
    const trimmed = line.trim();
    // Check for patterns like:
    // - "8701 BP 1/2\"" (article codes with thread sizes)
    // - "15 15 1/2" (multiple numbers/values)
    // - "10,5 500" (dimensions and quantities)
    return /^\d+(\s+\d+(\/\d+)?)+/.test(trimmed) || 
           /^\d+[x×]\d+/.test(trimmed) ||
           /^\d+[,\-–—]\s*\d+/.test(trimmed) ||
           /^\d{3,}\s+[A-ZА-Я]{1,3}\s+[\d\/"]+/.test(trimmed) || // Article codes like "8701 BP 1/2\""
           /^\d{3,}\s+[\d,\.]+\s+\d+/.test(trimmed); // Article + dimension + quantity
  });
  
  // Pattern 6: Boolean values (есть/нет, да/нет, +/-, yes/no)
  const hasBooleanValues = /(есть|нет|да|нет|yes|no|\+|\-|✓|✗)/gi.test(text) && lines.length >= 2;
  
  // Pattern 7: Consistent column structure across multiple lines
  // Check if multiple lines have similar number of columns (parts separated by spaces)
  let consistentColumns = false;
  if (lines.length >= 2) {
    const columnCounts = lines.map(line => {
      const parts = line.trim().split(/\s{2,}/).filter(p => p.trim().length > 0);
      return parts.length;
    }).filter(count => count >= 2); // At least 2 columns
    
    if (columnCounts.length >= 2) {
      // Check if at least 2 lines have the same number of columns
      const counts = new Map<number, number>();
      columnCounts.forEach(count => {
        counts.set(count, (counts.get(count) || 0) + 1);
      });
      consistentColumns = Array.from(counts.values()).some(freq => freq >= 2);
    }
  }
  
  // Pattern 8: Product catalog tables (article codes + specifications)
  const hasProductCatalogPattern = lines.some(line => {
    // Pattern: article code (4+ digits) followed by specifications
    return /^\d{4,}\s+[A-ZА-Яа-яё\s\d\/"',\.]+/.test(line.trim());
  }) && lines.length >= 2;
  
  // More aggressive table detection
  const isLikelyTable = 
    hasTableStructure || // Has pipes or clear table markers
    (hasKeyValuePattern && linesWithKeyValue >= 2 && lines.length >= 2) || // At least 2 structured lines with key-value
    (hasKeyValuePattern && linesWithKeyValue >= 1 && lines.length >= 1 && text.length > 100) || // Single structured line but substantial
    (linesWithMultipleSpaces >= 2 && lines.length >= 2) || // Multiple lines with tabular structure (multiple spaces)
    (hasRepeatedPatterns && lines.length >= 2) || // Repeated table-related keywords
    (hasDataRows && lines.length >= 2) || // Data rows with numbers
    (hasBooleanValues && lines.length >= 2) || // Boolean values in structured format
    (consistentColumns && lines.length >= 2) || // Consistent column structure
    (hasProductCatalogPattern && lines.length >= 2) || // Product catalog pattern
    (hasThreeColumnStructure && lines.length >= 2); // Three-column structure (Характеристика/Единица/Значение)
  
  if (isLikelyTable) {
    return "table";
  }
  
  if (text.length < 80 && text === text.toUpperCase()) {
    return "header";
  }
  return "text";
}

/**
 * Extract table rows from text that looks like a table
 * Handles formats like:
 * - "Характеристика: Значение (Единица измерения)"
 * - "Характеристика | Значение | Единица измерения"
 * - Multiple key-value pairs
 */
function extractTableRowsFromText(text: string): Array<Record<string, string | number | null>> | undefined {
  const rows: Array<Record<string, string | number | null>> = [];
  
  // Split by lines
  const lines = text.split(/\n+/).map(line => line.trim()).filter(line => line.length > 0);
  
  if (lines.length === 0) return undefined;
  
  // Try to detect table structure
  // Pattern 1: Key-value pairs with colons or dashes
  const keyValuePattern = /^([А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z\s\-–—]+?)\s*[:–—]\s*(.+)$/;
  
  // Pattern 2: Pipe-separated values
  const pipePattern = /\|/;
  
  // Pattern 3: Multiple columns separated by spaces (at least 2 spaces)
  const multiColumnPattern = /\s{2,}/;
  
  // Pattern 4: Tabular data with multiple columns (like "15 15 1/2" or "Артикул Наименование Характеристика")
  const tabularPattern = /^(.+?)\s{2,}(.+?)(\s{2,}(.+))?$/;
  
  let hasStructuredData = false;
  let headerRow: string[] | null = null;
  
  // Try to detect header row - check first few lines for table-related keywords
  // Headers can be in first, second, or even third line
  const headerKeywords = /(артикул|наименование|характеристика|размер|диаметр|толщина|материал|цена|количество|номенклатура|габаритные|тип|резьба|наличие|покрытие|коробка|шт|единица|измерения|значение|l\s*,\s*мм|d\s*,\s*мм)/gi;
  
  // CRITICAL: Check for three-column structure: "Характеристика | Единица измерения | Значение"
  const threeColumnPattern = /(характеристика|единица|измерения|значение)/gi;
  const hasThreeColumnHeader = lines.some(line => {
    const parts = line.split(/\s{2,}|\|/).map(p => p.trim()).filter(p => p.length > 0);
    if (parts.length >= 3) {
      const lineText = line.toLowerCase();
      const hasChar = /характеристика/.test(lineText);
      const hasUnit = /единица|измерения/.test(lineText);
      const hasValue = /значение/.test(lineText);
      return hasChar && (hasUnit || hasValue);
    }
    return false;
  });
  
  if (hasThreeColumnHeader) {
    // Find the header line
    for (let i = 0; i < Math.min(3, lines.length); i++) {
      const line = lines[i];
      const parts = line.split(/\s{2,}|\|/).map(p => p.trim()).filter(p => p.length > 0);
      if (parts.length >= 3) {
        const lineText = line.toLowerCase();
        if (/характеристика/.test(lineText) && (/единица|измерения/.test(lineText) || /значение/.test(lineText))) {
          headerRow = parts;
          break;
        }
      }
    }
  }
  
  // If not found, try other patterns
  if (!headerRow) {
    for (let i = 0; i < Math.min(3, lines.length); i++) {
      const line = lines[i];
      if (headerKeywords.test(line)) {
        // This might be a header row
        if (multiColumnPattern.test(line)) {
          headerRow = line.split(/\s{2,}/).map(p => p.trim()).filter(p => p.length > 0);
          break;
        } else if (pipePattern.test(line)) {
          headerRow = line.split(/\s*\|\s*/).map(p => p.trim()).filter(p => p.length > 0);
          break;
        } else if (keyValuePattern.test(line)) {
          // For key-value tables, extract keys from first few lines
          const keys: string[] = [];
          for (let j = i; j < Math.min(i + 5, lines.length); j++) {
            const kvMatch = lines[j].match(keyValuePattern);
            if (kvMatch) {
              const key = kvMatch[1].trim();
              if (!keys.includes(key)) {
                keys.push(key);
              }
            }
          }
          if (keys.length >= 2) {
            headerRow = keys;
            break;
          }
        }
      }
    }
  }
  
  // If no header found but we have consistent column structure, try to infer headers
  if (!headerRow && lines.length >= 2) {
    // Check if first line looks like a header (mostly text, no numbers at start)
    const firstLine = lines[0];
    const secondLine = lines[1];
    
    // Check if second line starts with what looks like an article number
    const secondLineStartsWithArticle = /^\d{3,}/.test(secondLine.trim()) || 
      /^[0-9A-ZА-Я]{3,}(?:[-–][0-9A-ZА-Я]{2,})+/.test(secondLine.trim());
    
    // Check if first line contains article-related keywords
    const articleKeywords = /(артикул|наименование|номенклатура|код|номер|sku|article)/gi;
    const hasArticleKeywords = articleKeywords.test(firstLine);
    
    if (!/^\d+/.test(firstLine) && multiColumnPattern.test(firstLine)) {
      const parts = firstLine.split(/\s{2,}/).map(p => p.trim()).filter(p => p.length > 0);
      // If first line has mostly text (not numbers) or contains article keywords, it might be a header
      const textParts = parts.filter(p => /[А-ЯЁа-яёA-Za-z]/.test(p)).length;
      if ((textParts >= parts.length * 0.7 && parts.length >= 2) || (hasArticleKeywords && parts.length >= 2)) {
        headerRow = parts;
      }
    } else if (secondLineStartsWithArticle && hasArticleKeywords) {
      // First line is likely a header for article table
      if (multiColumnPattern.test(firstLine)) {
        headerRow = firstLine.split(/\s{2,}/).map(p => p.trim()).filter(p => p.length > 0);
      } else if (pipePattern.test(firstLine)) {
        headerRow = firstLine.split(/\s*\|\s*/).map(p => p.trim()).filter(p => p.length > 0);
      } else {
        // Try splitting by spaces
        const parts = firstLine.split(/\s+/).filter(p => p.trim().length > 0);
        if (parts.length >= 2) {
          headerRow = parts;
        }
      }
    }
  }
  
  // Track which line index corresponds to header (if found)
  let headerLineIndex = -1;
  if (headerRow) {
    // Find the line that matches the header
    for (let i = 0; i < Math.min(3, lines.length); i++) {
      if (headerKeywords.test(lines[i])) {
        headerLineIndex = i;
        break;
      }
    }
  }
  
  lines.forEach((line, lineIndex) => {
    // Skip header line if we identified it
    if (lineIndex === headerLineIndex) {
      return;
    }
    
    // Skip very short all-caps lines that are likely headers
    if (line.length < 50 && line === line.toUpperCase() && line.length < 80 && lineIndex === 0 && !headerRow) {
      return;
    }
    
    const row: Record<string, string | number | null> = {};
    
    // Try pipe-separated format first
    if (pipePattern.test(line)) {
      const parts = line.split(/\s*\|\s*/).map(p => p.trim()).filter(p => p.length > 0);
      if (parts.length >= 2) {
        if (headerRow && headerRow.length === parts.length) {
          // Use header row as keys - perfect match
          headerRow.forEach((header, idx) => {
            row[header] = parts[idx] || null;
          });
        } else if (headerRow && headerRow.length === 3 && parts.length === 3) {
          // Three-column structure: Характеристика | Единица измерения | Значение
          // Map to standard structure
          const headerLower = headerRow.map(h => h.toLowerCase());
          const charIdx = headerLower.findIndex(h => h.includes("характеристика"));
          const unitIdx = headerLower.findIndex(h => h.includes("единица") || h.includes("измерения"));
          const valueIdx = headerLower.findIndex(h => h.includes("значение"));
          
          if (charIdx >= 0) row["Характеристика"] = parts[charIdx] || null;
          if (unitIdx >= 0) row["Единица измерения"] = parts[unitIdx] || null;
          if (valueIdx >= 0) row["Значение"] = parts[valueIdx] || null;
          
          // Also keep original headers if they don't match standard
          if (charIdx < 0 || unitIdx < 0 || valueIdx < 0) {
            headerRow.forEach((header, idx) => {
              row[header] = parts[idx] || null;
            });
          }
        } else {
          // Default structure - try to infer
          if (parts.length >= 3) {
            // Check if this looks like Характеристика | Единица | Значение
            const firstPart = parts[0].toLowerCase();
            const secondPart = parts[1].toLowerCase();
            const thirdPart = parts[2].toLowerCase();
            
            if (/[а-яёa-z]/.test(firstPart) && !/^\d+/.test(firstPart)) {
              // First part is text - likely characteristic name
              row["Характеристика"] = parts[0];
              // Second part might be unit or value
              if (/^(бар|мпа|кг|м|см|мм|г|кдж|к|°[сc]|вт|квт|м\/с|м\/с²|м³|см³|г\/см³|лет|год|час|сут|%|dнар|шт|шт\.|шт\/|шт\/коробка|коробка|шт\/упак|упак|-)$/i.test(secondPart)) {
                row["Единица измерения"] = parts[1];
                row["Значение"] = parts[2];
              } else {
                row["Значение"] = parts[1];
                row["Единица измерения"] = parts[2] || null;
              }
            } else {
              // Generic structure
              row["Колонка 1"] = parts[0];
              row["Колонка 2"] = parts[1];
              row["Колонка 3"] = parts[2];
            }
          } else {
            row["Характеристика"] = parts[0];
            row["Значение"] = parts[1];
          }
        }
        hasStructuredData = true;
      }
    }
    // Try key-value format
    else if (keyValuePattern.test(line)) {
      const match = line.match(keyValuePattern);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        
        // Try to separate value and unit
        // Improved pattern to catch more unit types and handle ranges
        const valueUnitMatch = value.match(/^(.+?)\s+([а-яёa-z]{1,4}|°[СC]|бар|МПа|кг|м|см|мм|г|кДж|К|%|лет|год|час|сут|м³|см³|г\/см³|Вт|кВт|м\/с|м\/с²|Dнар\.|Dнар|шт|шт\.|шт\/|шт\/коробка|коробка|шт\/упак|упак)$/i);
        
        if (valueUnitMatch) {
          row["Характеристика"] = key;
          row["Значение"] = valueUnitMatch[1].trim();
          row["Единица измерения"] = valueUnitMatch[2].trim();
        } else {
          // Check for boolean values (есть/нет, да/нет)
          const booleanMatch = value.match(/^(есть|нет|да|нет|yes|no|\+|\-|✓|✗)$/i);
          if (booleanMatch) {
            row["Характеристика"] = key;
            row["Значение"] = booleanMatch[1].trim();
          } else {
            row["Характеристика"] = key;
            row["Значение"] = value;
          }
        }
        hasStructuredData = true;
      }
    }
    // Try multi-column format (spaces) - improved detection
    else if (multiColumnPattern.test(line)) {
      const parts = line.split(/\s{2,}/).map(p => p.trim()).filter(p => p.length > 0);
      if (parts.length >= 2) {
        if (headerRow && headerRow.length === parts.length) {
          // Use header row as keys - perfect match
          headerRow.forEach((header, idx) => {
            row[header] = parts[idx] || null;
          });
        } else if (headerRow && headerRow.length === 3 && parts.length === 3) {
          // Three-column structure: Характеристика | Единица измерения | Значение
          // Map to standard structure even if headers don't match exactly
          const headerLower = headerRow.map(h => h.toLowerCase());
          const charIdx = headerLower.findIndex(h => h.includes("характеристика"));
          const unitIdx = headerLower.findIndex(h => h.includes("единица") || h.includes("измерения"));
          const valueIdx = headerLower.findIndex(h => h.includes("значение"));
          
          if (charIdx >= 0) row["Характеристика"] = parts[charIdx] || null;
          if (unitIdx >= 0) row["Единица измерения"] = parts[unitIdx] || null;
          if (valueIdx >= 0) row["Значение"] = parts[valueIdx] || null;
          
          // Also keep original headers
          headerRow.forEach((header, idx) => {
            if (!row[header]) {
              row[header] = parts[idx] || null;
            }
          });
        } else if (headerRow && headerRow.length > parts.length) {
          // Header has more columns - use available headers
          headerRow.slice(0, parts.length).forEach((header, idx) => {
            row[header] = parts[idx] || null;
          });
        } else if (headerRow && headerRow.length < parts.length) {
          // Data has more columns - use headers + generic names
          headerRow.forEach((header, idx) => {
            row[header] = parts[idx] || null;
          });
          // Add remaining columns with generic names
          for (let i = headerRow.length; i < parts.length; i++) {
            row[`Колонка ${i + 1}`] = parts[i];
          }
        } else {
          // No header - try to infer structure
          // Check if this looks like Характеристика | Единица | Значение pattern
          if (parts.length === 3) {
            const firstPart = parts[0].toLowerCase();
            const secondPart = parts[1].toLowerCase();
            const thirdPart = parts[2].toLowerCase();
            
            // If first part is text (characteristic name) and second/third are values/units
            if (/[а-яёa-z]/.test(firstPart) && !/^\d+/.test(firstPart)) {
              row["Характеристика"] = parts[0];
              // Check if second part is unit or value
              if (/^(бар|мпа|кг|м|см|мм|г|кдж|к|°[сc]|вт|квт|м\/с|м\/с²|м³|см³|г\/см³|лет|год|час|сут|%|dнар|шт|шт\.|шт\/|шт\/коробка|коробка|шт\/упак|упак|-|×|×\s*днар)$/i.test(secondPart)) {
                row["Единица измерения"] = parts[1];
                row["Значение"] = parts[2];
              } else if (/^(бар|мпа|кг|м|см|мм|г|кдж|к|°[сc]|вт|квт|м\/с|м\/с²|м³|см³|г\/см³|лет|год|час|сут|%|dнар|шт|шт\.|шт\/|шт\/коробка|коробка|шт\/упак|упак|-|×|×\s*днар)$/i.test(thirdPart)) {
                row["Значение"] = parts[1];
                row["Единица измерения"] = parts[2];
              } else {
                // Both are values, second might be unit
                row["Значение"] = parts[1];
                row["Единица измерения"] = parts[2] || null;
              }
            } else {
              // Generic structure
              parts.forEach((part, idx) => {
                if (idx === 0 && /^\d{3,}$/.test(part)) {
                  row["Артикул"] = part;
                } else if (idx === 0 && /^[A-ZА-Я]{1,5}$/.test(part)) {
                  row["Тип"] = part;
                } else {
                  row[`Колонка ${idx + 1}`] = part;
                }
              });
            }
          } else {
            // Generic structure
            parts.forEach((part, idx) => {
              if (idx === 0 && /^\d{3,}$/.test(part)) {
                row["Артикул"] = part;
              } else if (idx === 0 && /^[A-ZА-Я]{1,5}$/.test(part)) {
                row["Тип"] = part;
              } else {
                row[`Колонка ${idx + 1}`] = part;
              }
            });
          }
        }
        hasStructuredData = true;
      }
    }
    // Try tabular pattern (like "15 15 1/2" or data rows)
    else if (tabularPattern.test(line) && !keyValuePattern.test(line)) {
      const match = line.match(tabularPattern);
      if (match) {
        const parts = line.split(/\s{2,}/).map(p => p.trim()).filter(p => p.length > 0);
        if (parts.length >= 2) {
          if (headerRow && headerRow.length === parts.length) {
            headerRow.forEach((header, idx) => {
              row[header] = parts[idx] || null;
            });
          } else {
            // Create generic column names
            parts.forEach((part, idx) => {
              row[`Колонка ${idx + 1}`] = part;
            });
          }
          hasStructuredData = true;
        }
      }
    }
    
    // Only add row if it has data
    if (Object.keys(row).length > 0) {
      rows.push(row);
    }
  });
  
  return hasStructuredData && rows.length > 0 ? rows : undefined;
}

/**
 * Extract products from table rows that contain article numbers (артикул)
 * Handles various table formats with article numbers and product names
 * @param isNomenclatureTable - если true, извлекает ВСЕ строки как продукты (для таблиц "Номенклатура ...")
 */
function extractProductsFromTableRows(
  tableRows: Array<Record<string, string | number | null>>,
  sectionPath?: string,
  pageNumber?: number,
  isNomenclatureTable: boolean = false
): StructuredProduct[] {
  if (!tableRows || tableRows.length === 0) return [];

  const products: StructuredProduct[] = [];
  const seen = new Set<string>();

  // Common column name variations for article numbers
  const articleColumnNames = [
    "артикул", "Артикул", "АРТИКУЛ",
    "sku", "SKU", "Sku",
    "код", "Код", "КОД",
    "номер", "Номер", "НОМЕР",
    "article", "Article", "ARTICLE"
  ];

  // Common column name variations for product names
  const nameColumnNames = [
    "наименование", "Наименование", "НАИМЕНОВАНИЕ",
    "название", "Название", "НАЗВАНИЕ",
    "name", "Name", "NAME",
    "товар", "Товар", "ТОВАР",
    "продукт", "Продукт", "ПРОДУКТ"
  ];

  // Find article column index in first row (header row might be first)
  let articleColumn: string | null = null;
  let nameColumn: string | null = null;

  // Check first row to identify column names
  const firstRow = tableRows[0];
  if (firstRow) {
    const keys = Object.keys(firstRow);
    
    // Find article column
    for (const colName of articleColumnNames) {
      const found = keys.find(k => 
        k.toLowerCase() === colName.toLowerCase() ||
        k.toLowerCase().includes(colName.toLowerCase()) ||
        colName.toLowerCase().includes(k.toLowerCase())
      );
      if (found) {
        articleColumn = found;
        break;
      }
    }

    // Find name column
    for (const colName of nameColumnNames) {
      const found = keys.find(k => 
        k.toLowerCase() === colName.toLowerCase() ||
        k.toLowerCase().includes(colName.toLowerCase()) ||
        colName.toLowerCase().includes(k.toLowerCase())
      );
      if (found) {
        nameColumn = found;
        break;
      }
    }

    // If no explicit article column found, check if first column contains article numbers
    if (!articleColumn && keys.length > 0) {
      const firstColValue = String(firstRow[keys[0]] || "").trim();
      // Check if first column looks like article numbers (3+ digits or alphanumeric codes)
      if (/^\d{3,}$/.test(firstColValue) || /^[0-9A-ZА-Я]{3,}(?:[-–][0-9A-ZА-Я]{2,})+$/.test(firstColValue)) {
        articleColumn = keys[0];
      }
    }
  }

  // Process each row
  for (const row of tableRows) {
    // Skip header rows (rows that contain only text keywords)
    // Для таблиц "Номенклатура ..." более строгая проверка заголовка
    const rowValues = Object.values(row).map(v => String(v || "").toLowerCase());
    const isHeaderRow = rowValues.some(v => 
      articleColumnNames.some(name => v.includes(name.toLowerCase())) ||
      nameColumnNames.some(name => v.includes(name.toLowerCase())) ||
      (isNomenclatureTable && (
        v.includes("диаметр") || 
        v.includes("толщина") || 
        v.includes("длина") ||
        v.includes("характеристика") ||
        v.includes("единица") ||
        v.includes("измерения")
      ))
    );
    
    // Для таблиц номенклатуры пропускаем только явные заголовки
    if (isHeaderRow && tableRows.length > 1) {
      // Дополнительная проверка: если это таблица номенклатуры и строка содержит только заголовки колонок без данных
      if (isNomenclatureTable) {
        // Проверяем, есть ли в строке хотя бы одно числовое значение (если нет - это заголовок)
        const hasNumericValue = Object.values(row).some(v => {
          const str = String(v || "");
          return /^\d+([.,]\d+)?$/.test(str.trim()) || /^\d+[x×]\d+/.test(str.trim());
        });
        if (!hasNumericValue) {
          continue; // Это заголовок - пропускаем
        }
      } else {
        continue; // Skip header row для обычных таблиц
      }
    }

    let sku: string | null = null;
    let productName: string | undefined = undefined;

    // Try to extract SKU from article column
    if (articleColumn && row[articleColumn]) {
      const skuValue = String(row[articleColumn]).trim();
      // Validate SKU format (should be 3+ characters, contain digits or alphanumeric)
      if (skuValue.length >= 3 && (/^\d{3,}$/.test(skuValue) || /^[0-9A-ZА-Я]{3,}(?:[-–][0-9A-ZА-Я]{2,})+$/.test(skuValue) || /[0-9A-ZА-Я]{3,}/.test(skuValue))) {
        sku = skuValue;
      }
    }

    // If no article column found, try to find SKU in any column
    if (!sku) {
      for (const [key, value] of Object.entries(row)) {
        const valueStr = String(value || "").trim();
        // Check if this looks like an article number
        if (valueStr.length >= 3 && (
          /^\d{3,}$/.test(valueStr) || 
          /^[0-9A-ZА-Я]{3,}(?:[-–][0-9A-ZА-Я]{2,})+$/.test(valueStr) ||
          (/[0-9A-ZА-Я]{3,}/.test(valueStr) && !/[а-яё]{3,}/i.test(valueStr))
        )) {
          // Skip if it's a unit of measurement
          if (!/^(бар|мпа|кг|м|см|мм|г|кдж|к|°[сc]|вт|квт|м\/с|м\/с²|м³|см³|г\/см³|лет|год|час|сут|%|dнар|шт|шт\.|шт\/|шт\/коробка|коробка|шт\/упак|упак)$/i.test(valueStr)) {
            sku = valueStr;
            articleColumn = key; // Remember this column for future rows
            break;
          }
        }
      }
    }

    // Extract product name
    if (nameColumn && row[nameColumn]) {
      const nameValue = String(row[nameColumn]).trim();
      if (nameValue.length > 0 && !articleColumnNames.some(n => nameValue.toLowerCase().includes(n.toLowerCase()))) {
        productName = nameValue;
      }
    }

    // If no explicit name column, try second column (often contains names)
    if (!productName && Object.keys(row).length > 1) {
      const keys = Object.keys(row);
      const secondColKey = keys[1];
      if (secondColKey && row[secondColKey]) {
        const secondColValue = String(row[secondColKey]).trim();
        // Check if it looks like a name (contains letters, not just numbers/units)
        if (secondColValue.length > 2 && /[А-ЯЁа-яёA-Za-z]{2,}/.test(secondColValue)) {
          productName = secondColValue;
        }
      }
    }

    // Для таблиц "Номенклатура ..." извлекаем ВСЕ строки с артикулами
    // Для обычных таблиц - только строки с валидным SKU
    if (isNomenclatureTable) {
      // В таблицах номенклатуры артикул обязателен, но если его нет - пробуем найти в первой колонке
      if (!sku && Object.keys(row).length > 0) {
        const firstColKey = Object.keys(row)[0];
        const firstColValue = String(row[firstColKey] || "").trim();
        // Проверяем, является ли первая колонка артикулом (4+ цифры)
        if (/^\d{4,}$/.test(firstColValue)) {
          sku = firstColValue;
          articleColumn = firstColKey;
        }
      }
      
      // Если артикул найден - создаем продукт
      if (sku && sku.length >= 3) {
        const normalizedSku = sku.replace(/\s+/g, "").replace(/[–—]/g, "-");
        
        if (!seen.has(normalizedSku)) {
          seen.add(normalizedSku);

          // Создаем атрибуты из всех данных строки кроме артикула и названия
          const attributes: Record<string, string | number | null> = {};
          for (const [key, value] of Object.entries(row)) {
            if (key !== articleColumn && key !== nameColumn) {
              attributes[key] = value;
            }
          }

          products.push({
            sku: normalizedSku,
            name: productName,
            attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
            sectionPath,
            pageNumber,
          });
        }
      }
    } else {
      // Обычная логика для других таблиц
      // Only add product if we found a valid SKU
      if (sku && sku.length >= 3) {
        // Normalize SKU (remove extra spaces, normalize dashes)
        const normalizedSku = sku.replace(/\s+/g, "").replace(/[–—]/g, "-");
        
        if (!seen.has(normalizedSku)) {
          seen.add(normalizedSku);

          // Create attributes object from all row data except SKU and name
          const attributes: Record<string, string | number | null> = {};
          for (const [key, value] of Object.entries(row)) {
            if (key !== articleColumn && key !== nameColumn) {
              attributes[key] = value;
            }
          }

          products.push({
            sku: normalizedSku,
            name: productName,
            attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
            sectionPath,
            pageNumber,
          });
        }
      }
    }
  }

  return products;
}

function extractProductsFromText(
  text: string,
  sectionPath?: string,
  pageNumber?: number
): StructuredProduct[] {
  const matches =
    text.match(/\b[0-9A-ZА-Я]{3,}(?:[-–][0-9A-ZА-Я]{2,})+\b|\b[0-9A-ZА-Я]*\d{3,}[0-9A-ZА-Я]*\b/g) ?? [];
  if (matches.length === 0) return [];

  const products: StructuredProduct[] = [];
  const seen = new Set<string>();

  // Try to extract product name from text
  // Pattern 1: Section number with product name in quotes: "1.3. Труба «Стабил»"
  const sectionWithQuotesMatch = text.match(/^\d+(?:\.\d+)*\.\s+[А-ЯЁA-Z][а-яёa-z\s\-–—]+?[«"']([А-ЯЁA-Z][а-яёa-z\s\-–—]+?)[»"']/);
  let productName: string | undefined = undefined;
  if (sectionWithQuotesMatch && sectionWithQuotesMatch[1]) {
    productName = sectionWithQuotesMatch[1].trim();
  } else {
    // Pattern 2: Section number with product name: "1.3. Труба Стабил"
    const sectionWithNameMatch = text.match(/^\d+(?:\.\d+)*\.\s+(?:Труба|Фитинг|Крепёж|Изделие|Станция|Радиатор|Коллектор)\s+([А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)*)/);
    if (sectionWithNameMatch && sectionWithNameMatch[1]) {
      productName = sectionWithNameMatch[1].trim();
    } else {
      // Pattern 3: Product name in quotes: «Стабил» or "Стабил"
      const quotesMatch = text.match(/[«"']([А-ЯЁA-Z][а-яёa-z\s]+?)[»"']/);
      if (quotesMatch && quotesMatch[1]) {
        productName = quotesMatch[1].trim();
      }
    }
  }

  for (const sku of matches) {
    if (seen.has(sku)) continue;

    const hasLetter = /[A-ZА-Я]/i.test(sku);
    const digitCount = (sku.match(/\d/g) ?? []).length;

    if (!hasLetter && digitCount <= 4) {
      continue;
    }

    seen.add(sku);

    products.push({
      sku,
      name: productName, // Use extracted product name
      sectionPath,
      pageNumber,
    });
  }

  return products;
}

export async function parsePdfDocument(filePath: string): Promise<StructuredDocument> {
  const { meta, pages, pagesWithFonts } = await parsePdfWithPages(filePath);

  const sections: DocumentSection[] = [];
  const elements: StructuredElement[] = [];
  const products: StructuredProduct[] = [];

  // ✅ Извлекаем header'ы всех страниц
  const pageHeaders = new Map<number, PageHeader>();
  try {
    pagesWithFonts.forEach((pageWithFonts, pageIndex) => {
      const pageNumber = pageIndex + 1;
      try {
        const header = extractPageHeader(pageWithFonts, pageNumber);
        if (header) {
          pageHeaders.set(pageNumber, header);
        }
      } catch (error) {
        console.error(`[StructuredParser] Ошибка извлечения header'а для страницы ${pageNumber}:`, error);
        // Продолжаем обработку других страниц
      }
    });
  } catch (error) {
    console.error(`[StructuredParser] Ошибка при извлечении header'ов:`, error);
    // Продолжаем обработку без header'ов
  }

  // First pass: detect all sections and their page ranges
  const sectionMap = new Map<string, DocumentSection>();
  const sectionsByPage = new Map<number, string>(); // pageNumber -> sectionPath
  const sectionOrder: string[] = []; // Track order of sections as they appear
  
  // Отслеживаем текущий активный раздел для правильного закрытия
  let currentActiveSection: DocumentSection | null = null;
  
  pagesWithFonts.forEach((pageWithFonts, pageIndex) => {
    const pageNumber = pageIndex + 1;
    const averageFontSize = pageWithFonts.averageFontSize;

    pageWithFonts.lines.forEach((lineWithFont, lineIndex) => {
      const line = lineWithFont.text.trim();
      if (!line) return;
      
      // Получаем Y-координату строки (baseline) для точного определения границ
      // Используем baseline если доступен, иначе fontSize как fallback
      const lineY = lineWithFont.baseline ?? lineWithFont.fontSize;
      
      const detected = detectSectionFromLine(line, lineWithFont.fontSize, averageFontSize, lineWithFont.isBold);
      if (detected) {
        console.log(`[StructuredParser] ✓ Section detected: ${detected.sectionPath} "${detected.title}" on page ${pageNumber}, line ${lineIndex} (font: ${lineWithFont.fontSize.toFixed(1)}, avg: ${averageFontSize.toFixed(1)}, bold: ${lineWithFont.isBold})`);
      }
      if (!detected) return;

      // Используем нормализованный sectionPath
      const sectionPath = detected.sectionPath;
      const parentPath = sectionPath.includes(".") && sectionPath !== "warranty"
        ? sectionPath.split(".").slice(0, -1).join(".")
        : undefined;

      // Check if this section already exists
      const existingSection = sectionMap.get(sectionPath);
      
      if (!existingSection) {
        // New VALID section detected - close previous sections properly
        // КРИТИЧЕСКИ ВАЖНО: Закрываем предыдущий раздел ДО текущей строки с новым заголовком
        
        const pathParts = sectionPath.split('.');
        const parentPathForSiblings = pathParts.length > 1 && sectionPath !== "warranty" 
          ? pathParts.slice(0, -1).join('.') 
          : null;
        
        // Закрываем текущий активный раздел ДО начала нового раздела
        if (currentActiveSection) {
          // Закрываем раздел на текущей странице ДО строки с новым заголовком
          currentActiveSection.pageEnd = pageNumber;
          currentActiveSection.endLineIndex = lineIndex - 1; // До текущей строки
          // Используем lineY только если он валидный (не null/undefined)
          if (lineY !== null && lineY !== undefined && !isNaN(lineY)) {
            currentActiveSection.endY = lineY - 1; // До Y-координаты нового заголовка
          }
          console.log(`[StructuredParser] Closed section ${currentActiveSection.sectionPath} on page ${pageNumber}, before line ${lineIndex}`);
        }
        
        // Специальная обработка для warranty: не закрываем другие секции как siblings
        // (warranty - это ненумерованная секция, она не имеет числового пути)
        if (sectionPath !== "warranty") {
          // Close sibling sections (same parent level)
          // For example: if we see "1.2", close "1.1" (sibling with same parent "1")
          // If we see "2", close "1" (sibling at top level)
          for (const [existingSectionPath, section] of sectionMap.entries()) {
            // Пропускаем warranty при закрытии siblings
            if (existingSectionPath === "warranty") continue;
            
            // Пропускаем текущую секцию
            if (existingSectionPath === sectionPath) continue;
            
            // Пропускаем уже закрытую секцию
            if (section.pageEnd && section.pageEnd < pageNumber) continue;
            
            const sectionPathParts = existingSectionPath.split('.');
            const sectionParentPath = sectionPathParts.length > 1 ? sectionPathParts.slice(0, -1).join('.') : null;
            
            // Close if same parent and different section (sibling)
            // Examples:
            // - "1.1" and "1.2" both have parent "1" -> siblings
            // - "1" and "2" both have parent null -> siblings at top level
            const isSibling = (
              (parentPathForSiblings === null && sectionParentPath === null) || // Both top-level
              (parentPathForSiblings !== null && sectionParentPath === parentPathForSiblings) // Same parent
            );
            
            if (isSibling) {
              // Закрываем sibling раздел на текущей странице ДО строки с новым заголовком
              const currentEnd = section.pageEnd ?? section.pageStart ?? Infinity;
              if (currentEnd >= pageNumber) {
                section.pageEnd = pageNumber;
                section.endLineIndex = lineIndex - 1; // До текущей строки
                // Используем lineY только если он валидный (не null/undefined)
                if (lineY !== null && lineY !== undefined && !isNaN(lineY)) {
                  section.endY = lineY - 1; // До Y-координаты нового заголовка
                }
                console.log(`[StructuredParser] Closed sibling section ${section.sectionPath} on page ${pageNumber}, before line ${lineIndex}`);
              }
            }
          }
        }
        
        // Create new section with position information
        const section: DocumentSection = {
          sectionPath: sectionPath,
          title: detected.title,
          level: detected.level,
          parentPath: parentPath,
          pageStart: pageNumber,
          pageEnd: pageNumber, // Будет обновлено при обнаружении следующего раздела
          isNumericSection: detected.isNumericSection,
          startLineIndex: lineIndex, // Позиция начала раздела на странице
          startY: (lineY !== null && lineY !== undefined && !isNaN(lineY)) ? lineY : undefined, // Y-координата начала раздела
        };
        
        sectionMap.set(sectionPath, section);
        sections.push(section);
        sectionOrder.push(sectionPath);
        currentActiveSection = section; // Обновляем текущий активный раздел
      } else {
        // Section already exists - just update pageEnd if needed
        // Это может произойти если раздел продолжается на следующей странице
        if ((existingSection.pageEnd ?? existingSection.pageStart ?? Infinity) < pageNumber) {
          existingSection.pageEnd = pageNumber;
        }
        currentActiveSection = existingSection; // Обновляем текущий активный раздел
      }
      
      // Mark this page as belonging to this section
      sectionsByPage.set(pageNumber, sectionPath);
    });
  });
  
  // Final pass: close all remaining open sections at the end of document
  const lastPage = pages.length;
  const lastPageLines = pagesWithFonts[pagesWithFonts.length - 1]?.lines.length || 0;
  for (const section of sectionMap.values()) {
    if ((section.pageEnd ?? section.pageStart ?? Infinity) >= lastPage) {
      section.pageEnd = lastPage;
      // Если раздел еще не закрыт, закрываем его в конце последней страницы
      if (section.endLineIndex === undefined) {
        section.endLineIndex = lastPageLines - 1;
      }
    }
  }
  
  // Закрываем текущий активный раздел в конце документа
  if (currentActiveSection && (currentActiveSection.pageEnd ?? currentActiveSection.pageStart ?? Infinity) >= lastPage) {
    currentActiveSection.pageEnd = lastPage;
    if (currentActiveSection.endLineIndex === undefined) {
      currentActiveSection.endLineIndex = lastPageLines - 1;
    }
  }

  // ✅ Корректируем границы разделов на основе header'ов страниц
  let correctedSections: DocumentSection[];
  try {
    correctedSections = correctSectionBoundariesWithHeaders(sections, pageHeaders);
  } catch (error) {
    console.error(`[StructuredParser] Ошибка при корректировке границ разделов на основе header'ов:`, error);
    // Используем оригинальные разделы в случае ошибки
    correctedSections = sections;
  }
  
  // Обновляем sectionMap с исправленными разделами
  sectionMap.clear();
  correctedSections.forEach(s => sectionMap.set(s.sectionPath, s));
  
  // Обновляем sectionsByPage на основе исправленных разделов
  sectionsByPage.clear();
  correctedSections.forEach(section => {
    if (section.pageStart && section.pageEnd) {
      for (let page = section.pageStart; page <= section.pageEnd; page++) {
        sectionsByPage.set(page, section.sectionPath);
      }
    }
  });

  // Build a map of page ranges for each section
  // For each page, determine which section it belongs to
  const pageToSectionMap = new Map<number, string>();
  const sortedSections = [...correctedSections].sort((a, b) => {
    const pageDiff = (a.pageStart ?? Infinity) - (b.pageStart ?? Infinity);
    if (pageDiff !== 0) return pageDiff;
    // If same page, prefer more specific (deeper) sections
    return (b.level ?? 0) - (a.level ?? 0);
  });

  // For each page, find the most specific section that contains it
  pages.forEach((_, index) => {
    const pageNumber = index + 1;
    
    // First, check if this page has a section header
    if (sectionsByPage.has(pageNumber)) {
      pageToSectionMap.set(pageNumber, sectionsByPage.get(pageNumber)!);
      return;
    }
    
    // Find the section that starts on or before this page and ends on or after this page
    let bestSection: DocumentSection | null = null;
    for (const section of sortedSections) {
      const start = section.pageStart ?? Infinity;
      const end = section.pageEnd ?? Infinity;
      if (pageNumber >= start && pageNumber <= end) {
        // Prefer more specific (deeper) sections
        if (!bestSection || (section.level ?? 0) > (bestSection.level ?? 0)) {
          bestSection = section;
        }
      }
    }
    
    if (bestSection) {
      pageToSectionMap.set(pageNumber, bestSection.sectionPath);
    } else {
      // Find the last section that started before this page and is still open
      for (let i = sortedSections.length - 1; i >= 0; i--) {
        const section = sortedSections[i];
        const start = section.pageStart ?? Infinity;
        const end = section.pageEnd ?? Infinity;
        if (start <= pageNumber && end >= pageNumber) {
          pageToSectionMap.set(pageNumber, section.sectionPath);
          break;
        }
      }
    }
  });

  // Second pass: process elements and assign them to correct sections
  // Find the first valid section (preferably "1" or the first section found, but not "0")
  const firstValidSection = sections
    .filter(s => s.sectionPath && s.sectionPath !== "0" && !/^\d{4,}$/.test(s.sectionPath))
    .sort((a, b) => {
      // Prefer section "1" if it exists
      if (a.sectionPath === "1") return -1;
      if (b.sectionPath === "1") return 1;
      // Otherwise sort by pageStart
      return (a.pageStart ?? Infinity) - (b.pageStart ?? Infinity);
    })[0] || sections.find(s => s.sectionPath && s.sectionPath !== "0") || sections[0];
  
  let currentSectionPath = firstValidSection?.sectionPath ?? "1";
  let currentSectionTitle = firstValidSection?.title ?? "Введение";
  let currentLevel = firstValidSection?.level ?? 1;

  pagesWithFonts.forEach((pageWithFonts, index) => {
    const pageNumber = index + 1;
    const rawPageText = pages[index];
    const averageFontSize = pageWithFonts.averageFontSize;
    
    if (index === 0) {
      console.log("[StructuredParser] Sample page text:", rawPageText.slice(0, 400));
      console.log("[StructuredParser] Average font size:", averageFontSize);
    }
    
    // Update current section based on page
    // ✅ Сначала проверяем header страницы, затем pageToSectionMap
    const pageHeader = pageHeaders.get(pageNumber);
    if (pageHeader && pageHeader.sectionPath) {
      const section = sectionMap.get(pageHeader.sectionPath);
      if (section) {
        currentSectionPath = section.sectionPath;
        currentSectionTitle = section.title;
        currentLevel = section.level;
      }
    } else {
      const pageSection = pageToSectionMap.get(pageNumber);
      if (pageSection) {
        const section = sectionMap.get(pageSection);
        if (section) {
          currentSectionPath = section.sectionPath;
          currentSectionTitle = section.title;
          currentLevel = section.level;
        }
      }
    }
    
    // КРИТИЧЕСКИ ВАЖНО: Обрабатываем элементы построчно для правильной привязки к разделам
    // Создаем карту разделов для каждой строки на странице
    const lineToSectionMap = new Map<number, string>(); // lineIndex -> sectionPath
    
    // Сначала определяем раздел для каждой строки на основе позиции
    pageWithFonts.lines.forEach((lineWithFont, lineIndex) => {
      const line = lineWithFont.text.trim();
      if (!line) return;
      
      // Проверяем, является ли это заголовком нового раздела
      const detected = detectSectionFromLine(line, lineWithFont.fontSize, averageFontSize, lineWithFont.isBold);
      
      if (detected) {
        // Это заголовок нового раздела - переключаемся на новый раздел С этой строки
        currentSectionPath = detected.sectionPath;
        const section = sectionMap.get(detected.sectionPath);
        if (section) {
          currentSectionTitle = section.title;
          currentLevel = section.level;
        }
        // Все строки начиная с этой относятся к новому разделу
        lineToSectionMap.set(lineIndex, detected.sectionPath);
      } else {
        // Это не заголовок раздела - используем текущий активный раздел
        // Используем текущий раздел для этой строки
        lineToSectionMap.set(lineIndex, currentSectionPath);
      }
    });

    // CRITICAL: First try to split into table blocks to detect multiple tables
    // Then process each block separately
    // This ensures that multiple tables in a section are processed as separate elements
    const tableBlocks = splitIntoTableBlocks(rawPageText);
    
    // If we found multiple table blocks, process them separately
    // Otherwise, use regular paragraph splitting
    // But still check each paragraph for table structure
    const blocksToProcess = tableBlocks.length > 1 && tableBlocks.some(b => guessElementType(b) === "table") 
      ? tableBlocks 
      : splitIntoParagraphs(rawPageText);
    
    // Определяем раздел для каждого блока на основе его позиции в тексте
    blocksToProcess.forEach((block) => {
      // Находим позицию блока в тексте страницы
      const blockStartIndex = rawPageText.indexOf(block);
      // Приблизительно определяем строку, к которой относится блок
      const linesBeforeBlock = rawPageText.slice(0, blockStartIndex).split('\n').length - 1;
      const blockLineIndex = Math.max(0, linesBeforeBlock - 1);
      
      // Определяем раздел для этого блока
      const blockSectionPath = lineToSectionMap.get(blockLineIndex) || currentSectionPath;
      const blockSection = sectionMap.get(blockSectionPath);
      const blockSectionTitle = blockSection?.title || currentSectionTitle;
      // For potential tables, preserve structure better - don't normalize too aggressively
      const elementTypeGuess = guessElementType(block);
      let content: string;
      
      if (elementTypeGuess === "table") {
        // For tables, preserve original text structure (spaces, formatting)
        // Only normalize excessive whitespace, but keep structure
        content = block.replace(/\s{3,}/g, "  ").trim(); // Keep double spaces, remove triple+
      } else {
        content = normalizeText(block);
      }
      
      if (content.length < 40) return;

      const elementType = elementTypeGuess;
      
      // Try to extract table rows from text if it's detected as a table
      let tableRows: Array<Record<string, string | number | null>> | undefined = undefined;
      if (elementType === "table") {
        tableRows = extractTableRowsFromText(content);
        // Debug logging for catalog documents
        if (tableRows && tableRows.length > 0) {
          console.log(`[StructuredParser] Extracted ${tableRows.length} table rows from page ${pageNumber}, section ${blockSectionPath}`);
          // Log first few rows for debugging
          tableRows.slice(0, 5).forEach((row, idx) => {
            const rowStr = JSON.stringify(row);
            console.log(`[StructuredParser] Row ${idx + 1}: ${rowStr}`);
            // Check for thickness values specifically
            if (rowStr.includes("Толщина") || rowStr.includes("толщина")) {
              console.log(`[StructuredParser] ⚠️ THICKNESS ROW FOUND: ${rowStr}`);
            }
          });
        } else {
          // Log if table was detected but rows weren't extracted
          console.log(`[StructuredParser] ⚠️ Table detected but no rows extracted from page ${pageNumber}, section ${blockSectionPath}`);
          console.log(`[StructuredParser] Content preview: ${content.slice(0, 300)}...`);
        }
      }

      // Определяем правильный раздел для этого элемента на основе его позиции
      // Используем раздел, определенный для блока на основе его позиции в тексте
      let elementSectionPath = blockSectionPath;
      let elementSectionTitle = blockSectionTitle;
      
      // Дополнительная проверка: если на странице есть несколько разделов, используем раздел на основе позиции
      // Это гарантирует, что элементы до заголовка нового раздела попадают в предыдущий раздел
      const pageSection = pageToSectionMap.get(pageNumber);
      if (pageSection && pageSection !== blockSectionPath) {
        // Проверяем, какой раздел активен в позиции блока
        const section = sectionMap.get(pageSection);
        if (section) {
          // Если раздел начинается на этой странице, проверяем позицию
          if (section.pageStart === pageNumber && section.startLineIndex !== undefined) {
            // Если блок находится ДО начала нового раздела, используем предыдущий раздел
            if (blockLineIndex < section.startLineIndex) {
              // Ищем предыдущий раздел на этой странице
              const previousSection = Array.from(sectionMap.values())
                .filter(s => s.pageStart === pageNumber && s.startLineIndex !== undefined && s.startLineIndex < section.startLineIndex!)
                .sort((a, b) => (b.startLineIndex ?? 0) - (a.startLineIndex ?? 0))[0];
              if (previousSection) {
                elementSectionPath = previousSection.sectionPath;
                elementSectionTitle = previousSection.title;
              }
            } else {
              // Блок находится после начала нового раздела - используем новый раздел
              elementSectionPath = section.sectionPath;
              elementSectionTitle = section.title;
            }
          } else {
            // Раздел начался на предыдущей странице - используем его
            elementSectionPath = section.sectionPath;
            elementSectionTitle = section.title;
          }
        }
      }

      const element: StructuredElement = {
        pageNumber,
        sectionPath: elementSectionPath,
        heading: elementSectionTitle,
        elementType,
        content,
        tableRows,
        language: "ru",
      };

      elements.push(element);
      
      // Extract products from table rows if available
      // Специальная обработка для таблиц "Номенклатура ..." - извлекаем ВСЕ товары
      if (tableRows && tableRows.length > 0) {
        // Проверяем, является ли это таблицей "Номенклатура ..."
        // Проверяем заголовок элемента, текст перед таблицей или первые строки таблицы
        const contentLower = content.toLowerCase();
        const sectionTitleLower = elementSectionTitle?.toLowerCase() || "";
        
        // Проверяем наличие слова "номенклатура" в различных местах
        const hasNomenclatureInTitle = sectionTitleLower.includes("номенклатура");
        const hasNomenclatureInContent = contentLower.includes("номенклатура");
        
        // Также проверяем структуру таблицы - если есть колонки "Артикул" и "Наименование" - это может быть номенклатура
        const hasArticleColumn = tableRows.some(row => {
          const keys = Object.keys(row);
          return keys.some(k => /артикул/i.test(k));
        });
        const hasNameColumn = tableRows.some(row => {
          const keys = Object.keys(row);
          return keys.some(k => /наименование/i.test(k));
        });
        const isLikelyNomenclature = hasArticleColumn && hasNameColumn && tableRows.length > 2;
        
        const isNomenclatureTable = 
          hasNomenclatureInTitle ||
          hasNomenclatureInContent ||
          isLikelyNomenclature;
        
        if (isNomenclatureTable) {
          console.log(`[StructuredParser] Detected nomenclature table on page ${pageNumber}, section ${elementSectionPath}`);
        }
        
        const tableProducts = extractProductsFromTableRows(
          tableRows, 
          elementSectionPath, 
          pageNumber,
          isNomenclatureTable // Передаем флаг, что это таблица номенклатуры
        );
        if (tableProducts.length > 0) {
          console.log(`[StructuredParser] Extracted ${tableProducts.length} products from ${isNomenclatureTable ? 'nomenclature ' : ''}table on page ${pageNumber}, section ${elementSectionPath}`);
          products.push(...tableProducts);
        }
      }
      
      // Also extract products from text content (for non-table products)
      products.push(...extractProductsFromText(content, elementSectionPath, pageNumber));
    });
  });

  const toc = correctedSections.map((section) => ({
    ...section,
  }));

  const title = meta.title;

  return {
    title,
    numPages: meta.numPages,
    sections: correctedSections,
    toc,
    elements,
    products,
  };
}

export async function parseXlsxDocument(filePath: string): Promise<StructuredDocument> {
  const workbook = XLSX.readFile(filePath);
  const sections: DocumentSection[] = [];
  const elements: StructuredElement[] = [];
  const products: StructuredProduct[] = [];

  workbook.SheetNames.forEach((sheetName, sheetIndex) => {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: "" });

    const sectionPath = `${sheetIndex + 1}`;
    sections.push({
      sectionPath,
      title: sheetName,
      level: 1,
      pageStart: sheetIndex + 1,
      pageEnd: sheetIndex + 1,
      isNumericSection: true,
    });

    rows.forEach((row, rowIndex) => {
      const rowContent = Object.entries(row)
        .map(([key, value]) => `${key}: ${value}`)
        .join("; ");

      elements.push({
        pageNumber: rowIndex + 1,
        sectionPath,
        heading: sheetName,
        elementType: "table",
        content: rowContent,
        tableRows: [row],
        language: "ru",
      });

      const skuCandidate = row["sku"] || row["артикул"] || row["SKU"] || row["Артикул"];
      if (skuCandidate) {
        products.push({
          sku: String(skuCandidate),
          name: String(row["name"] || row["Наименование"] || row["Название"] || ""),
          attributes: row,
          sectionPath,
          pageNumber: rowIndex + 1,
        });
      }
    });
  });

  return {
    sections,
    toc: sections,
    elements,
    products,
  };
}

export async function parseDocxDocument(filePath: string): Promise<StructuredDocument> {
  const result = await mammoth.extractRawText({ path: filePath });
  const rawText = result.value || "";

  const sections: DocumentSection[] = [];
  const elements: StructuredElement[] = [];
  const products: StructuredProduct[] = [];

  let currentSectionPath = "0";
  let currentSectionTitle = "Введение";
  let currentLevel = 1;
  let pageNumber = 1;

  const paragraphs = splitIntoParagraphs(rawText);

  paragraphs.forEach((paragraph) => {
    const lines = paragraph.split(/\n/);
    lines.forEach((line) => {
      // Для DOCX нет информации о размере шрифта и жирном шрифте, передаем undefined
      const detected = detectSectionFromLine(normalizeLine(line.trim()), undefined, undefined, undefined);
      if (!detected) {
        return;
      }

      const sectionPath = detected.sectionPath;
      const parentPath = sectionPath.includes(".") && sectionPath !== "warranty"
        ? sectionPath.split(".").slice(0, -1).join(".")
        : undefined;

      const section: DocumentSection = {
        sectionPath: sectionPath,
        title: detected.title,
        level: detected.level,
        parentPath,
        pageStart: pageNumber,
        pageEnd: pageNumber,
        isNumericSection: detected.isNumericSection,
      };

      const existingIndex = sections.findIndex((s) => s.sectionPath === section.sectionPath);
      if (existingIndex >= 0) {
        sections[existingIndex].pageEnd = pageNumber;
      } else {
        sections.push(section);
      }

      currentSectionPath = section.sectionPath;
      currentSectionTitle = section.title;
      currentLevel = section.level;
    });

    const content = normalizeText(paragraph);
    if (content.length < 40) {
      pageNumber += 1;
      return;
    }

    const elementType = guessElementType(content);
    
    // Try to extract table rows from text if it's detected as a table
    let tableRows: Array<Record<string, string | number | null>> | undefined = undefined;
    if (elementType === "table") {
      tableRows = extractTableRowsFromText(content);
    }

    const element: StructuredElement = {
      pageNumber,
      sectionPath: currentSectionPath,
      heading: currentSectionTitle,
      elementType,
      content,
      tableRows,
      language: "ru",
    };

    elements.push(element);
    
      // Extract products from table rows if available
      // Специальная обработка для таблиц "Номенклатура ..." - извлекаем ВСЕ товары
      if (tableRows && tableRows.length > 0) {
        // Проверяем, является ли это таблицей "Номенклатура ..."
        const contentLower = content.toLowerCase();
        const sectionTitleLower = currentSectionTitle?.toLowerCase() || "";
        const hasNomenclatureInTitle = sectionTitleLower.includes("номенклатура");
        const hasNomenclatureInContent = contentLower.includes("номенклатура");
        
        // Также проверяем структуру таблицы
        const hasArticleColumn = tableRows.some(row => {
          const keys = Object.keys(row);
          return keys.some(k => /артикул/i.test(k));
        });
        const hasNameColumn = tableRows.some(row => {
          const keys = Object.keys(row);
          return keys.some(k => /наименование/i.test(k));
        });
        const isLikelyNomenclature = hasArticleColumn && hasNameColumn && tableRows.length > 2;
        
        const isNomenclatureTable = 
          hasNomenclatureInTitle ||
          hasNomenclatureInContent ||
          isLikelyNomenclature;
        
        const tableProducts = extractProductsFromTableRows(
          tableRows, 
          currentSectionPath, 
          pageNumber,
          isNomenclatureTable
        );
        if (tableProducts.length > 0) {
          console.log(`[StructuredParser] Extracted ${tableProducts.length} products from ${isNomenclatureTable ? 'nomenclature ' : ''}table in DOCX on page ${pageNumber}, section ${currentSectionPath}`);
          products.push(...tableProducts);
        }
      }
    
    // Also extract products from text content (for non-table products)
    products.push(...extractProductsFromText(content, currentSectionPath, pageNumber));

    pageNumber += 1;
  });

  const toc = sections.length > 0 ? sections : [
    {
      sectionPath: "1",
      title: "Введение",
      level: 1,
      pageStart: 1,
      pageEnd: Math.max(pageNumber - 1, 1),
    },
  ];

  if (sections.length === 0) {
    sections.push(...toc);
  }

  return {
    sections,
    toc,
    elements,
    products,
  };
}




