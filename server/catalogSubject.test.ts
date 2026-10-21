import { expect, it } from "vitest";
import { matchCatalogSubject } from "./catalogSubject";
it("matches an inflected line name against actual catalog headings",()=>{
  expect(matchCatalogSubject("характеристики стабила",["Труба SANEXT «Стабил»","Труба SANEXT «Универсальная»","Расширительная насадка для труб Стабил"])).toBe("Труба SANEXT «Стабил»");
});
it("does not guess when several product lines match",()=>{
  expect(matchCatalogSubject("характеристики lite",["Фитинги Lite PPSU","Фитинги Lite латунные"])).toBeNull();
});
it("does not infer a product from a bare task or an absent line",()=>{
  expect(matchCatalogSubject("характеристики",["Труба SANEXT «Стабил»"])).toBeNull();
  expect(matchCatalogSubject("характеристики неизвестного",["Труба SANEXT «Стабил»"])).toBeNull();
});
