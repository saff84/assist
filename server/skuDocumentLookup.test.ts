import { expect, it, vi } from "vitest";
import { exactSkuRow } from "./catalogSkuLookup";
import { documentMatchesGroup, extractDocumentSkus, lookupDocumentsForSku } from "./skuDocumentLookup";
import type { BasicDocumentHit } from "./rag/documentDiscovery";
const document = (title:string,id=1):BasicDocumentHit=>({id,title,filename:`file-${id}.pdf`,fileType:"pdf",docType:"certificate",chunksCount:0});
const stopwords=new Set<string>();
it("recognizes document requests with exact numeric article boundaries",()=>{
  expect(extractDocumentSkus("мне нужен сертификат на 5905")).toEqual(["5905"]);
  expect(extractDocumentSkus("**мне нужен паспорт на 5905**")).toEqual(["5905"]);
  expect(extractDocumentSkus("5905, 5905 и 5906")).toEqual(["5905","5906"]);
  expect(extractDocumentSkus("модель A5905 и 159050000")).toEqual([]);
  expect(exactSkuRow({Артикул:"59050"},"5905")).toBe(false);
  expect(exactSkuRow({Артикул:"15905"},"5905")).toBe(false);
  expect(exactSkuRow({Артикул:5905},"5905")).toBe(true);
  expect(exactSkuRow({Длина:5905},"5905")).toBe(false);
});
it.each(["certificate","passport"] as const)("finds %s by catalog group, not the raw question",async type=>{
  const dependencies={catalog:vi.fn().mockResolvedValue([{groupName:"Балансировочные клапаны",productName:"Клапан 5905"}]),
    documents:vi.fn().mockResolvedValue([document("Сертификат SANEXT балансировочные клапаны"),document("SANEXT трубы",2)])};
  const result=await lookupDocumentsForSku("5905",type,stopwords,dependencies);
  expect(dependencies.catalog).toHaveBeenCalledWith("5905");
  expect(dependencies.documents).toHaveBeenCalledWith("Балансировочные клапаны",type,stopwords,30);
  expect(result).toMatchObject({status:"resolved",sku:"5905",group:"Балансировочные клапаны",groupKind:"group",documents:[{id:1}]});
});
it("does not search unrelated documents when the SKU or its name is unknown",async()=>{
  const dependencies={catalog:vi.fn().mockResolvedValue([]),documents:vi.fn()};
  expect(await lookupDocumentsForSku("5905","passport",stopwords,dependencies)).toEqual({status:"unknown",sku:"5905"});
  expect(dependencies.documents).not.toHaveBeenCalled();
});
it("deduplicates group names across catalogs and requires clarification for distinct groups",async()=>{
  const dependencies={catalog:vi.fn().mockResolvedValue([{groupName:"Трубы SANEXT",productName:null},{groupName:"трубы sanext",productName:null}]),documents:vi.fn().mockResolvedValue([])};
  expect((await lookupDocumentsForSku("5905","passport",stopwords,dependencies)).status).toBe("resolved");
  dependencies.catalog.mockResolvedValue([{groupName:"Трубы",productName:null},{groupName:"Клапаны",productName:null}]);
  dependencies.documents.mockClear();
  expect(await lookupDocumentsForSku("5905","passport",stopwords,dependencies)).toMatchObject({status:"ambiguous",groups:["Трубы","Клапаны"]});
  expect(dependencies.documents).not.toHaveBeenCalled();
});
it("uses product name transparently when there is no assigned group",async()=>{
  const dependencies={catalog:vi.fn().mockResolvedValue([{groupName:null,productName:"Труба Теплый пол"}]),documents:vi.fn().mockResolvedValue([])};
  expect(await lookupDocumentsForSku("5905","passport",stopwords,dependencies)).toMatchObject({status:"resolved",group:"Труба Теплый пол",groupKind:"product",documents:[]});
});
it("rejects brand-only and generic valve matches; accepts Russian inflections",()=>{
  expect(documentMatchesGroup("Балансировочные клапаны SANEXT",document("Сертификат SANEXT трубы"),stopwords)).toBe(false);
  expect(documentMatchesGroup("Балансировочные клапаны SANEXT",document("Клапаны радиаторные"),stopwords)).toBe(false);
  expect(documentMatchesGroup("Балансировочные клапаны SANEXT",document("Паспорт балансировочного клапана SANEXT"),stopwords)).toBe(true);
  expect(documentMatchesGroup("SANEXT",document("SANEXT"),stopwords)).toBe(false);
});
