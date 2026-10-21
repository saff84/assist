import { and,eq,inArray } from "drizzle-orm";
import { documents } from "../drizzle/schema";
import { getDb } from "./db";
import { normalizeCategory, type DocumentApplicability } from "../shared/documentApplicability";
import type { CatalogSkuMatch } from "./catalogSkuLookup";
import type { BasicDocumentHit } from "./rag/documentDiscovery";
import { listDocumentApplicability } from "./documentApplicabilityStore";
export function applicabilityScore(binding:DocumentApplicability,sku:string,matches:CatalogSkuMatch[]):number {
  if(binding.skus.includes(sku))return 3;
  for(const match of matches) {
    if(binding.catalogIds.length && (!match.catalogId||!binding.catalogIds.includes(match.catalogId)))continue;
    if(!binding.categories.length&&!binding.productLines.length) {
      if(binding.catalogIds.length)return 1;continue;
    }
    const labels=[match.groupName,match.productName,...(match.hierarchy??[])].filter((value):value is string=>!!value).map(normalizeCategory);
    const categoryMatches=!binding.categories.length||binding.categories.some(value=>labels.includes(normalizeCategory(value)));
    const lineMatches=!binding.productLines.length||binding.productLines.some(value=>labels.includes(normalizeCategory(value)));
    if(categoryMatches&&lineMatches)return 2;
  }
  return 0;
}
export async function findApplicableDocuments(sku:string,type:"passport"|"certificate",matches:CatalogSkuMatch[]):Promise<BasicDocumentHit[]> {
  const bindings=(await listDocumentApplicability()).map(binding=>({binding,score:applicabilityScore(binding,sku,matches)}))
    .filter(item=>item.score>0).sort((a,b)=>b.score-a.score);
  if(!bindings.length)return [];
  const db=await getDb();if(!db)throw new Error("Database not available");
  const rows=await db.select({id:documents.id,filename:documents.filename,title:documents.title,fileType:documents.fileType,docType:documents.docType,chunksCount:documents.chunksCount,downloadFilename:documents.downloadFilename})
    .from(documents).where(and(inArray(documents.id,bindings.map(item=>item.binding.documentId)),eq(documents.docType,type),eq(documents.status,"indexed")));
  return rows.sort((a,b)=>bindings.findIndex(item=>item.binding.documentId===a.id)-bindings.findIndex(item=>item.binding.documentId===b.id)) as BasicDocumentHit[];
}
