import * as path from "path";
import { ProcessingType, DocumentMetadata, ChunkMetadata } from "./advancedDocumentProcessor";
import { stripFootnoteMarkers } from "../shared/text";
import {
  parsePdfDocument,
  parseXlsxDocument,
  parseDocxDocument,
  StructuredDocument,
  StructuredElement,
  StructuredProduct,
  DocumentSection,
  ElementType,
} from "./structuredParser";

/**
 * Детерминированный обработчик документов для русскоязычных документов SANEXT
 * Каталоги и пособия по монтажу
 */

export interface ProcessedDocument {
  filename: string;
  fileType: "pdf" | "docx" | "xlsx";
  processingType:
    | "catalog"
    | "instruction"
    | "general"
    | "certificate"
    | "passport"
    | "warranty_faq";
  numPages: number;
  title?: string;
  toc: Array<{
    sectionPath: string;
    title: string;
    pageStart?: number;
    pageEnd?: number;
  }>;
  sections: Array<{
    sectionPath: string;
    title: string;
    level: number;
    pageStart?: number;
    pageEnd?: number;
  }>;
  elements: Array<{
    sectionPath: string;
    elementType: ElementType;
    pageNumber: number;
    content: string;
    tableRows?: Array<{ cells: string[] }>;
    heading?: string;
  }>;
  products: Array<{
    sku: string;
    name?: string;
    attributes?: Record<string, string | number | null>;
    sectionPath?: string;
    pageNumber?: number;
  }>;
  chunks: Array<{
  content: string;
  tokenCount: number;
  chunkIndex: number;
    sectionPath: string;
    elementType: "text" | "table" | "mixed";
  tableRows?: Array<Record<string, string | number | null>>;
    language: string;
    metadata: {
      category: "nomenclature" | "table" | "description" | "warranty";
      section: string;
      pageRange: string;
      tags: string[];
      importance: "high" | "medium" | "low";
    };
  }>;
  documentMetadata: {
    categories: string[];
    sectionsCount: number;
    processingNotes: string[];
  };
  totalTokens: number;
}

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 300;
const DEFAULT_LANGUAGE = "ru";
const TABLE_PREVIEW_MAX_ROWS = 12;
const TABLE_PREVIEW_MAX_COLUMNS = 8;

type TableRow = Record<string, string | number | null>;

/**
 * Оценка токенов: грубая оценка tokenCount = ceil(charCount / 4)
 */
function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Нормализация текста: удаление служебных элементов
 */
function cleanText(text: string): string {
  if (!text) return "";
  
  // Удаляем номера страниц (отдельные числа в конце строк)
  let cleaned = text.replace(/^\d+$/gm, "");
  
  // Удаляем повторяющиеся колонтитулы
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  
  // Удаляем артефакты переносов
  cleaned = cleaned.replace(/-\s*\n\s*/g, "");
  
  // Нормализуем пробелы
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // Удаляем сноски вида температура¹, срок службы² и т.п.
  cleaned = stripFootnoteMarkers(cleaned);
  
  return cleaned;
}

function sanitizeTableCellValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const raw = stripFootnoteMarkers(String(value));
  const escaped = raw.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
  const decimalMatch = escaped.match(/^(\d+)\s+(\d{1,2})$/);
  if (decimalMatch) {
    const [, whole, fraction] = decimalMatch;
    return `${whole},${fraction}`;
  }
  return escaped;
}

function formatTableRowsAsMarkdown(
  rows: TableRow[],
  options?: { maxRows?: number; maxColumns?: number }
): string {
  if (!rows.length) {
    return "";
  }

  const maxRows = options?.maxRows ?? rows.length;
  const maxColumns = options?.maxColumns ?? TABLE_PREVIEW_MAX_COLUMNS;

  const headerColumns: string[] = [];
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      const normalizedKey = key?.trim();
      if (normalizedKey && !headerColumns.includes(normalizedKey)) {
        headerColumns.push(normalizedKey);
      }
    });
  });

  const columns = headerColumns.length
    ? headerColumns.slice(0, maxColumns)
    : ["Параметр", "Значение"];

  const header = `| ${columns.join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.slice(0, maxRows).map((row) => {
    const cells = columns.map((column) => sanitizeTableCellValue(row[column]));
    return `| ${cells.join(" | ")} |`;
  });

  let markdown = [header, separator, ...body].join("\n");
  if (rows.length > maxRows) {
    markdown += `\n… ещё ${rows.length - maxRows} строк`;
  }

  return markdown;
}

function buildProductTag(title?: string | null) {
  if (!title) return null;
  const normalized = title.replace(/[«»"']/g, "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return `product:${normalized.toLowerCase()}`;
}

/**
 * Проверка, является ли секция оглавлением (не чанкать)
 */
function isTableOfContentsSection(section: DocumentSection): boolean {
  const titleLower = section.title.toLowerCase();
  return (
    titleLower.includes("содержание") ||
    titleLower.includes("оглавление") ||
    titleLower === "содержание" ||
    titleLower === "оглавление"
  );
}

/**
 * Проверка, является ли секция пустой
 */
function isEmptySection(
  section: DocumentSection,
  elements: StructuredElement[]
): boolean {
  const sectionElements = elements.filter(
    (el) => el.sectionPath === section.sectionPath
  );
  if (sectionElements.length === 0) return true;
  
  const totalContent = sectionElements
    .map((el) => el.content?.trim() || "")
    .join(" ")
    .trim();
  
  return totalContent.length < 50; // Минимальный порог
}

/**
 * Извлечение продуктов из таблиц с поддержкой русских колонок
 * @param isNomenclatureTable - если true, извлекает ВСЕ строки как продукты (для таблиц "Номенклатура ...")
 */
function extractProductsFromTableRows(
  tableRows: Array<Record<string, string | number | null>>,
  sectionPath: string,
  pageNumber: number,
  isNomenclatureTable: boolean = false
): Array<{
  sku: string;
  name?: string;
  attributes?: Record<string, string | number | null>;
  sectionPath: string;
  pageNumber: number;
}> {
  if (!tableRows || tableRows.length === 0) return [];

  const products: Array<{
    sku: string;
    name?: string;
    attributes?: Record<string, string | number | null>;
    sectionPath: string;
    pageNumber: number;
  }> = [];
  const seen = new Set<string>();

  // Словарь русских колонок для поиска
  const SKU_HEADERS = [/^артикул$/i];
  const NAME_HEADERS = [/^наименование( продукции)?$/i, /^типоразмер$/i, /^название$/i];
  const DIAMETER_HEADERS = [/диаметр.*мм$/i, /диаметр\s+наружный/i];
  const LENGTH_HEADERS = [/длина.*(бухты|м)\b/i, /длина\s+бухты/i];
  const THICKNESS_HEADERS = [/толщина.*мм$/i, /толщина\s+стенки/i];

  // Старые ключи для обратной совместимости
  const articleKeys = [
    "артикул",
    "sku",
    "код",
    "номер",
    "article",
  ];

  const nameKeys = [
    "наименование",
    "наименование продукции",
    "типоразмер",
    "название",
    "name",
  ];

  // Находим колонки по русским заголовкам
  const firstRow = tableRows[0];
  if (!firstRow) return [];

  const keys = Object.keys(firstRow);
  let idxSku = -1;
  let idxName = -1;
  let articleColumn: string | null = null;
  let nameColumn: string | null = null;

  // Поиск индексов колонок по regex паттернам
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const keyLower = key.toLowerCase().trim();
    
    // Проверка на артикул
    if (idxSku === -1 && SKU_HEADERS.some(pattern => pattern.test(keyLower))) {
      idxSku = i;
      articleColumn = key;
    }
    
    // Проверка на название
    if (idxName === -1 && NAME_HEADERS.some(pattern => pattern.test(keyLower))) {
      idxName = i;
      nameColumn = key;
    }
  }

  // Fallback: поиск по старым ключам для обратной совместимости
  if (!articleColumn) {
    for (const key of keys) {
      const keyLower = key.toLowerCase();
      if (articleKeys.some((ak) => keyLower.includes(ak))) {
        articleColumn = key;
        break;
      }
    }
  }

  if (!nameColumn) {
    for (const key of keys) {
      const keyLower = key.toLowerCase();
      if (nameKeys.some((nk) => keyLower.includes(nk))) {
        nameColumn = key;
        break;
      }
    }
  }

  // Если нет колонки артикула - таблица не номенклатура
  if (!articleColumn && idxSku === -1) {
    return [];
  }

  // Обработка строк таблицы
  for (const row of tableRows) {
    // Пропускаем заголовки
    // Для таблиц "Номенклатура ..." более строгая проверка заголовка
    const rowValues = Object.values(row).map((v) =>
      String(v || "").toLowerCase()
    );
    const isHeader =
      rowValues.some((v) =>
        articleKeys.some((ak) => v.includes(ak)) ||
        nameKeys.some((nk) => v.includes(nk)) ||
        (isNomenclatureTable && (
          v.includes("диаметр") || 
          v.includes("толщина") || 
          v.includes("длина") ||
          v.includes("характеристика") ||
          v.includes("единица") ||
          v.includes("измерения")
        ))
      ) && tableRows.length > 1;
    
    // Для таблиц номенклатуры пропускаем только явные заголовки без числовых данных
    if (isHeader) {
      if (isNomenclatureTable) {
        // Проверяем, есть ли в строке хотя бы одно числовое значение
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
    let name: string | undefined = undefined;

    // Извлечение артикула
    if (articleColumn && row[articleColumn]) {
      const skuValue = String(row[articleColumn]).trim();
      if (skuValue.length >= 3) {
        sku = skuValue;
      }
    }

    // Поиск артикула в других колонках
    if (!sku) {
      for (const [key, value] of Object.entries(row)) {
        const valueStr = String(value || "").trim();
        // Паттерн: буквенно-цифровые коды 3+ символов
        if (
          valueStr.length >= 3 &&
          /^[0-9A-ZА-Я]{3,}(?:[-–][0-9A-ZА-Я]{2,})*$/.test(valueStr)
        ) {
          // Проверка, что это не единица измерения
          if (
            !/^(кПа|бар|МПа|кг|м|см|мм|г|кДж|К|°[СC]|Вт|кВт|м\/с|м\/с²|м³|см³|г\/см³|лет|год|час|сут|%|Dнар|шт)$/i.test(
              valueStr
            )
          ) {
            sku = valueStr;
            articleColumn = key;
            break;
          }
        }
      }
    }

    // Извлечение названия
    if (nameColumn && row[nameColumn]) {
      const nameValue = String(row[nameColumn]).trim();
      if (nameValue.length > 0) {
        name = nameValue;
      }
    }

    // Если нет явной колонки названия, пробуем вторую колонку
    if (!name && keys.length > 1) {
      const secondKey = keys[1];
      if (secondKey && row[secondKey]) {
        const secondValue = String(row[secondKey]).trim();
        if (secondValue.length > 2 && /[А-ЯЁа-яёA-Za-z]{2,}/.test(secondValue)) {
          name = secondValue;
        }
      }
    }

    // Для таблиц "Номенклатура ..." извлекаем ВСЕ строки с артикулами
    // Для обычных таблиц - только строки с валидным SKU
    if (isNomenclatureTable) {
      // В таблицах номенклатуры артикул обязателен, но если его нет - пробуем найти в первой колонке
      if (!sku && keys.length > 0) {
        const firstColKey = keys[0];
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

          // Атрибуты из остальных колонок
          const attributes: Record<string, string | number | null> = {};
          for (const [key, value] of Object.entries(row)) {
            if (key !== articleColumn && key !== nameColumn) {
              attributes[key] = value;
            }
          }

          products.push({
            sku: normalizedSku,
            name,
            attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
            sectionPath,
            pageNumber,
          });
        }
      }
    } else {
      // Обычная логика для других таблиц
      // Создание продукта
      if (sku && sku.length >= 3) {
        const normalizedSku = sku.replace(/\s+/g, "").replace(/[–—]/g, "-");
        if (!seen.has(normalizedSku)) {
          seen.add(normalizedSku);

          // Атрибуты из остальных колонок
          const attributes: Record<string, string | number | null> = {};
          for (const [key, value] of Object.entries(row)) {
            if (key !== articleColumn && key !== nameColumn) {
              attributes[key] = value;
            }
          }

          products.push({
            sku: normalizedSku,
            name,
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

/**
 * Извлечение продуктов из текста с поддержкой 4-цифровых артикулов
 */
function extractProductsFromText(
  text: string,
  sectionPath: string,
  pageNumber: number
): Array<{
  sku: string;
  name?: string;
  attributes?: Record<string, string | number | null>;
  sectionPath: string;
  pageNumber: number;
}> {
  const products: Array<{
    sku: string;
    name?: string;
    attributes?: Record<string, string | number | null>;
    sectionPath: string;
    pageNumber: number;
  }> = [];
  const seen = new Set<string>();

  // Паттерны для SKU:
  // 1. 4-цифровые артикулы (1181, 1191, 4010, 4935 и т.д.)
  // 2. Буквенно-цифровые коды 3+ символов с дефисами
  const skuPatterns = [
    /\b\d{4}\b/g, // 4-цифровые артикулы
    /\b[0-9A-ZА-Я]{3,}(?:[-–][0-9A-ZА-Я]{2,})+\b/g, // Буквенно-цифровые с дефисами
  ];
  
  const matches: string[] = [];
  for (const pattern of skuPatterns) {
    const found = text.match(pattern) || [];
    matches.push(...found);
  }

  // Извлечение названия продукта из текста
  let productName: string | undefined = undefined;

  // Паттерн 1: "1.3. Труба «Стабил»"
  const sectionWithQuotesMatch = text.match(
    /^\d+(?:\.\d+)*\.\s+[А-ЯЁA-Z][а-яёa-z\s\-–—]+?[«"']([А-ЯЁA-Z][а-яёa-z\s\-–—]+?)[»"']/
  );
  if (sectionWithQuotesMatch && sectionWithQuotesMatch[1]) {
    productName = sectionWithQuotesMatch[1].trim();
  } else {
    // Паттерн 2: "1.3. Труба Стабил"
    const sectionWithNameMatch = text.match(
      /^\d+(?:\.\d+)*\.\s+(?:Труба|Фитинг|Крепёж|Изделие|Станция|Радиатор|Коллектор)\s+([А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)*)/
    );
  if (sectionWithNameMatch && sectionWithNameMatch[1]) {
      productName = sectionWithNameMatch[1].trim();
    } else {
      // Паттерн 3: «Стабил» или "Стабил"
      const quotesMatch = text.match(/[«"']([А-ЯЁA-Z][а-яёa-z\s]+?)[»"']/);
      if (quotesMatch && quotesMatch[1]) {
        productName = quotesMatch[1].trim();
      }
    }
  }

  // Обработка найденных SKU
  for (const sku of matches) {
    if (seen.has(sku)) continue;

    const hasLetter = /[A-ZА-Я]/i.test(sku);
    const digitCount = (sku.match(/\d/g) || []).length;

    // Фильтрация: пропускаем короткие числовые коды
    if (!hasLetter && digitCount <= 4) {
      continue;
    }

    seen.add(sku);

    products.push({
      sku,
      name: productName,
      sectionPath,
      pageNumber,
    });
  }

  return products;
}

/**
 * Объединение продуктов по SKU
 */
function mergeProducts(
  products: Array<{
    sku: string;
    name?: string;
    attributes?: Record<string, string | number | null>;
    sectionPath?: string;
    pageNumber?: number;
  }>
): Array<{
  sku: string;
  name?: string;
  attributes?: Record<string, string | number | null>;
  sectionPath?: string;
  pageNumber?: number;
}> {
  const deduped = new Map<
    string,
    {
      sku: string;
      name?: string;
      attributes?: Record<string, string | number | null>;
      sectionPath?: string;
      pageNumber?: number;
    }
  >();

  products.forEach((product) => {
    const sku = product.sku.trim();
    if (!sku) return;

    if (!deduped.has(sku)) {
      deduped.set(sku, product);
      return;
    }

    const existing = deduped.get(sku)!;
    // Объединение атрибутов
    deduped.set(sku, {
      ...existing,
      ...product,
      name: product.name || existing.name,
      attributes: {
        ...(existing.attributes ?? {}),
        ...(product.attributes ?? {}),
      },
      sectionPath: product.sectionPath || existing.sectionPath,
      pageNumber: product.pageNumber || existing.pageNumber,
    });
  });

  return Array.from(deduped.values());
}

/**
 * Построение метаданных документа
 */
function buildDocumentMetadata(
  structured: StructuredDocument,
  processingType: ProcessingType
): {
  categories: string[];
  sectionsCount: number;
  processingNotes: string[];
} {
  const sections = structured.sections ?? [];
  const categories: string[] = [];
  const processingNotes: string[] = [];

  // Категории = топ-уровни "1", "2", "3"...
  const topLevelSections = sections
    .filter((s) => s.level === 1)
    .sort((a, b) => {
      const aNum = parseInt(a.sectionPath.split(".")[0] || "0", 10);
      const bNum = parseInt(b.sectionPath.split(".")[0] || "0", 10);
      return aNum - bNum;
    });

  topLevelSections.forEach((section) => {
    if (section.title && section.title.trim().length > 0) {
      categories.push(section.title);
    }
  });

  // Валидации
  const sectionPaths = new Set(sections.map((s) => s.sectionPath));
  if (sectionPaths.size !== sections.length) {
    processingNotes.push("Обнаружены дублирующиеся sectionPath");
  }

  sections.forEach((section) => {
    if (
      section.pageStart !== undefined &&
      section.pageEnd !== undefined &&
      section.pageStart > section.pageEnd
    ) {
      processingNotes.push(
        `Секция ${section.sectionPath}: pageStart > pageEnd`
      );
    }
  });

  return {
    categories,
    sectionsCount: sections.length,
    processingNotes,
  };
}

/**
 * Создание чанков для catalog/instruction: 1 секция = 1 чанк
 */
function createStructuredSectionChunks(
  structured: StructuredDocument,
  processingType: "catalog" | "instruction"
): Array<{
  content: string;
  tokenCount: number;
  chunkIndex: number;
  sectionPath: string;
  elementType: "text" | "table" | "mixed";
  tableRows?: Array<Record<string, string | number | null>>;
  language: string;
  metadata: {
    category: "nomenclature" | "table" | "description" | "warranty";
    section: string;
    pageRange: string;
    tags: string[];
    importance: "high" | "medium" | "low";
  };
}> {
  const sections = structured.sections ?? [];
  const elements = structured.elements ?? [];
  const chunks: Array<{
    content: string;
    tokenCount: number;
    chunkIndex: number;
    sectionPath: string;
    elementType: "text" | "table" | "mixed";
    tableRows?: Array<{ cells: string[] }>;
    language: string;
    metadata: {
      category: "nomenclature" | "table" | "description" | "warranty";
      section: string;
      pageRange: string;
      tags: string[];
      importance: "high" | "medium" | "low";
    };
  }> = [];

  const ARTICLE_PATTERNS = [/артикул/i, /\bsku\b/i, /код/i];
  const NAME_PATTERNS = [/наимен/i, /назван/i, /product/i, /товар/i, /описание/i];
  const CHARACTERISTIC_PATTERNS = [/характерист/i, /параметр/i, /показател/i];
  const UNIT_PATTERNS = [/единиц/i, /ед\./i, /unit/i, /изм/i];
  const VALUE_PATTERNS = [/значен/i, /value/i, /показател/i, /данн/i];

  const normalizeCellValue = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  };

  const hasColumnMatching = (rows: TableRow[], pattern: RegExp) =>
    rows.some((row) =>
      Object.keys(row).some((key) => pattern.test(key.toLowerCase()))
    );

  const classifyTableRows = (rows: TableRow[]) => {
    if (!rows.length) return "generic" as const;
    const hasArticle = hasColumnMatching(rows, /(артикул|sku|код)/i);
    const hasName = hasColumnMatching(rows, /(наимен|назван|product|товар|описание)/i);
    const hasCharacteristic = hasColumnMatching(rows, /(характерист|параметр|показател)/i);
    const hasUnit = hasColumnMatching(rows, /(единиц|ед\.|unit|изм)/i);
    const hasValue = hasColumnMatching(rows, /(значен|value|показател|данн)/i);

    if (hasArticle && (hasName || hasValue)) {
      return "nomenclature" as const;
    }
    if (hasCharacteristic && (hasUnit || hasValue)) {
      return "characteristics" as const;
    }
    return "generic" as const;
  };

  const getFirstValueByPatterns = (row: TableRow, patterns: RegExp[]) => {
    for (const pattern of patterns) {
      for (const [key, value] of Object.entries(row)) {
        if (pattern.test(key.toLowerCase())) {
          const normalized = normalizeCellValue(value);
          if (normalized.length > 0) {
            return normalized;
          }
        }
      }
    }
    return null;
  };

  let chunkIndex = 0;

  // Фильтрация валидных секций: числовые секции или warranty
  const isNumericPath = (p: string) => /^\d+(?:\.\d+){0,3}$/.test(p);
  const validSections = sections.filter(
    (s) =>
      (s.isNumericSection !== false && isNumericPath(s.sectionPath)) ||
      s.sectionPath === "warranty"
  );

  // Логирование для отладки
  console.log(
    `[DocumentProcessor] Всего секций: ${sections.length}, Валидных: ${validSections.length}`
  );

  // Группировка элементов по секциям
  const elementsBySection = new Map<string, StructuredElement[]>();
  elements.forEach((element) => {
    const sectionPath = element.sectionPath || "root";
    if (!elementsBySection.has(sectionPath)) {
      elementsBySection.set(sectionPath, []);
    }
    elementsBySection.get(sectionPath)!.push(element);
  });

  // Обработка каждой валидной секции
  for (const section of validSections) {
    // Пропускаем оглавление
    if (isTableOfContentsSection(section)) continue;

    const sectionElements = elementsBySection.get(section.sectionPath) || [];
    const sectionProductTag = buildProductTag(section.title);
    
    // Гарантируем чанк даже для пустых секций (только с заголовком)
    if (sectionElements.length === 0) {
      // Создаем минимальный чанк с заголовком
      const sectionHeader = `${section.sectionPath}. ${section.title}`;
      const fallbackContent = `${sectionHeader}\n\nРаздел без детализированных данных в документе.`;
      
      chunks.push({
        content: fallbackContent,
        tokenCount: estimateTokenCount(fallbackContent),
        chunkIndex: chunkIndex++,
        sectionPath: section.sectionPath,
        elementType: "text",
        language: DEFAULT_LANGUAGE,
        metadata: {
          category: "description",
          section: section.title,
          pageRange: section.pageStart
            ? section.pageEnd && section.pageEnd !== section.pageStart
              ? `${section.pageStart}-${section.pageEnd}`
              : `${section.pageStart}`
            : "",
          tags: [section.sectionPath, "SANEXT"],
          importance: "medium",
        },
      });
      continue;
    }

    // Определение категории чанка
    let category: "nomenclature" | "table" | "description" | "warranty" =
      "description";
    let hasTable = false;
    let hasNomenclature = false;
    let hasCharacteristics = false;

    // Проверка на warranty
    if (
      section.sectionPath === "warranty" ||
      section.title
        .toLowerCase()
        .includes("гарантийные обязательства и сертификаты sanext")
    ) {
      category = "warranty";
    }

    // Построение контента чанка
    const contentParts: string[] = [];
    const combinedTableRows: TableRow[] = [];
    const skuTables: Array<{ rows: TableRow[]; source: StructuredElement }> = [];
    const characteristicTables: Array<{ rows: TableRow[]; source: StructuredElement }> = [];
    let pageStart: number | undefined = undefined;
    let pageEnd: number | undefined = undefined;

    // Заголовок секции
    // ✅ Добавляем информацию из header'а страницы, если доступна
    const sectionHeader = `${section.sectionPath}. ${section.title}`;
    contentParts.push(sectionHeader);
    
    // Добавляем информацию о главном разделе из header'а (если доступна)
    // Это помогает контекстуализировать чанк
    if (section.pageStart) {
      // Можно добавить информацию о главном разделе из header'а первой страницы
      // Но для этого нужно передавать pageHeaders в функцию createStructuredSectionChunks
      // Пока оставляем как есть, можно улучшить позже
    }

    // Обработка элементов секции
    for (const element of sectionElements) {
      if (pageStart === undefined) {
        pageStart = element.pageNumber;
      }
      pageEnd = element.pageNumber;

      if (element.elementType === "table" && element.tableRows) {
        hasTable = true;
        combinedTableRows.push(...element.tableRows);
        const tableType = classifyTableRows(element.tableRows);

        if (tableType === "nomenclature") {
          hasNomenclature = true;
          skuTables.push({ rows: element.tableRows, source: element });
          const preview = formatTableRowsAsMarkdown(element.tableRows, {
            maxRows: TABLE_PREVIEW_MAX_ROWS,
          });
          contentParts.push(
            `[Таблица номенклатуры — ${element.tableRows.length} позиций]\n${preview}`
          );
          continue;
        }

        if (tableType === "characteristics") {
          hasCharacteristics = true;
          characteristicTables.push({ rows: element.tableRows, source: element });
          const preview = formatTableRowsAsMarkdown(element.tableRows, {
            maxRows: TABLE_PREVIEW_MAX_ROWS,
          });
          contentParts.push(
            `[Технические характеристики — ${element.tableRows.length} строк]\n${preview}`
          );
          continue;
        }

        const defaultPreview = formatTableRowsAsMarkdown(element.tableRows, {
          maxRows: TABLE_PREVIEW_MAX_ROWS,
        });
        const tableLabel = element.heading
          ? `Таблица: ${element.heading}`
          : "Таблица";
        contentParts.push(`[${tableLabel}]\n${defaultPreview}`);
      } else if (element.content) {
        // Текст: добавляем очищенный текст
        const cleanedContent = cleanText(element.content);
        if (cleanedContent.length > 0) {
          contentParts.push(cleanedContent);
        }
      }
    }

    if (category !== "warranty") {
      if (hasNomenclature) {
        category = "nomenclature";
      } else if (hasCharacteristics) {
        category = "table";
      } else if (hasTable) {
        category = "table";
      }
    }

    const content = contentParts.join("\n\n").trim();
    
    // Гарантируем минимальный контент даже для коротких секций
    const finalContent = content.length < sectionHeader.length + 10
      ? `${sectionHeader}\n\nРаздел содержит только заголовок.`
      : content;

    // Определение типа элемента
    let elementType: "text" | "table" | "mixed" = "text";
    if (combinedTableRows.length > 0 && contentParts.length > 1) {
      elementType = "mixed";
    } else if (combinedTableRows.length > 0) {
      elementType = "table";
    }

    // Диапазон страниц
    const pageRange =
      pageStart !== undefined && pageEnd !== undefined
        ? pageStart === pageEnd
          ? `${pageStart}`
          : `${pageStart}-${pageEnd}`
        : section.pageStart
        ? section.pageEnd && section.pageEnd !== section.pageStart
          ? `${section.pageStart}-${section.pageEnd}`
          : `${section.pageStart}`
        : "";

    // Теги
    const tags: string[] = [section.sectionPath];
    if (category === "nomenclature") {
      tags.push("products");
    }
    if (sectionProductTag) {
      tags.push(sectionProductTag);
    }
    tags.push("SANEXT");

    // Важность
    const importance: "high" | "medium" | "low" =
      category === "nomenclature" || category === "warranty" ? "high" : "medium";

    // Логирование для отладки
    console.log(
      `[DocumentProcessor] Секция ${section.sectionPath}: ${sectionElements.length} элементов, ` +
      `${combinedTableRows.length} строк таблиц, категория: ${category}`
    );

    chunks.push({
      content: finalContent,
      tokenCount: estimateTokenCount(finalContent),
      chunkIndex: chunkIndex++,
      sectionPath: section.sectionPath,
      elementType,
      tableRows: combinedTableRows.length > 0 ? combinedTableRows : undefined,
      language: DEFAULT_LANGUAGE,
      metadata: {
        category,
        section: section.title,
        pageRange,
        tags,
        importance,
      },
    });

    // Дополнительные чанки по артикулам (SKU)
    skuTables.forEach(({ rows }) => {
      rows.forEach((row) => {
        const article = getFirstValueByPatterns(row, ARTICLE_PATTERNS);
        const name = getFirstValueByPatterns(row, NAME_PATTERNS);
        const rowContentParts = [sectionHeader];
        if (section.title) {
          rowContentParts.push(`Товар: ${section.title}`);
        }
        if (name) {
          rowContentParts.push(`Наименование: ${name}`);
        }
        if (article) {
          rowContentParts.push(`Артикул: ${article}`);
        }
        rowContentParts.push(
          formatTableRowsAsMarkdown([row], { maxColumns: TABLE_PREVIEW_MAX_COLUMNS })
        );
        const rowContent = rowContentParts.join("\n");
        const rowTags = [section.sectionPath, "SANEXT", "sku"];
        if (sectionProductTag) {
          rowTags.push(sectionProductTag);
        }
        if (article) {
          rowTags.push(article);
        }

        chunks.push({
          content: rowContent,
          tokenCount: estimateTokenCount(rowContent),
          chunkIndex: chunkIndex++,
          sectionPath: section.sectionPath,
          elementType: "table",
          tableRows: [row],
          language: DEFAULT_LANGUAGE,
          metadata: {
            category: "nomenclature",
            section: section.title,
            pageRange,
            tags: rowTags,
            importance: "high",
          },
        });
      });
    });

    // Дополнительные чанки по характеристикам
    characteristicTables.forEach(({ rows }) => {
      rows.forEach((row) => {
        const characteristicName =
          getFirstValueByPatterns(row, CHARACTERISTIC_PATTERNS) ||
          Object.keys(row)[0] ||
          "Характеристика";
        const unitValue = getFirstValueByPatterns(row, UNIT_PATTERNS);
        const valueValue = getFirstValueByPatterns(row, VALUE_PATTERNS);
        const rowContentParts = [
          sectionHeader,
          `Характеристика: ${characteristicName}`,
        ];
        if (section.title) {
          rowContentParts.push(`Товар: ${section.title}`);
        }
        if (unitValue) {
          rowContentParts.push(`Единица измерения: ${unitValue}`);
        }
        if (valueValue) {
          rowContentParts.push(`Значение: ${valueValue}`);
        }
        rowContentParts.push(
          formatTableRowsAsMarkdown([row], { maxColumns: TABLE_PREVIEW_MAX_COLUMNS })
        );
        const rowContent = rowContentParts.join("\n");
        const rowTags = [section.sectionPath, "SANEXT", "characteristics"];
        if (sectionProductTag) {
          rowTags.push(sectionProductTag);
        }
        if (characteristicName) {
          rowTags.push(characteristicName);
        }

        chunks.push({
          content: rowContent,
          tokenCount: estimateTokenCount(rowContent),
          chunkIndex: chunkIndex++,
          sectionPath: section.sectionPath,
          elementType: "table",
          tableRows: [row],
          language: DEFAULT_LANGUAGE,
          metadata: {
            category: "table",
            section: section.title,
            pageRange,
            tags: rowTags,
            importance: "medium",
          },
        });
      });
    });
  }

  console.log(
    `[DocumentProcessor] Создано чанков: ${chunks.length} из ${validSections.length} валидных секций`
  );

  // Обработка специальной секции warranty (если не найдена в секциях)
  // Проверяем, не создали ли мы уже чанк для warranty секции
  const hasWarrantyChunk = chunks.some((chunk) => chunk.sectionPath === "warranty");
  
  if (!hasWarrantyChunk) {
    const warrantyElements = elements.filter(
      (el) =>
        el.content
          ?.toLowerCase()
          .includes("гарантийные обязательства и сертификаты sanext") ||
        el.heading
          ?.toLowerCase()
          .includes("гарантийные обязательства и сертификаты sanext")
    );

    if (warrantyElements.length > 0) {
      const warrantyContent = warrantyElements
        .map((el) => cleanText(el.content || ""))
        .join("\n\n")
        .trim();

      if (warrantyContent.length > 0) {
        const pageStart = warrantyElements[0]?.pageNumber || 1;
        const pageEnd =
          warrantyElements[warrantyElements.length - 1]?.pageNumber || pageStart;

        chunks.push({
          content: warrantyContent,
          tokenCount: estimateTokenCount(warrantyContent),
          chunkIndex: chunkIndex++,
          sectionPath: "warranty",
          elementType: "text",
          language: DEFAULT_LANGUAGE,
          metadata: {
            category: "warranty",
            section: "Гарантийные обязательства и сертификаты SANEXT",
            pageRange:
              pageStart === pageEnd ? `${pageStart}` : `${pageStart}-${pageEnd}`,
            tags: ["warranty", "SANEXT"],
            importance: "high",
          },
        });
      }
    }
  }

  return chunks;
}

/**
 * Создание чанков для general: скользящее окно
 */
function createGeneralChunks(
  elements: StructuredElement[]
): Array<{
  content: string;
  tokenCount: number;
  chunkIndex: number;
  sectionPath: string;
  elementType: "text" | "table" | "mixed";
  tableRows?: Array<Record<string, string | number | null>>;
  language: string;
  metadata: {
    category: "nomenclature" | "table" | "description" | "warranty";
    section: string;
    pageRange: string;
    tags: string[];
    importance: "high" | "medium" | "low";
  };
}> {
  const chunks: Array<{
    content: string;
    tokenCount: number;
    chunkIndex: number;
    sectionPath: string;
    elementType: "text" | "table" | "mixed";
    tableRows?: Array<Record<string, string | number | null>>;
    language: string;
    metadata: {
      category: "nomenclature" | "table" | "description" | "warranty";
      section: string;
      pageRange: string;
      tags: string[];
      importance: "high" | "medium" | "low";
    };
  }> = [];

  let buffer: StructuredElement[] = [];
  let bufferTokens = 0;
  let chunkIndex = 0;

  const flushBuffer = () => {
    if (buffer.length === 0) return;

    const contentParts: string[] = [];
    const tableRows: Array<Record<string, string | number | null>> = [];
    let pageStart: number | undefined = undefined;
    let pageEnd: number | undefined = undefined;
    let hasTable = false;

    for (const element of buffer) {
      if (pageStart === undefined) {
        pageStart = element.pageNumber;
      }
      pageEnd = element.pageNumber;

      if (element.elementType === "table" && element.tableRows) {
        hasTable = true;
        // Сохраняем оригинальный формат Record
        tableRows.push(...element.tableRows);
        const tableJson = JSON.stringify(
          element.tableRows.map((row) => {
            const normalizedRow: Record<string, string> = {};
            Object.entries(row).forEach(([key, value]) => {
              normalizedRow[key] = String(value || "");
            });
            return normalizedRow;
          })
        );
        contentParts.push(`Таблица:\n${tableJson}`);
      } else if (element.content) {
        const cleanedContent = cleanText(element.content);
        if (cleanedContent.length > 0) {
          contentParts.push(cleanedContent);
        }
      }
    }

    const content = contentParts.join("\n\n").trim();
    if (content.length === 0) {
      buffer = [];
      bufferTokens = 0;
      return;
    }

    const firstElement = buffer[0];
    const sectionPath = firstElement.sectionPath || "root";
    const section = firstElement.heading || "Раздел";

    const elementType: "text" | "table" | "mixed" = hasTable
      ? tableRows.length > 0 && contentParts.length > 1
        ? "mixed"
        : "table"
      : "text";

    const pageRange =
      pageStart !== undefined && pageEnd !== undefined
        ? pageStart === pageEnd
          ? `${pageStart}`
          : `${pageStart}-${pageEnd}`
        : "";

    chunks.push({
      content,
      tokenCount: estimateTokenCount(content),
      chunkIndex: chunkIndex++,
      sectionPath,
      elementType,
      tableRows: tableRows.length > 0 ? tableRows : undefined,
      language: DEFAULT_LANGUAGE,
      metadata: {
        category: hasTable ? "table" : "description",
        section,
        pageRange,
        tags: [sectionPath, "SANEXT"],
        importance: "medium",
      },
    });

    // Overlap: сохраняем последние элементы для перекрытия
    if (CHUNK_OVERLAP > 0) {
      const overlapElements: StructuredElement[] = [];
      let overlapTokens = 0;

      for (let i = buffer.length - 1; i >= 0; i--) {
        const element = buffer[i];
        overlapElements.unshift(element);
        overlapTokens += estimateTokenCount(element.content || "");
        if (overlapTokens >= CHUNK_OVERLAP) {
          break;
        }
      }
      
      buffer = overlapElements;
      bufferTokens = overlapTokens;
    } else {
      buffer = [];
      bufferTokens = 0;
    }
  };

  // Обработка элементов
  for (const element of elements) {
    const content = element.content?.trim() || "";
    if (content.length < 32) continue;

    const elementTokens = estimateTokenCount(content);

    // Если элемент слишком большой, создаем отдельный чанк
    if (elementTokens >= CHUNK_SIZE) {
      flushBuffer();
      buffer = [element];
      bufferTokens = elementTokens;
      flushBuffer();
      continue;
    }

    // Проверка, помещается ли элемент в текущий буфер
    if (bufferTokens + elementTokens > CHUNK_SIZE && buffer.length > 0) {
      flushBuffer();
    }

    buffer.push(element);
    bufferTokens += elementTokens;
  }

  flushBuffer();

  return chunks;
}

/**
 * Основная функция обработки документа
 */
export async function processDocument(
  filePath: string,
  processingType: ProcessingType = "general"
): Promise<ProcessedDocument> {
  try {
  const filename = path.basename(filePath);
    const ext = path.extname(filename).toLowerCase().substring(1) as
      | "pdf"
      | "docx"
      | "xlsx";

    if (ext !== "pdf" && ext !== "docx" && ext !== "xlsx") {
      throw new Error(`Unsupported file format: ${ext}`);
    }

    console.log(`[DocumentProcessor] Начало обработки: ${filename}, тип: ${processingType}, формат: ${ext}`);

    // Парсинг документа
    let structured: StructuredDocument;
    try {
  switch (ext) {
        case "pdf":
      structured = await parsePdfDocument(filePath);
      break;
        case "xlsx":
      structured = await parseXlsxDocument(filePath);
      break;
        case "docx":
      structured = await parseDocxDocument(filePath);
      break;
    default:
      throw new Error(`Unsupported file format: ${ext}`);
      }
      console.log(
        `[DocumentProcessor] Парсинг завершен: ${structured.sections?.length || 0} секций, ` +
        `${structured.elements?.length || 0} элементов, ${structured.products?.length || 0} продуктов`
      );
    } catch (parseError) {
      console.error(`[DocumentProcessor] Ошибка парсинга документа:`, parseError);
      throw new Error(`Failed to parse document: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }

  // Извлечение продуктов
  const allProducts: Array<{
    sku: string;
    name?: string;
    attributes?: Record<string, string | number | null>;
    sectionPath?: string;
    pageNumber?: number;
  }> = [];

  // Из продуктов, уже извлеченных парсером
  if (structured.products) {
    allProducts.push(...structured.products);
  }

  // Дополнительное извлечение из элементов
  for (const element of structured.elements || []) {
    if (element.tableRows && element.tableRows.length > 0) {
      // Проверяем, является ли это таблицей "Номенклатура ..."
      const elementContent = element.content?.toLowerCase() || "";
      const elementHeading = element.heading?.toLowerCase() || "";
      const isNomenclatureTable = 
        elementHeading.includes("номенклатура") ||
        elementContent.includes("номенклатура") ||
        // Проверяем структуру таблицы - наличие колонок "Артикул" и "Наименование"
        (element.tableRows.some(row => {
          const keys = Object.keys(row);
          return keys.some(k => /артикул/i.test(k)) && keys.some(k => /наименование/i.test(k));
        }) && element.tableRows.length > 2);
      
      const products = extractProductsFromTableRows(
        element.tableRows,
        element.sectionPath || "root",
        element.pageNumber,
        isNomenclatureTable
      );
      allProducts.push(...products);
    }

    if (element.content) {
      const products = extractProductsFromText(
        element.content,
        element.sectionPath || "root",
        element.pageNumber
      );
      allProducts.push(...products);
    }
  }

  // Объединение продуктов
  const mergedProducts = mergeProducts(allProducts);

  // Создание чанков
  let chunks: Array<{
    content: string;
    tokenCount: number;
    chunkIndex: number;
    sectionPath: string;
    elementType: "text" | "table" | "mixed";
    tableRows?: Array<{ cells: string[] }>;
    language: string;
    metadata: {
      category: "nomenclature" | "table" | "description" | "warranty";
      section: string;
      pageRange: string;
      tags: string[];
      importance: "high" | "medium" | "low";
    };
  }>;

  if (processingType === "catalog" || processingType === "instruction") {
    chunks = createStructuredSectionChunks(structured, processingType);
  } else {
    chunks = createGeneralChunks(structured.elements || []);
  }

  // Fallback: если чанков нет, создаем один общий чанк
  if (chunks.length === 0 && structured.elements && structured.elements.length > 0) {
    const fallbackContent = structured.elements
      .map((el) => cleanText(el.content || ""))
      .join("\n\n")
      .trim();

    if (fallbackContent.length > 0) {
      chunks.push({
        content: fallbackContent,
        tokenCount: estimateTokenCount(fallbackContent),
        chunkIndex: 0,
        sectionPath: "root",
        elementType: "text",
        language: DEFAULT_LANGUAGE,
        metadata: {
          category: "description",
          section: "Общий раздел",
          pageRange: "",
          tags: ["SANEXT"],
          importance: "medium",
        },
      });
    }
  }

  // Построение метаданных
  const documentMetadata = buildDocumentMetadata(structured, processingType);

  // Подготовка TOC
  const toc = (structured.toc || []).map((section) => ({
    sectionPath: section.sectionPath,
    title: section.title,
    pageStart: section.pageStart,
    pageEnd: section.pageEnd,
  }));

  // Подготовка sections
  const sections = (structured.sections || []).map((section) => ({
    sectionPath: section.sectionPath,
    title: section.title,
    level: section.level,
    pageStart: section.pageStart,
    pageEnd: section.pageEnd,
  }));

  // Подготовка elements
  const processedElements = (structured.elements || []).map((element) => ({
    sectionPath: element.sectionPath,
    elementType: element.elementType,
    pageNumber: element.pageNumber,
    content: cleanText(element.content || ""),
    tableRows: element.tableRows
      ? element.tableRows.map((row) => {
          // Преобразуем Record в формат { cells: string[] } для интерфейса
          const cells = Object.values(row).map((v) => String(v || ""));
          return { cells };
        })
      : undefined,
    heading: element.heading,
  }));

  // Подготовка products
  const products = mergedProducts.map((product) => ({
    sku: product.sku,
    name: product.name,
    attributes: product.attributes,
    sectionPath: product.sectionPath,
    pageNumber: product.pageNumber,
  }));

    // Общий счетчик токенов
    const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);

    console.log(
      `[DocumentProcessor] Обработка завершена: ${chunks.length} чанков, ` +
      `${products.length} продуктов, ${totalTokens} токенов`
    );

  return {
    filename,
      fileType: ext,
      processingType: processingType as
        | "catalog"
        | "instruction"
        | "general"
        | "certificate"
        | "passport"
        | "warranty_faq",
      numPages: structured.numPages || 0,
      title: structured.title,
      toc,
      sections,
      elements: processedElements,
      products,
    chunks,
    documentMetadata,
      totalTokens,
    };
  } catch (error) {
    console.error(`[DocumentProcessor] Критическая ошибка обработки документа:`, error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Document processing failed: ${String(error)}`);
  }
}

/**
 * Валидация файла перед обработкой
 */
export function validateFile(
  filename: string,
  fileSize: number,
  maxSizeBytes: number = 100 * 1024 * 1024 // 100MB default
): { valid: boolean; error?: string } {
  const ext = path.extname(filename).toLowerCase();
  const supportedFormats = [".pdf", ".xlsx", ".docx"];

  if (!supportedFormats.includes(ext)) {
    return {
      valid: false,
      error: `Unsupported file format: ${ext}. Supported: ${supportedFormats.join(", ")}`,
    };
  }

  if (fileSize > maxSizeBytes) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed size of ${maxSizeBytes / 1024 / 1024}MB`,
    };
  }

  return { valid: true };
}
