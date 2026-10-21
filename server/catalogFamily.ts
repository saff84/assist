import type { BasicDocumentHit } from "./rag/documentDiscovery";
const ignored=new Set(["sanext","pdf","catalog","catalogue","doc","md","dn","pn"]);
export function catalogFamilyMarkers(labels:string[]):string[] {
  const tokens=labels.join(" ").toLowerCase().match(/[a-z][a-z0-9]*(?:-[a-z0-9]+)*/g)??[];
  return Array.from(new Set(tokens.map(value=>value.replace(/-/g,"")).filter(value=>value.length>=3&&!ignored.has(value)&&!/^(?:dn|pn|v|rev|ver)\d+$/.test(value)))).sort();
}
export function matchesCatalogFamily(labels:string[],document:BasicDocumentHit):boolean {
  const required=catalogFamilyMarkers(labels);
  const present=catalogFamilyMarkers([document.title??"",document.filename.replace(/\.(?:pdf|md)$/i,"")]);
  if(!required.every(value=>present.includes(value)))return false;
  // PPSU and PPSU Lite are different product lines, not interchangeable names.
  if(required.includes("ppsu")&&!required.includes("lite")&&present.includes("lite"))return false;
  return true;
}
