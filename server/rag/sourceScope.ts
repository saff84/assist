import { and, eq, inArray, or, sql } from "drizzle-orm";
import { documents, documentChunks } from "../../drizzle/schema";
import type { RAGOptions } from "./types";
import type { ScoredChunk } from "./types";
export function retrievalScopeWhere(options?:RAGOptions) {
  const types=options?.allowedDocumentTypes??(options?.forceDocumentType?[options.forceDocumentType]:undefined);
  const scope=options?.productScope;
  return and(eq(documents.status,"indexed"),types?inArray(documents.docType,types):undefined,
    scope?(scope.sections.length?or(...scope.sections.map(section=>and(eq(documents.id,section.documentId),or(
      eq(documentChunks.sectionPath,section.sectionPath),
      sql`LEFT(${documentChunks.sectionPath}, ${section.sectionPath.length+1}) = ${section.sectionPath+"."}`
    )))):sql`FALSE`):undefined);
}
export function scopedProductBundle(chunks:ScoredChunk[],query:string,minimumScore:number):ScoredChunk[] {
  // Keep related rows together rather than letting MMR discard similar rows
  // of a single product's characteristics table.
  const information=/характерист|параметр|описани/i.test(query);
  const priority=(chunk:ScoredChunk)=>information&&/характерист/i.test([chunk.heading,chunk.metadata?.heading,chunk.metadata?.subsection,chunk.content.slice(0,200)].join(" "))?1:0;
  const grouped=new Map<string,ScoredChunk[]>();
  for(const chunk of chunks) {
    const key=`${chunk.documentId}:${chunk.sectionPath??chunk.chunkIndex}`;
    const group=grouped.get(key)??[];group.push(chunk);grouped.set(key,group);
  }
  return Array.from(grouped.values()).map(group=>{
    group.sort((a,b)=>a.chunkIndex-b.chunkIndex);const first=group[0];
    const rows=group.flatMap(chunk=>Array.isArray(chunk.metadata?.tableJson)?chunk.metadata!.tableJson:[]);
    const uniqueRows=Array.from(new Map(rows.map(row=>[JSON.stringify(row),row])).values());
    return {...first,content:group.map(chunk=>chunk.content).join("\n\n"),
      metadata:{...first.metadata,...(uniqueRows.length?{tableJson:uniqueRows}:{}),bundleChunkIndices:group.map(chunk=>chunk.chunkIndex)},
      relevance:Math.max(...group.map(chunk=>chunk.relevance),minimumScore),boostsApplied:[...first.boostsApplied,"exact_product_scope"]};
  }).sort((a,b)=>priority(b)-priority(a)||a.documentId-b.documentId||a.chunkIndex-b.chunkIndex);
}
