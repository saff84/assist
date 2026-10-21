import { and, eq } from "drizzle-orm";
import { documents, sections } from "../drizzle/schema";
import { getDb } from "./db";
import { modelCodes, type ProductScope } from "../shared/productScope";
import { hasProductSubject } from "./productQuestion";
import { matchCatalogSubject } from "./catalogSubject";
export type ScopeResult={scope?:ProductScope;clarification?:string};
type Heading={name:string;documentId:number;sectionPath:string};
export function matchModelScope(query:string,headings:Heading[]):ScopeResult {
  const models=modelCodes(query);
  if(!models.length) {
    const normalized=(value:string)=>value.toLowerCase().replace(/ё/g,"е").replace(/[^а-яa-z0-9]+/g," ").trim();
    const owners=headings.filter(row=>hasProductSubject(row.name)&&!/характеристик|размер|инструмент|насадк|таблиц|номенклатур|монтаж/i.test(row.name));
    const named=matchCatalogSubject(query,owners.map(row=>row.name));
    const exact=named?owners.filter(row=>normalized(row.name)===normalized(named)):owners.filter(row=>normalized(query).includes(normalized(row.name)));
    if(!exact.length)return {};
    const longest=Math.max(...exact.map(row=>normalized(row.name).length));
    const selected=exact.filter(row=>normalized(row.name).length===longest);
    if(new Set(selected.map(row=>normalized(row.name))).size!==1)return {};
    return {scope:{name:selected[0].name,sections:selected.map(row=>({documentId:row.documentId,sectionPath:row.sectionPath}))}};
  }
  if(models.length!==1)return {};
  const model=models[0];
  const owners=headings.filter(row=>! /характеристик|принадлежност|аксессуар|размер|таблиц|ниппель|трубка|монтаж/i.test(row.name));
  const exact=owners.filter(row=>{const codes=modelCodes(row.name);return codes.length===1&&codes[0]===model;});
  if(exact.length)return {scope:{name:exact[0].name,model,sections:exact.map(row=>({documentId:row.documentId,sectionPath:row.sectionPath}))}};
  const related=owners.filter(row=>modelCodes(row.name).some(code=>code.startsWith(model+"-")||model.startsWith(code+"-")));
  return {clarification:related.length?`Для модели ${model} точный раздел каталога не найден. В каталоге есть: ${Array.from(new Set(related.map(row=>row.name))).join("; ")}. Уточните модель — заменять её другой автоматически нельзя.`:`В каталоге не найден точный раздел модели ${model}. Уточните название или артикул. Для проверки паспорта задайте отдельный вопрос.`};
}
export async function resolveCatalogProductScope(query:string):Promise<ScopeResult> {
  if(modelCodes(query).length!==1&&!hasProductSubject(query))return {};
  const db=await getDb();if(!db)throw new Error("Database not available");
  const rows=await db.select({name:sections.title,documentId:sections.documentId,sectionPath:sections.sectionPath}).from(sections)
    .innerJoin(documents,eq(sections.documentId,documents.id)).where(and(eq(documents.docType,"catalog"),eq(documents.status,"indexed")));
  return matchModelScope(query,rows);
}
