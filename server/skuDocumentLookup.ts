import { findCatalogSku, type CatalogSkuMatch } from "./catalogSkuLookup";
import { findBestDocumentsByTitle, findDocumentsByExactSku, type BasicDocumentHit } from "./rag/documentDiscovery";
import { tokenize } from "./rag/textProcessing";
import { trackIntentStage } from "./intentTrace";
import { findApplicableDocuments } from "./documentApplicability";
import { catalogFamilyMarkers, matchesCatalogFamily } from "./catalogFamily";

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
  | {status:"resolved";sku:string;group:string|null;groupKind:"group"|"product";matchKind?:"binding"|"sku"|"group"|"hierarchy";hierarchy?:string[];matchedCategory?:string;documents:BasicDocumentHit[]};
type Dependencies={
  catalog:(sku:string)=>Promise<CatalogSkuMatch[]>;
  documents:typeof findBestDocumentsByTitle;
  exactDocuments?:typeof findDocumentsByExactSku;
  linkedDocuments?:typeof findApplicableDocuments;
};
export async function lookupDocumentsForSku(sku:string,type:"passport"|"certificate",stopwords:Set<string>,
  dependencies:Dependencies={catalog:findCatalogSku,documents:findBestDocumentsByTitle,exactDocuments:findDocumentsByExactSku,linkedDocuments:findApplicableDocuments}):Promise<SkuDocumentResult> {
  const matches=await dependencies.catalog(sku);
  const namedGroups=matches.map(match=>match.groupName?.trim()).filter((value):value is string=>!!value);
  const names=namedGroups.length ? namedGroups : matches.map(match=>match.productName?.trim()).filter((value):value is string=>!!value);
  const unique=new Map(names.map(name=>[normalized(name),name]));
  const groups=Array.from(unique.values()).filter(group=>!matches.some(match=>{
    if(!match.groupName||normalized(match.groupName)===normalized(group))return false;
    const path=(match.hierarchy??[]).map(normalized);
    const parent=path.indexOf(normalized(group)),child=path.indexOf(normalized(match.groupName));
    return child>=0&&parent>child;
  }));
  const hierarchy=Array.from(new Map(matches.flatMap(match=>match.hierarchy??[]).map(value=>[normalized(value),value])).values());
  if(!groups.length&&!names.length&&hierarchy.length)groups.push(hierarchy[0]);
  const linked=dependencies.linkedDocuments
    ? await trackIntentStage("retrieval","Подтверждённые связи документов с товарами",()=>dependencies.linkedDocuments!(sku,type,matches)):[];
  if(linked.length)return {status:"resolved",sku,group:groups.length===1?groups[0]:null,groupKind:namedGroups.length?"group":"product",matchKind:"binding",hierarchy,documents:linked.slice(0,3)};
  const exact=dependencies.exactDocuments
    ? await trackIntentStage("retrieval","Поиск PDF по точному артикулу в названии",()=>dependencies.exactDocuments!(sku,type))
    : [];
  if(exact.length)return {status:"resolved",sku,group:groups.length===1?groups[0]:null,
    groupKind:namedGroups.length?"group":"product",matchKind:"sku",hierarchy,documents:exact.slice(0,3)};
  if(!groups.length) return {status:"unknown",sku};
  if(groups.length>1) return {status:"ambiguous",sku,groups};
  const group=groups[0];
  const byCatalog=new Map<string,string[]>();
  for(const match of matches) {
    const key=String(match.catalogId??normalized((match.hierarchy??[]).slice(-1)[0]??""));
    byCatalog.set(key,[...(byCatalog.get(key)??[]),...(match.hierarchy??[])]);
  }
  const signatures=Array.from(new Set(Array.from(byCatalog.values()).map(labels=>catalogFamilyMarkers(labels).join("|")).filter(Boolean)));
  if(signatures.length>1)return {status:"ambiguous",sku,groups:Array.from(new Set(matches.map(match=>[...(match.hierarchy??[])].reverse().join(" → ")).filter(Boolean)))};
  const labels=Array.from(new Map([group,...hierarchy].map(value=>[normalized(value),value])).values());
  for(const label of labels) {
    const candidates=await trackIntentStage("retrieval",`Поиск PDF: ${label}`,()=>dependencies.documents(label,type,stopwords,30));
    const documents=candidates.filter(doc=>documentMatchesGroup(label,doc,stopwords)&&matchesCatalogFamily(hierarchy,doc)).slice(0,3);
    if(documents.length)return {status:"resolved",sku,group,groupKind:namedGroups.length?"group":"product",matchKind:label===group?"group":"hierarchy",hierarchy,matchedCategory:label,documents};
  }
  return {status:"resolved",sku,group,groupKind:namedGroups.length?"group":"product",matchKind:"group",hierarchy,documents:[]};
}
