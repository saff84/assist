import { and, eq, isNotNull } from "drizzle-orm";
import { documents, sections, products, productGroups, productItems, documentChunks } from "../drizzle/schema";
import { getDb } from "./db";
import type { RAGResponse } from "./ragModule";

const families = [/труб/i, /фитинг/i, /редуктор/i, /клапан/i, /коллектор/i, /радиатор/i, /насос/i, /кран/i,
  /заглуш/i, /муфт/i, /тройник/i, /переходник/i, /термостат/i, /сч[её]тчик/i, /фильтр/i,
  /водонагревател/i, /расширительн\S*\s+бак/i, /термоголов/i, /воздухоотводчик/i,
  /распределительн\S*\s+(?:коллектор|узел)|(?:^|\s)рку(?:\s|$)/i];
export function assortmentFamily(query:string):RegExp|null {
  if (/паспорт|сертифик|монтаж|подключ|подход|совмест|температур|диаметр|толщин|цен[аыу]|стоим|какое давление/i.test(query)) return null;
  if (!/каки[еe]|какой ассортимент|ассортимент|перечисл|список|виды|типы/i.test(query)) return null;
  const matched=families.filter(pattern=>pattern.test(query));
  if(/редуктор/i.test(query))matched.push(/клапан(?=[\s\S]*редукцион)|редукцион(?=[\s\S]*клапан)/i);
  return matched.length?new RegExp(matched.map(pattern=>`(?:${pattern.source})`).join("|"),"i"):null;
}
type Entry={documentId:number;filename:string;name:string;sectionPath?:string|null;chunkIndex?:number;pageNumber?:number|null};
const words=(value:string)=>value.toLowerCase().replace(/ё/g,"е").match(/[а-яa-z0-9]+/g)??[];
const stem=(word:string)=>word.replace(/(?:иями|ами|ого|ему|ому|ыми|ими|ая|яя|ое|ее|ые|ие|ый|ий|ой|ых|их|ов|ам|ям|ах|ях|ы|и|а|я|у|ю|е|о)$/i,"");
export function assortmentQualifiers(query:string):string[] {
  const ignored=/^(?:какие|каких|какой|какая|какое|каков|есть|имеются|бывают|у|в|на|по|и|или|из|для|мне|пожалуйста|sanext|санекст|ассортимент|перечисли|перечислите|список|виды|типы|все|вас|ваши|предлагает|выпускает|покажи|покажите|доступны|давления)$/i;
  return words(query).filter(word=>!ignored.test(word)&&!families.some(f=>f.test(word))).map(stem);
}
export function selectAssortment(entries:Entry[],family:RegExp,query=""):Entry[] {
  const qualifiers=assortmentQualifiers(query);
  const seen=new Set<string>();
  return entries.flatMap(entry=>{
    const name=entry.name.replace(/\.(?:md|pdf)$/i,"").replace(/_/g," ").replace(/^\d+(?:\.\d+)*\.?\s*/,"").trim();
    if (!family.test(name)||/монтаж|характеристик|таблица|размер|гидравлич|инструкц|номенклатур|сертифик|паспорт|упоминание|значени[ея]|настройк|подбор|комплектующ/i.test(name)) return [];
    const tokens=words(name);
    // A pipe must be the product itself, not a connection or accessory mentioning pipes.
    if(family.test("трубы")&&!family.test("клапан")&&!family.test("фитинги")) {
      const firstProduct=tokens.find(word=>families.some(f=>f.test(word)));
      if(!firstProduct||!/^труб(?:а|ы|у|е|ой|ами|ах)?$/.test(firstProduct))return [];
    }
    const stems=tokens.map(stem);
    if(!qualifiers.every(qualifier=>stems.includes(qualifier)))return [];
    const key=stems.filter(word=>word!=="sanext"&&word!=="санекст").sort().join("|");
    if(seen.has(key))return [];seen.add(key);return [{...entry,name}];
  }).sort((a,b)=>a.name.localeCompare(b.name,"ru"));
}
export async function catalogAssortmentResponse(query:string):Promise<RAGResponse|null> {
  const family=assortmentFamily(query);if(!family)return null;
  const db=await getDb();if(!db)throw new Error("Database not available");
  const filter=and(eq(documents.docType,"catalog"),eq(documents.status,"indexed"));
  const [automatic,manual,chunks]=await Promise.all([
    db.select({documentId:documents.id,filename:documents.filename,name:products.name,groupName:productGroups.name,sectionName:sections.title,sectionPath:sections.sectionPath,pageNumber:products.pageNumber})
      .from(products).innerJoin(documents,eq(products.documentId,documents.id))
      .leftJoin(productGroups,and(eq(products.groupId,productGroups.id),eq(products.documentId,productGroups.documentId)))
      .leftJoin(sections,and(eq(products.sectionId,sections.id),eq(products.documentId,sections.documentId))).where(filter),
    db.select({documentId:documents.id,filename:documents.filename,name:productItems.name,sectionPath:productGroups.sectionPath})
      .from(productItems).innerJoin(documents,eq(productItems.documentId,documents.id))
      .innerJoin(productGroups,and(eq(productItems.groupId,productGroups.id),eq(productItems.documentId,productGroups.documentId))).where(filter),
    db.select({documentId:documents.id,filename:documents.filename,rows:documentChunks.tableJson,metadata:documentChunks.chunkMetadata,sectionName:sections.title,
      sectionPath:documentChunks.sectionPath,chunkIndex:documentChunks.chunkIndex,pageNumber:documentChunks.pageNumber})
      .from(documentChunks).innerJoin(documents,eq(documentChunks.documentId,documents.id))
      .leftJoin(sections,and(eq(documentChunks.documentId,sections.documentId),eq(documentChunks.sectionPath,sections.sectionPath)))
      .where(and(filter,isNotNull(documentChunks.tableJson))),
  ]);
  const candidates:Entry[]=[...manual,...automatic.map(row=>({...row,name:row.name||row.groupName||row.sectionName||""}))];
  for(const chunk of chunks)for(const row of chunk.rows??[]) {
    if(!Object.keys(row).some(key=>/артикул|^sku$|article/i.test(key)))continue;
    const rowName=Object.entries(row).find(([key])=>/наименование|название|^name$/i.test(key))?.[1];
    const name=typeof rowName==="string"&&rowName.trim()?rowName:chunk.metadata?.productVariantName||chunk.metadata?.productGroupName||chunk.sectionName;
    if(name)candidates.push({...chunk,name});
  }
  const entries=selectAssortment(candidates,family,query);
  if(!entries.length)return {response:"В базе товаров не удалось найти товарные позиции, соответствующие запросу. Уточните название категории или линейки — поиск выполнен только по базе товаров.",needsClarification:true,sources:[],responseTime:0,tokensUsed:0};
  const sources=Array.from(new Map(entries.map(entry=>[`${entry.documentId}:${entry.sectionPath??""}`,{
    documentId:entry.documentId,filename:entry.filename,chunkIndex:entry.chunkIndex??0,relevance:1,sectionPath:entry.sectionPath??undefined,pageNumber:entry.pageNumber??undefined,
  }])).values());
  return {response:"В базе товаров SANEXT найдены:\n\n"+entries.map(entry=>`- ${entry.name}`).join("\n")+"\n\nМогу рассказать подробнее о характеристиках или помочь с подбором.",sources,responseTime:0,tokensUsed:0};
}
