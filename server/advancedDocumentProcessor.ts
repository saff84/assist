import * as pdfjsLib from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import fs from "fs/promises";

/**
 * Advanced Document Processor
 * Handles different processing types for documents
 */

export type ProcessingType =
  | "general"
  | "instruction"
  | "catalog"
  | "certificate"
  | "passport"
  | "warranty_faq";

export interface DocumentMetadata {
  hasTableOfContents?: boolean;
  tableOfContents?: Array<{ title: string; level: number; page?: number }>;
  sections?: Array<{ title: string; startPage?: number; endPage?: number }>;
  categories?: Array<string>;
  tags?: Array<string>;
  customFields?: Record<string, any>;
}

export interface ChunkMetadata {
  section?: string;
  subsection?: string;
  pageNumber?: number;
  heading?: string;
  category?: string;
  tags?: Array<string>;
  importance?: 'high' | 'medium' | 'low';
  sectionPath?: string;
  elementType?: 'text' | 'table' | 'figure' | 'list' | 'header';
}

export interface ProcessedChunk {
  content: string;
  metadata: ChunkMetadata;
  tokenCount: number;
}

export interface ProcessingResult {
  chunks: ProcessedChunk[];
  documentMetadata: DocumentMetadata;
}

/**
 * Extract table of contents from document
 */
function extractTableOfContents(text: string): Array<{ title: string; level: number }> {
  const toc: Array<{ title: string; level: number }> = [];
  const lines = text.split('\n');
  
  // Паттерны для определения заголовков
  const patterns = [
    /^(#{1,6})\s+(.+)$/,  // Markdown headers
    /^(\d+\.)+\s+(.+)$/,  // Numbered headers like "1.2.3 Title"
    /^([IVXLCDM]+)\.\s+(.+)$/,  // Roman numerals
    /^(Глава|Раздел|Часть|Chapter|Section|Part)\s+(\d+)[:\.]?\s*(.*)$/i,
  ];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Check for markdown headers
    const mdMatch = trimmed.match(patterns[0]);
    if (mdMatch) {
      toc.push({
        title: mdMatch[2].trim(),
        level: mdMatch[1].length,
      });
      continue;
    }
    
    // Check for numbered headers
    const numMatch = trimmed.match(patterns[1]);
    if (numMatch) {
      const level = (numMatch[1].match(/\./g) || []).length + 1;
      toc.push({
        title: numMatch[2].trim(),
        level: level,
      });
      continue;
    }
    
    // Check for chapter/section headers
    const chapterMatch = trimmed.match(patterns[3]);
    if (chapterMatch) {
      toc.push({
        title: (chapterMatch[3] || chapterMatch[1]).trim(),
        level: 1,
      });
    }
  }
  
  return toc;
}

/**
 * Simple processing - basic chunking without special structure
 */
export async function processSimple(
  text: string,
  chunkSize: number = 1000,
  overlap: number = 200
): Promise<ProcessingResult> {
  const chunks: ProcessedChunk[] = [];
  const words = text.split(/\s+/);
  
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunkWords = words.slice(i, i + chunkSize);
    const content = chunkWords.join(' ');
    
    chunks.push({
      content,
      metadata: {
        importance: 'medium',
      },
      tokenCount: chunkWords.length,
    });
  }
  
  return {
    chunks,
    documentMetadata: {},
  };
}

/**
 * Instruction processing - extract and preserve document structure
 */
export async function processInstruction(
  text: string,
  chunkSize: number = 1000,
  overlap: number = 200
): Promise<ProcessingResult> {
  const chunks: ProcessedChunk[] = [];
  
  // Extract table of contents
  const toc = extractTableOfContents(text);
  const hasTOC = toc.length > 0;
  
  // Split text into sections based on TOC
  const sections = hasTOC ? splitIntoSections(text, toc) : [{ title: 'Main', content: text, level: 1 }];
  
  // Process each section
  for (const section of sections) {
    const sectionChunks = splitTextIntoChunks(section.content, chunkSize, overlap);
    
    for (let i = 0; i < sectionChunks.length; i++) {
      const chunk = sectionChunks[i];
      chunks.push({
        content: chunk,
        metadata: {
          section: section.title,
          heading: section.title,
          importance: section.level === 1 ? 'high' : 'medium',
        },
        tokenCount: chunk.split(/\s+/).length,
      });
    }
  }
  
  return {
    chunks,
    documentMetadata: {
      hasTableOfContents: hasTOC,
      tableOfContents: toc,
      sections: sections.map(s => ({ title: s.title })),
    },
  };
}

/**
 * Catalog processing - for product catalogs and lists
 */
export async function processCatalog(
  text: string,
  chunkSize: number = 500
): Promise<ProcessingResult> {
  const chunks: ProcessedChunk[] = [];
  const categories: string[] = [];
  
  // Extract table of contents as categories
  const toc = extractTableOfContents(text);
  const sections = splitIntoSections(text, toc);
  
  console.log(`[Catalog] Found ${sections.length} sections`);
  
  // Each section is a category
  for (const section of sections) {
    categories.push(section.title);
    
    // Split section into items (paragraphs)
    const items = section.content.split(/\n\n+/).filter(item => item.trim().length > 10);
    
    console.log(`[Catalog] Section "${section.title}": ${items.length} items`);
    
    for (const item of items) {
      // Each item (product) is a separate chunk
      chunks.push({
        content: item.trim(),
        metadata: {
          category: section.title,
          section: section.title,
          importance: 'high', // All catalog items are important
          tags: extractTags(item),
        },
        tokenCount: item.split(/\s+/).length,
      });
    }
  }
  
  // FALLBACK: If no chunks created, use simple processing
  if (chunks.length === 0) {
    console.log('[Catalog] No sections found, falling back to simple processing');
    return processSimple(text, chunkSize, 100);
  }
  
  console.log(`[Catalog] Total chunks created: ${chunks.length}`);
  
  return {
    chunks,
    documentMetadata: {
      hasTableOfContents: toc.length > 0,
      tableOfContents: toc,
      categories: categories,
    },
  };
}

/**
 * Split text into sections based on TOC
 */
function splitIntoSections(
  text: string,
  toc: Array<{ title: string; level: number }>
): Array<{ title: string; content: string; level: number }> {
  if (toc.length === 0) {
    return [{ title: 'Main', content: text, level: 1 }];
  }
  
  const sections: Array<{ title: string; content: string; level: number }> = [];
  const lines = text.split('\n');
  
  let currentSection: { title: string; content: string[]; level: number } | null = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Check if this line matches any TOC entry
    const tocEntry = toc.find(entry => 
      trimmed.includes(entry.title) || 
      entry.title.includes(trimmed)
    );
    
    if (tocEntry) {
      // Save previous section
      if (currentSection) {
        sections.push({
          title: currentSection.title,
          content: currentSection.content.join('\n'),
          level: currentSection.level,
        });
      }
      
      // Start new section
      currentSection = {
        title: tocEntry.title,
        content: [line],
        level: tocEntry.level,
      };
    } else if (currentSection) {
      currentSection.content.push(line);
    }
  }
  
  // Add last section
  if (currentSection) {
    sections.push({
      title: currentSection.title,
      content: currentSection.content.join('\n'),
      level: currentSection.level,
    });
  }
  
  return sections;
}

/**
 * Split text into chunks with overlap
 */
function splitTextIntoChunks(
  text: string,
  chunkSize: number,
  overlap: number
): string[] {
  const chunks: string[] = [];
  const words = text.split(/\s+/);
  
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunkWords = words.slice(i, i + chunkSize);
    chunks.push(chunkWords.join(' '));
  }
  
  return chunks;
}

/**
 * Extract tags from text (simple keyword extraction)
 */
function extractTags(text: string): string[] {
  const tags: string[] = [];
  
  // Common keywords patterns
  const keywordPatterns = [
    /артикул[:\s]+([A-Z0-9-]+)/gi,
    /код[:\s]+([A-Z0-9-]+)/gi,
    /цена[:\s]+([\d\s,\.]+)/gi,
    /размер[:\s]+([XS|S|M|L|XL|XXL|\d+]+)/gi,
    /цвет[:\s]+(\w+)/gi,
  ];
  
  for (const pattern of keywordPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        tags.push(match[1].trim());
      }
    }
  }
  
  return [...new Set(tags)]; // Remove duplicates
}

/**
 * Main processing function - routes to appropriate processor
 */
export async function processDocument(
  text: string,
  processingType: ProcessingType,
  options?: {
    chunkSize?: number;
    overlap?: number;
  }
): Promise<ProcessingResult> {
  const chunkSize = options?.chunkSize || 1000;
  const overlap = options?.overlap || 200;
  
  switch (processingType) {
    case "general":
      return processSimple(text, chunkSize, overlap);
    
    case "instruction":
      return processInstruction(text, chunkSize, overlap);
    
    case "catalog":
      return processCatalog(text, chunkSize);

    // Stubs for now: treat as general processing until specialized logic is added
    case "certificate":
    case "passport":
    case "warranty_faq":
      return processSimple(text, chunkSize, overlap);
    
    default:
      return processSimple(text, chunkSize, overlap);
  }
}

