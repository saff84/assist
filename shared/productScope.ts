export type ProductScope={name:string;model?:string;sections:Array<{documentId:number;sectionPath:string}>};
const normalize=(value:string)=>value.toUpperCase().replace(/[‐‑–—]/g,"-").replace(/\s+/g," ").trim();
export function modelCodes(value:string):string[] {
  const found=normalize(value).match(/(?:^|[^A-ZА-Я0-9])([A-Z][A-Z0-9]{1,}(?:-[A-ZА-Я0-9]+)*(?:\s+[HН](?=$|[^A-ZА-Я0-9]))?)(?=$|[^A-ZА-Я0-9])/g)??[];
  return Array.from(new Set(found.map(code=>code.replace(/^[^A-Z]+/,"").trim().replace(/\s+[НH]$/,"-H").replace(/-Н$/,"-H").replace(/-С$/,"-C"))
    .filter(code=>! /^(?:SANEXT|LITE|DN\d*|PN\d*|PDF|MD|PE|PEX|PE-XA|PE-RT|EVOH|PPSU|KVS|KV|PA6|EPDM|HNBR|DZR)$/.test(code))));
}
export function chunkInProductScope(chunk:{documentId:number;sectionPath?:string|null},scope:ProductScope):boolean {
  return scope.sections.some(section=>section.documentId===chunk.documentId&&!!chunk.sectionPath&&
    (chunk.sectionPath===section.sectionPath||chunk.sectionPath.startsWith(section.sectionPath+".")));
}
export function hasSiblingModel(answer:string,model:string):boolean {
  const family=model.split("-")[0];
  return modelCodes(answer).some(code=>code!==model&&code.split("-")[0]===family);
}
