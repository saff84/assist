import { expect, it } from "vitest";
import { assortmentFamily, selectAssortment } from "./catalogAssortment";
it.each([
  ["какие фитинги есть у SANEXT","Фитинги PPSU Lite"],
  ["какие редукторы есть","Редуктор поршневой"],
  ["перечисли виды клапанов","Клапаны балансировочные"],
  ["ассортимент коллекторов","Коллектор распределительный"],
  ["какие счетчики есть","Счётчики воды"],
  ["какие фильтры есть","Фильтры сетчатые"],
  ["список термостатов","Термостаты комнатные"],
  ["какие заглушки есть","Заглушки PPSU"],
  ["виды муфт","Муфты соединительные"],
  ["какие тройники есть","Тройники равнопроходные"],
  ["ассортимент переходников","Переходники резьбовые"],
])("lists indexed groups for %s",(query,name)=>{
  const family=assortmentFamily(query);
  expect(family).not.toBeNull();
  const entries=[name,"Трубы Теплый пол","Инструкция по монтажу"].map((name,documentId)=>({name,documentId,filename:"catalog.md"}));
  expect(selectAssortment(entries,family!).map(entry=>entry.name)).toEqual([name]);
});
it("supports multiple requested families without dropping the second one",()=>{
  const family=assortmentFamily("какие фитинги и редукторы есть у SANEXT")!;
  expect(family.test("Фитинги Lite")).toBe(true);
  expect(family.test("Редуктор поршневой")).toBe(true);
  expect(family.test("Трубы универсальные")).toBe(false);
});
it.each(["какие трубы есть у Sanext","перечисли виды труб","ассортимент фитингов SANEXT"])("recognizes assortment: %s",query=>expect(assortmentFamily(query)).not.toBeNull());
it.each(["какие трубы подходят для теплого пола","какое давление выдерживает труба","сертификат на трубы","монтаж трубы","труба теплый пол"])("preserves other intents: %s",query=>expect(assortmentFamily(query)).toBeNull());
it("lists grounded families, removes duplicates and unrelated technical headings",()=>{
  const entries=["Трубы Теплый пол","1.2. Трубы Теплый пол","Трубы Универсальные","Гидравлические характеристики труб","Монтаж труб","Фитинги Lite"].map((name,index)=>({name,documentId:index,filename:"catalog.md"}));
  expect(selectAssortment(entries,assortmentFamily("какие трубы есть")!).map(entry=>entry.name)).toEqual(["Трубы Теплый пол","Трубы Универсальные"]);
});
