import { and, eq, or, sql } from "drizzle-orm";
import { products, productGroups, documents, documentChunks } from "../drizzle/schema";
import { getDb } from "./db";

export type CatalogSkuMatch = {groupName:string|null; productName:string|null};
export function exactSkuRow(row:Record<string,unknown>, sku:string):boolean {
  return Object.entries(row).some(([key,value]) =>
    /артикул|\bsku\b|^код(?:\s|$)|article/i.test(key) && String(value ?? "").trim() === sku);
}
export async function findCatalogSku(sku:string):Promise<CatalogSkuMatch[]> {
  const db=await getDb();
  if(!db) throw new Error("Database not available");
  const matches = await db.select({groupName:productGroups.name,productName:products.name})
    .from(products).innerJoin(documents,eq(products.documentId,documents.id))
    .leftJoin(productGroups,and(eq(products.groupId,productGroups.id),eq(products.documentId,productGroups.documentId)))
    .where(and(eq(products.sku,sku),eq(documents.docType,"catalog"),eq(documents.status,"indexed")));
  // Manual catalog markup stores its SKUs in tableJson rather than products.
  const chunks=await db.select({rows:documentChunks.tableJson,metadata:documentChunks.chunkMetadata})
    .from(documentChunks).innerJoin(documents,eq(documentChunks.documentId,documents.id))
    .where(and(eq(documents.docType,"catalog"),eq(documents.status,"indexed"),
      or(sql`CAST(${documentChunks.tableJson} AS CHAR) LIKE ${"%"+sku+"%"}`,
        sql`${documentChunks.content} LIKE ${"%"+sku+"%"}`)));
  for(const chunk of chunks) {
    for(const row of chunk.rows ?? []) {
      if(!exactSkuRow(row,sku)) continue;
      const name=Object.entries(row).find(([key])=>/наименование|название|^name$/i.test(key))?.[1];
      matches.push({groupName:chunk.metadata?.productGroupName ?? null,
        productName:chunk.metadata?.productVariantName ?? (name ? String(name):null)});
    }
  }
  return matches;
}
