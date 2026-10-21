import { expect,it } from "vitest";
import { isProductOnlyQuery, productTaskQuestion, clarifySearchFailure, isTaskSelection, productTaskTargets } from "./productQuestion";
it.each(["труба для теплого пола","поршневой редуктор","аксиальные фитинги"])("asks for the task when only a product is named: %s",query=>{
  expect(isProductOnlyQuery(query)).toBe(true);
  const reply=productTaskQuestion(query);
  expect(reply).toContain(query);expect(reply).toContain("характеристики");expect(reply).not.toContain("нет информации");
});
it.each(["расскажи о поршневом редукторе","что такое аксиальные фитинги","что это за поршневой редуктор","назначение поршневого редуктора","характеристики трубы для теплого пола","монтаж трубы теплый пол","сертификат на 44293"])("does not interrupt an explicit request: %s",query=>{
  expect(isProductOnlyQuery(query)).toBe(false);
});
it("recognizes short task answers without confusing them with a new named product",()=>{
  expect(isTaskSelection("характеристики")).toBe(true);expect(isTaskSelection("мне нужны технические характеристики")).toBe(true);
  expect(isTaskSelection("общее описание")).toBe(true);expect(isTaskSelection("монтаж поршневого редуктора")).toBe(false);
  expect(productTaskTargets("монтаж")).toEqual(["installation"]);
  expect(productTaskTargets("подбор")).toEqual(["catalog","installation"]);
});
it("explains missing search results without claiming the product is absent or suggesting arbitrary files",()=>{
  const reply=clarifySearchFailure("аксиальные фитинги");
  expect(reply).toContain("не означает, что изделия нет в базе");expect(reply).not.toContain(".md");expect(reply).not.toContain("STP");
});
