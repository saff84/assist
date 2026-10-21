import { expect, it } from "vitest";
import { productSourcePolicy } from "../shared/productSourcePolicy";
import { queryRoutingSchema, defaultQueryRouting } from "../shared/queryRouting";
it("upgrades old routing settings in memory without replacing rules",()=>{
  const config=queryRoutingSchema.parse(defaultQueryRouting);
  expect(productSourcePolicy("характеристики DPV",["catalog","installation"],config)?.targets).toEqual(["catalog"]);
  expect(config.rules).toEqual(defaultQueryRouting.rules);
});
it.each(["монтаж DPV","температура эксплуатации DPV","совместимость DPV","сравни характеристики каталога и паспорта DPV"])("preserves other source scopes: %s",query=>{
  expect(productSourcePolicy(query,["catalog","installation"],{})).toBeNull();
});
it("allows administrators to explicitly disable source restriction",()=>{
  expect(productSourcePolicy("характеристики DPV",["catalog","installation"],{productAnswersFromCatalogOnly:false})).toBeNull();
});
