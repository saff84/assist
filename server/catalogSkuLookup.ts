import { and, eq, or, sql, inArray } from "drizzle-orm";
import { products, productGroups, documents, documentChunks, sections } from "../drizzle/schema";
import { getDb } from "./db";

export type CatalogSkuMatch = {groupName:string|null; productName:string|null; hierarchy?:string[];catalogId?:number};
type CatalogSection={sectionPath:string;title:string;parentPath?:string|null};
export function buildCatalogHierarchy(sectionPath:string|null|undefined,all:CatalogSection[],catalogTitle?:string|null):string[] {
  const names:string[]=[];const seen=new Set<string>();let current=sectionPath;
  while(current&&!seen.has(current)) {
    seen.add(current);
    const section=all.find(item=>item.sectionPath===current);
    const name=catalogSectionName(section?.title);
    if(name&&!names.includes(name))names.push(name);
    current=section?.parentPath || (current.includes(".")?current.slice(0,current.lastIndexOf(".")):null);
  }
  const title=catalogSectionName(catalogTitle?.replace(/\.(?:md|pdf)$/i,"").replace(/_/g," "));
  if(title&&!names.includes(title))names.push(title);
  return names;
}
export function catalogSectionName(value:unknown):string|null {
  if(typeof value!=="string")return null;
  const name=value.trim().replace(/^\d+(?:\.\d+)*\.?\s*/,"");
  if(!name || /^(?:страница\s*\d+|номенклатура|характеристики|технические характеристики|каталог|root)$/i.test(name))return null;
  return name;
}
export function catalogNameFromContent(content:string|undefined):string|null {
  if(!content)return null;
  const product=/(?:^|\s)Товар:\s*(.+?)(?=\s+Артикул\s*:|\s+Вариант\s*:|\n|\||$)/i.exec(content)?.[1];
  if(product)return catalogSectionName(product);
  return catalogSectionName(content.split(/\n|\|/)[0]?.replace(/\s+Артикул\s*:.*/i,""));
}
export function exactSkuRow(row:Record<string,unknown>, sku:string):boolean {
  return Object.entries(row).some(([key,value]) =>
    /артикул|\bsku\b|^код(?:\s|$)|article/i.test(key) && String(value ?? "").trim() === sku);
}
export async function findCatalogSku(sku:string):Promise<CatalogSkuMatch[]> {
  const db=await getDb();
  if(!db) throw new Error("Database not available");
  const rows = await db.select({groupName:productGroups.name,productName:products.name,sectionTitle:sections.title,
    catalogId:documents.id,catalogTitle:documents.title,catalogFilename:documents.filename,sectionPath:sections.sectionPath,groupSectionPath:productGroups.sectionPath})
    .from(products).innerJoin(documents,eq(products.documentId,documents.id))
    .leftJoin(productGroups,and(eq(products.groupId,productGroups.id),eq(products.documentId,productGroups.documentId)))
    .leftJoin(sections,and(eq(products.sectionId,sections.id),eq(products.documentId,sections.documentId)))
    .where(and(eq(products.sku,sku),eq(documents.docType,"catalog"),eq(documents.status,"indexed")));
  const matches:CatalogSkuMatch[]=rows.map(row=>({groupName:catalogSectionName(row.groupName)??catalogSectionName(row.sectionTitle),productName:catalogSectionName(row.productName)}));
  // Manual catalog markup stores its SKUs in tableJson rather than products.
  const chunks=await db.select({rows:documentChunks.tableJson,metadata:documentChunks.chunkMetadata,content:documentChunks.content,sectionTitle:sections.title,
    catalogId:documents.id,catalogTitle:documents.title,catalogFilename:documents.filename,sectionPath:documentChunks.sectionPath})
    .from(documentChunks).innerJoin(documents,eq(documentChunks.documentId,documents.id))
    .leftJoin(sections,and(eq(documentChunks.documentId,sections.documentId),eq(documentChunks.sectionPath,sections.sectionPath)))
    .where(and(eq(documents.docType,"catalog"),eq(documents.status,"indexed"),
      or(sql`CAST(${documentChunks.tableJson} AS CHAR) LIKE ${"%"+sku+"%"}`,
        sql`${documentChunks.content} LIKE ${"%"+sku+"%"}`)));
  const ids=Array.from(new Set([...rows.map(row=>row.catalogId),...chunks.map(chunk=>chunk.catalogId)].filter((id):id is number=>typeof id==="number")));
  const parents=ids.length?await db.select({documentId:sections.documentId,sectionPath:sections.sectionPath,title:sections.title,parentPath:sections.parentPath})
    .from(sections).where(inArray(sections.documentId,ids)):[];
  const enrich=(record:{catalogId?:number;catalogTitle?:string|null;catalogFilename?:string;sectionPath?:string|null;groupSectionPath?:string|null},match:CatalogSkuMatch)=>{
    if(record.catalogId===undefined)return match;
    return {...match,catalogId:record.catalogId,hierarchy:buildCatalogHierarchy(record.sectionPath??record.groupSectionPath,
      (parents??[]).filter(section=>section.documentId===record.catalogId),record.catalogTitle||record.catalogFilename)};
  };
  rows.forEach((row,index)=>{matches[index]=enrich(row,matches[index]);});
  for(const chunk of chunks) {
    for(const row of chunk.rows ?? []) {
      if(!exactSkuRow(row,sku)) continue;
      const name=Object.entries(row).find(([key])=>/наименование|название|^name$/i.test(key))?.[1];
      matches.push(enrich(chunk,{groupName:catalogSectionName(chunk.metadata?.productGroupName)
          ??catalogSectionName(chunk.metadata?.section)??catalogSectionName(chunk.sectionTitle)
          ??catalogSectionName(chunk.metadata?.heading)??catalogNameFromContent(chunk.content),
        productName:catalogSectionName(chunk.metadata?.productVariantName)??catalogSectionName(name)}));
    }
  }
  return matches;
}
