import { expect, it, vi } from "vitest";
vi.mock("./db",()=>({getDb:vi.fn()}));
import { getDb } from "./db";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { assortmentFamily, selectAssortment, catalogAssortmentResponse } from "./catalogAssortment";
const fixtures=(names:string[])=>names.map((name,documentId)=>({name,documentId,filename:"catalog.md"}));
it("lists all valve products for the broad question, preserving distinct models",()=>{
  const names=["Клапан обратный SANEXT","Клапан редукционный PRV-L","Клапан балансировочный DPV","Клапан запорный LV2"];
  expect(selectAssortment(fixtures(names),assortmentFamily("какие есть клапана")!,"какие есть клапана").map(item=>item.name)).toHaveLength(4);
});
it("retains the reducing qualifier instead of returning every valve",()=>{
  const entries=fixtures(["Клапан редукционный поршневой PRV-L","Клапан редукционный мембранный DPRV-L","Клапан обратный","Клапан балансировочный"]);
  expect(selectAssortment(entries,assortmentFamily("какие есть редукционные клапаны")!,"какие есть редукционные клапаны").map(item=>item.name)).toEqual(["Клапан редукционный мембранный DPRV-L","Клапан редукционный поршневой PRV-L"]);
});
it("recognizes pressure reducers as an assortment question",()=>{
  const query="какие есть редукторы давления";
  expect(selectAssortment(fixtures(["Редуктор давления поршневой","Клапан редукционный PRV-L","Клапан обратный"]),assortmentFamily(query)!,query)).toHaveLength(2);
});
it("rejects pipe accessories and mere mentions",()=>{
  const query="какие трубы есть у Sanext";
  expect(selectAssortment(fixtures(["Труба SANEXT Теплый пол","Труба SANEXT Универсальная","Комплектующие для трубопроводной арматуры","Фитинги для подключения трубок","Клапан для труб","Шаровый кран для импульсной трубки","Исполнение с резьбовыми патрубками"]),assortmentFamily(query)!,query).map(item=>item.name)).toEqual(["Труба SANEXT Теплый пол","Труба SANEXT Универсальная"]);
});
it("deduplicates reordered product names across catalogs without merging models",()=>{
  const query="какие есть клапаны";
  expect(selectAssortment(fixtures(["Клапан редукционный мембранный SANEXT DPRV-L","Мембранный редукционный клапан DPRV-L","Клапан редукционный PRV-L"]),assortmentFamily(query)!,query)).toHaveLength(2);
});
it("uses product records and SKU tables, never arbitrary headings, and stays in catalogs",async()=>{
  const results=[
    [{documentId:1,filename:"catalog.md",name:"Клапан редукционный PRV-L"}],
    [],
    [{documentId:2,filename:"manual.md",rows:[{Артикул:"5905"}],sectionName:"Клапан обратный",chunkIndex:7},
     {documentId:3,filename:"technical.md",rows:[{Значение:10}],sectionName:"Клапан посторонний"}],
  ];
  const queries:any[]=[];
  vi.mocked(getDb).mockResolvedValue({select:()=>{
    const chain:any={from:vi.fn(()=>chain),innerJoin:vi.fn(()=>chain),leftJoin:vi.fn(()=>chain),where:vi.fn().mockResolvedValue(results[queries.length])};
    queries.push(chain);return chain;
  }} as any);
  const response=await catalogAssortmentResponse("какие есть клапаны");
  expect(response?.response).toContain("Клапан обратный");expect(response?.response).toContain("PRV-L");
  expect(response?.response).not.toContain("посторонний");
  for(const query of queries) {
    const sql=new MySqlDialect().sqlToQuery(query.where.mock.calls[0][0]);
    expect(sql.params).toContain("catalog");expect(sql.params).toContain("indexed");
  }
  expect(response?.sources.find(source=>source.documentId===2)?.chunkIndex).toBe(7);
});
it("does not broaden an empty assortment lookup to other knowledge bases",async()=>{
  vi.mocked(getDb).mockResolvedValue({select:()=>{
    const chain:any={from:()=>chain,innerJoin:()=>chain,leftJoin:()=>chain,where:async()=>[]};return chain;
  }} as any);
  const response=await catalogAssortmentResponse("какие есть редукционные клапаны");
  expect(response?.needsClarification).toBe(true);expect(response?.sources).toEqual([]);
});
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
