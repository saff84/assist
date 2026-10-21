import { findCatalogSku, type CatalogSkuMatch } from "./catalogSkuLookup";
import { findBestDocumentsByTitle, findDocumentsByExactSku, type BasicDocumentHit } from "./rag/documentDiscovery";
import { tokenize } from "./rag/textProcessing";
import { trackIntentStage } from "./intentTrace";

export function extractDocumentSkus(query:string):string[] {
  // Do not treat a substring inside a longer SKU or model as an article.
  const numbers=query.match(/(?:^|[^а-яёa-z0-9])([0-9]{4,8})(?=$|[^а-яёa-z0-9])/gi) ?? [];
  return Array.from(new Set(numbers.map(value=>value.replace(/^[^0-9]+/,""))));
}
const normalized=(value:string)=>value.toLowerCase().replace(/ё/g,"е").replace(/[^а-яa-z0-9]+/g," ").trim();
const generic=new Set(["sanext","санекст","паспорт","сертификат","технический","товар","группа","изделие"]);
export function documentMatchesGroup(group:string,doc:BasicDocumentHit,stopwords:Set<string>):boolean {
  const ignored=new Set(Array.from(stopwords).concat(Array.from(generic)));
  const terms=tokenize(group,ignored).filter(term=>term.length>=3 && !generic.has(term));
  if(!terms.length) return false;
  const title=new Set(tokenize(`${doc.title ?? ""} ${doc.filename}`,ignored));
  const matched=terms.filter(term=>title.has(term));
  return matched.length >= Math.max(Math.min(2,terms.length),Math.ceil(terms.length*0.6));
}
export type SkuDocumentResult =
  | {status:"unknown";sku:string}
  | {status:"ambiguous";sku:string;groups:string[]}
  | {status:"resolved";sku:string;group:string|null;groupKind:"group"|"product";matchKind?:"sku"|"group";documents:BasicDocumentHit[]};
type Dependencies={
  catalog:(sku:string)=>Promise<CatalogSkuMatch[]>;
  documents:typeof findBestDocumentsByTitle;
  exactDocuments?:typeof findDocumentsByExactSku;
};
export async function lookupDocumentsForSku(sku:string,type:"passport"|"certificate",stopwords:Set<string>,
  dependencies:Dependencies={catalog:findCatalogSku,documents:findBestDocumentsByTitle,exactDocuments:findDocumentsByExactSku}):Promise<SkuDocumentResult> {
  const matches=await dependencies.catalog(sku);
  const namedGroups=matches.map(match=>match.groupName?.trim()).filter((value):value is string=>!!value);
  const names=namedGroups.length ? namedGroups : matches.map(match=>match.productName?.trim()).filter((value):value is string=>!!value);
  const unique=new Map(names.map(name=>[normalized(name),name]));
  const groups=Array.from(unique.values());
  const exact=dependencies.exactDocuments
    ? await trackIntentStage("retrieval","Поиск PDF по точному артикулу в названии",()=>dependencies.exactDocuments!(sku,type))
    : [];
  if(exact.length)return {status:"resolved",sku,group:groups.length===1?groups[0]:null,
    groupKind:namedGroups.length?"group":"product",matchKind:"sku",documents:exact.slice(0,3)};
  if(!groups.length) return {status:"unknown",sku};
  if(groups.length>1) return {status:"ambiguous",sku,groups};
  const group=groups[0];
  const candidates=await trackIntentStage("retrieval","Поиск PDF по товарной группе",()=>dependencies.documents(group,type,stopwords,30));
  return {status:"resolved",sku,group,groupKind:namedGroups.length?"group":"product",matchKind:"group",
    documents:candidates.filter(doc=>documentMatchesGroup(group,doc,stopwords)).slice(0,3)};
}
