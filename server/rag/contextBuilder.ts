import { truncateContent } from "./textProcessing";
import type {
  ContextCaps,
  ContextSourceEntry,
  RetrievalDiagnostics,
} from "./types";

const TOKEN_CHAR_RATIO = 4;

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / TOKEN_CHAR_RATIO));
}

export interface BuildContextResult {
  context: string;
  usedSources: ContextSourceEntry[];
  totalTokens: number;
}

export function buildContext(
  sources: ContextSourceEntry[],
  caps: ContextCaps
): BuildContextResult {
  const lines: string[] = [];
  const usedSources: ContextSourceEntry[] = [];
  let totalTokens = 0;

  sources.forEach((source, index) => {
    if (usedSources.length >= caps.maxChunks) {
      return;
    }

    let truncatedContent = (source.chunkContent ?? "").trim();
    if (!truncatedContent) {
      return;
    }

    const headerTokenCost = estimateTokens(source.filename ?? "") + 12;
    let blockTokens =
      estimateTokens(truncatedContent) + headerTokenCost;

    if (totalTokens + blockTokens > caps.maxTokens) {
      const availableTokens = caps.maxTokens - totalTokens - headerTokenCost;
      if (availableTokens <= 0) {
        return;
      }
      const permittedChars = Math.max(availableTokens * TOKEN_CHAR_RATIO, 1);
      truncatedContent = truncateContent(truncatedContent, permittedChars);
      blockTokens =
        estimateTokens(truncatedContent) + headerTokenCost;
      if (totalTokens + blockTokens > caps.maxTokens) {
        return;
      }
    }

    const headerLines = [
      `[Источник #${usedSources.length + 1}]`,
      `Документ: ${source.filename}`,
      `Тип: ${source.documentType}`,
    ];

    if (source.sectionPath) {
      headerLines.push(`Раздел: ${source.sectionPath}`);
    }

    // Extract product identifier from boostsApplied (product: tag) or content
    const productTag = source.boostsApplied?.find((tag) => tag.startsWith("product:"));
    let productId: string | null = productTag ? productTag.replace("product:", "") : null;
    
    // If not found in tags, try to extract from content
    if (!productId) {
      const productPatterns = [
        /(?:Товар|Product|Артикул|SKU)[:\s]+([А-ЯЁA-Z0-9][А-ЯЁA-Z0-9\s\-–]+)/i,
        /^([А-ЯЁA-Z][а-яё]+(?:\s+[А-ЯЁA-Z][а-яё]+)*)\s*[:\-–]/,
        /\b([А-ЯЁA-Z0-9]{3,}(?:[-–][А-ЯЁA-Z0-9]{2,})+)\b/,
      ];
      
      for (const pattern of productPatterns) {
        const match = source.chunkContent.match(pattern);
        if (match && match[1]) {
          productId = match[1].trim();
          if (productId.length > 2 && productId.length < 100) {
            break;
          }
        }
      }
    }
    
    if (productId) {
      headerLines.push(`Товар: ${productId}`);
    }

    if (source.pageStart || source.pageEnd) {
      if (
        source.pageStart &&
        source.pageEnd &&
        source.pageStart !== source.pageEnd
      ) {
        headerLines.push(
          `Страницы: ${source.pageStart}–${source.pageEnd}`
        );
      } else {
        const page = source.pageStart ?? source.pageEnd;
        if (page) {
          headerLines.push(`Страница: ${page}`);
        }
      }
    }

    headerLines.push("Фрагмент:");
    headerLines.push(`«${truncatedContent}»`);

    lines.push(headerLines.join("\n"));
    lines.push(""); // blank line for readability

    totalTokens += blockTokens;
    usedSources.push(source);
  });

  return {
    context: lines.join("\n").trim(),
    usedSources,
    totalTokens,
  };
}

