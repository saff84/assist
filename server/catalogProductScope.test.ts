import { expect, it } from "vitest";
import { matchModelScope } from "./catalogProductScope";
import { modelCodes, chunkInProductScope, hasSiblingModel } from "../shared/productScope";
import { retrievalScopeWhere, scopedProductBundle } from "./rag/sourceScope";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const headings=[
  {name:"Автоматический балансировочный клапан DPV",documentId:1,sectionPath:"1.1"},
  {name:"Комбинированный клапан DPV-C",documentId:2,sectionPath:"1.2"},
  {name:"Автоматический клапан DPV Н",documentId:3,sectionPath:"1.3"},
  {name:"Принадлежности для DPV",documentId:1,sectionPath:"1.4"},
  {name:"Характеристики DPV",documentId:1,sectionPath:"1.1.4"},
];
it.each([["dpv","DPV",1],["DPV-C","DPV-C",2],["DPV Н","DPV-H",3],["DPV-H","DPV-H",3]])("resolves exact model %s without prefix substitution",(query,model,documentId)=>{
  const result=matchModelScope(`характеристики ${query}`,headings);
  expect(result.scope).toMatchObject({model,sections:[{documentId}]});
});
it("does not substitute a sibling when the exact model is absent",()=>{
  const result=matchModelScope("характеристики DPV",headings.filter(row=>row.documentId!==1));
  expect(result.scope).toBeUndefined();expect(result.clarification).toContain("Уточните модель");
});
it("also pins a named product line without a Latin model code",()=>{
  const result=matchModelScope("характеристики стабила\nТовар из каталога: Труба SANEXT «Стабил»",[
    {name:"Труба SANEXT «Стабил»",documentId:5,sectionPath:"1.3"},
    {name:"Труба SANEXT «Универсальная»",documentId:5,sectionPath:"1.1"},
  ]);
  expect(result.scope).toMatchObject({name:"Труба SANEXT «Стабил»",sections:[{documentId:5,sectionPath:"1.3"}]});
});
it("does not interpret manufacturer, materials or diameters as models",()=>{
  expect(modelCodes("SANEXT DPV DN15 PN25")).toEqual(["DPV"]);
  expect(modelCodes("фитинги SANEXT Lite PPSU")).toEqual([]);
});
it("restricts the section and its children without admitting another model or prefix collision",()=>{
  const scope=matchModelScope("DPV",headings).scope!;
  expect(chunkInProductScope({documentId:1,sectionPath:"1.1.4"},scope)).toBe(true);
  expect(chunkInProductScope({documentId:1,sectionPath:"1.10"},scope)).toBe(false);
  expect(chunkInProductScope({documentId:2,sectionPath:"1.1.4"},scope)).toBe(false);
  const sql=new MySqlDialect().sqlToQuery(retrievalScopeWhere({allowedDocumentTypes:["catalog"],productScope:scope})!);
  expect(sql.params).toContain("catalog");expect(sql.params).toContain("indexed");expect(sql.params).toContain("1.1.");expect(sql.sql).toContain("sectionPath");
});
it("detects substitutions by sibling models without banning compatible partner products",()=>{
  expect(hasSiblingModel("Характеристики DPV-C: 22 кПа","DPV")).toBe(true);
  expect(hasSiblingModel("DPV: 25 бар. Клапан-партнер STP.","DPV")).toBe(false);
});
it("bundles every row of the selected characteristics table and prioritizes it over nomenclature",()=>{
  const base={documentId:1,boostsApplied:[],relevance:0.1,metadata:{},heading:null};
  const chunks=[{...base,id:1,chunkIndex:1,sectionPath:"1.1.1",content:"Номенклатура DPV"},
    {...base,id:2,chunkIndex:10,sectionPath:"1.1.4",heading:"Характеристики DPV",content:"Рабочее давление: 25 бар",metadata:{tableJson:[{Параметр:"Рабочее давление",Значение:"25 бар"}]}},
    {...base,id:3,chunkIndex:11,sectionPath:"1.1.4",heading:"Характеристики DPV",content:"Температура: -10...120 °C",metadata:{tableJson:[{Параметр:"Температура",Значение:"-10...120 °C"}]}}];
  const bundle=scopedProductBundle(chunks as any,"характеристики DPV",0.4);
  expect(bundle).toHaveLength(2);expect(bundle[0].sectionPath).toBe("1.1.4");
  expect(bundle[0].content).toContain("25 бар");expect(bundle[0].content).toContain("120 °C");
  expect(bundle[0].metadata?.tableJson).toHaveLength(2);
});
