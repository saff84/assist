import { and, eq } from "drizzle-orm";
import { documents, sections } from "../drizzle/schema";
import { getDb } from "./db";
import { hasProductSubject } from "./productQuestion";

const tokens=(text:string)=>text.toLowerCase().replace(/ё/g,"е").match(/[а-яa-z0-9]+/g)??[];
const stem=(word:string)=>word.replace(/(?:ого|ому|ами|ыми|ая|ое|ые|ие|ый|ий|ой|ов|ах|ы|и|а|я|у|ю|е)$/i,"");
function subjectTerms(query:string):string[] {
  return tokens(query).filter(word=>!/^(?:характеристики|характеристика|параметры|описание|расскажи|расскажите|общее|общие|технические|основные|пожалуйста|мне|о|об|про|для|нужны|нужно|дай|покажи|санекст|sanext)$/i.test(word)).map(stem);
}
export function matchCatalogSubject(query:string,names:string[]):string|null {
  const terms=subjectTerms(query);
  if(!terms.length||!terms.some(term=>/^[а-яa-z]{3,}$/i.test(term)))return null;
  const matches=new Map<string,string>();
  for(const name of names) {
    if(!hasProductSubject(name)||/характеристик|монтаж|инструмент|насадк|подключ|размер|таблиц|гидравлич|номенклатур/i.test(name))continue;
    const words=tokens(name).map(stem);
    if(terms.every(term=>words.includes(term)))matches.set([...words].sort().join("|"),name);
  }
  return matches.size===1?Array.from(matches.values())[0]:null;
}
export async function resolveCatalogSubject(query:string):Promise<string|null> {
  if(!/характеристик|параметр|описани|расскажи|расскажите/i.test(query)||hasProductSubject(query)||!subjectTerms(query).length)return null;
  const db=await getDb();if(!db)return null;
  const headings=await db.select({name:sections.title}).from(sections)
    .innerJoin(documents,eq(sections.documentId,documents.id))
    .where(and(eq(documents.docType,"catalog"),eq(documents.status,"indexed")));
  return matchCatalogSubject(query,headings.map(item=>item.name));
}
