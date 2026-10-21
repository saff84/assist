import { and, eq } from "drizzle-orm";
import { documents, sections, productGroups } from "../drizzle/schema";
import { getDb } from "./db";
import type { RAGResponse } from "./ragModule";

const families = [/труб/i, /фитинг/i, /редуктор/i, /клапан/i, /коллектор/i, /радиатор/i, /насос/i, /кран/i,
  /заглуш/i, /муфт/i, /тройник/i, /переходник/i, /термостат/i, /сч[её]тчик/i, /фильтр/i,
  /водонагревател/i, /расширительн\S*\s+бак/i, /термоголов/i, /воздухоотводчик/i,
  /распределительн\S*\s+(?:коллектор|узел)|(?:^|\s)рку(?:\s|$)/i];
export function assortmentFamily(query:string):RegExp|null {
  if (/паспорт|сертифик|монтаж|подключ|подход|совмест|давлен|температур|диаметр|толщин|цен[аыу]|стоим/i.test(query)) return null;
  if (!/каки[еe]|какой ассортимент|ассортимент|перечисл|список|виды|типы/i.test(query)) return null;
  const matched=families.filter(pattern=>pattern.test(query));
  return matched.length?new RegExp(matched.map(pattern=>`(?:${pattern.source})`).join("|"),"i"):null;
}
type Entry={documentId:number;filename:string;name:string;sectionPath?:string|null};
export function selectAssortment(entries:Entry[],family:RegExp):Entry[] {
  const seen=new Set<string>();
  return entries.flatMap(entry=>{
    const name=entry.name.replace(/\.(?:md|pdf)$/i,"").replace(/_/g," ").replace(/^\d+(?:\.\d+)*\.?\s*/,"").trim();
    if (!family.test(name)||/монтаж|характеристик|таблица|размер|гидравлич|инструкц|номенклатур|сертифик|паспорт/i.test(name)) return [];
    const key=name.toLowerCase().replace(/ё/g,"е").replace(/[^а-яa-z0-9]/g,"");
    if(seen.has(key))return [];seen.add(key);return [{...entry,name}];
  }).sort((a,b)=>a.name.localeCompare(b.name,"ru"));
}
export async function catalogAssortmentResponse(query:string):Promise<RAGResponse|null> {
  const family=assortmentFamily(query);if(!family)return null;
  const db=await getDb();if(!db)throw new Error("Database not available");
  const filter=and(eq(documents.docType,"catalog"),eq(documents.status,"indexed"));
  const [catalogs,headings,groups]=await Promise.all([
    db.select({documentId:documents.id,filename:documents.filename,name:documents.title}).from(documents).where(filter),
    db.select({documentId:documents.id,filename:documents.filename,name:sections.title,sectionPath:sections.sectionPath}).from(sections).innerJoin(documents,eq(sections.documentId,documents.id)).where(filter),
    db.select({documentId:documents.id,filename:documents.filename,name:productGroups.name,sectionPath:productGroups.sectionPath}).from(productGroups).innerJoin(documents,eq(productGroups.documentId,documents.id)).where(filter),
  ]);
  const entries=selectAssortment([...headings,...groups,...catalogs.map(row=>({...row,name:row.name||row.filename}))],family);
  if(!entries.length)return null;
  const sources=Array.from(new Map(entries.map(entry=>[`${entry.documentId}:${entry.sectionPath??""}`,{
    documentId:entry.documentId,filename:entry.filename,chunkIndex:0,relevance:1,sectionPath:entry.sectionPath??undefined,
  }])).values());
  return {response:"В проиндексированных каталогах SANEXT найдены следующие группы и линейки:\n\n"+entries.map(entry=>`- ${entry.name}`).join("\n")+"\n\nКакая линейка вас интересует? Могу рассказать о характеристиках, подборе или монтаже.",sources,responseTime:0,tokensUsed:0};
}
