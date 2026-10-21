import { expect, it, vi } from "vitest";
vi.mock("./db",()=>({getDb:vi.fn()}));
import { getDb } from "./db";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { assortmentFamily, selectAssortment, catalogAssortmentResponse } from "./catalogAssortment";
const fixtures=(names:string[])=>names.map((name,documentId)=>({name,documentId,filename:"catalog.md"}));
it.each(["какие трубы есть","расскажи какие трубы есть","расскажите пожалуйста какие трубы есть","подскажи мне какие трубы есть"])("keeps the same assortment for conversational wording: %s",query=>{
  const entries=fixtures(["Труба SANEXT «Стабил»","Труба SANEXT «Тёплый пол»"]);
  expect(selectAssortment(entries,assortmentFamily(query)!,query)).toHaveLength(2);
});
it("returns the five pipe headings from the supplied SANEXT catalog instead of SKU sizes or tools",async()=>{
  const names=["Труба SANEXT «Универсальная»","Труба SANEXT PE-Xa без кислородного барьера","Труба SANEXT «Стабил»","Труба SANEXT «Тёплый пол»","Труба SANEXT «Гофрированная»"];
  const base={documentId:1,filename:"Трубы SANEXT.md"};
  const results=[[],[
    {...base,name:"Расширительная насадка для труб SANEXT «Стабил»"},
    {...base,name:"Труба SANEXT «Универсальная» 16×2,2"},
    {...base,name:"Труба SANEXT «Стабил» 20×2,9"},
    {...base,name:"Труба SANEXT PE-Xa"},
  ],[],[{...base,name:"Трубы SANEXT"}],[],names.map((name,index)=>({...base,name,sectionPath:`1.${index+1}`}))];let index=0;
  vi.mocked(getDb).mockResolvedValue({select:()=>{
    const rows=results[index++]??[];const chain:any={from:()=>chain,innerJoin:()=>chain,leftJoin:()=>chain,where:async()=>rows};return chain;
  }} as any);
  const response=await catalogAssortmentResponse("какая труба есть");
  for(const name of names)expect(response?.response).toContain(`- ${name}\n`);
  expect(response?.response.match(/^- /gm)).toHaveLength(5);
  expect(response?.response).not.toContain("насадка");expect(response?.response).not.toContain("16×2,2");
  expect(response?.response).toContain("О каком виде рассказать подробнее");
  expect(response?.sources).toHaveLength(5);
});
it("collapses pipe sizes and excludes tools even without indexed line headings",()=>{
  const entries=fixtures(["Труба SANEXT «Стабил» 16,2×2,6","Труба SANEXT «Стабил» 20×2,9","Расширительная насадка для труб SANEXT «Стабил»"]);
  expect(selectAssortment(entries,assortmentFamily("какие трубы есть")!,"какие трубы есть").map(entry=>entry.name)).toEqual(["Труба SANEXT «Стабил»"]);
});
it("expands pipe groups inside a single generic pipe catalog",async()=>{
  const results=[[],[],[],[{documentId:1,filename:"Трубы SANEXT.md",name:"Трубы SANEXT"}],[
    {documentId:1,filename:"Трубы SANEXT.md",name:"Труба SANEXT Теплый пол",sectionPath:"1.1"},
    {documentId:1,filename:"Трубы SANEXT.md",name:"Труба SANEXT Универсальная",sectionPath:"1.2"},
    {documentId:1,filename:"Трубы SANEXT.md",name:"Труба SANEXT Стабило",sectionPath:"1.3"},
  ]];let index=0;
  vi.mocked(getDb).mockResolvedValue({select:()=>{
    const rows=results[index++]??[];const chain:any={from:()=>chain,innerJoin:()=>chain,leftJoin:()=>chain,where:async()=>rows};return chain;
  }} as any);
  const response=await catalogAssortmentResponse("какие трубы есть");
  expect(response?.response).toContain("Теплый пол");expect(response?.response).toContain("Универсальная");expect(response?.response).toContain("Стабило");
  expect(response?.response).not.toContain("- Трубы SANEXT\n");
  expect(response?.response).toContain("О каком виде рассказать подробнее");expect(response?.sources).toHaveLength(3);
});
it("prefers pipe groups over dimensional variants without losing a duplicated group",()=>{
  const entries=[...fixtures(["Труба Теплый пол","Труба Универсальная 16x2,2"]),
    ...fixtures(["Труба Теплый пол","Труба Универсальная"]).map(entry=>({...entry,kind:"group" as const})),
    {documentId:5,filename:"pipes.md",name:"Трубы SANEXT",kind:"catalog" as const}];
  expect(selectAssortment(entries,assortmentFamily("какие трубы есть")!,"какие трубы есть").map(entry=>entry.name)).toEqual(["Труба Теплый пол","Труба Универсальная"]);
});
it("tolerates a typo in reducing qualifiers without broadening to other valves",()=>{
  const entries=fixtures(["Клапан редукционный мембранный DPRV-L","Клапан редукционный поршневой PRV-L","Клапан балансировочный"]);
  const query="какие есть редукционныые клапаны";
  expect(selectAssortment(entries,assortmentFamily(query)!,query).map(entry=>entry.name)).toHaveLength(2);
});
it("keeps model codes exact when allowing qualifier typos",()=>{
  const query="какие есть редукционные клапаны PRV-L";
  expect(selectAssortment(fixtures(["Клапан редукционный PRV-L","Клапан редукционный PRV-N"]),assortmentFamily(query)!,query).map(entry=>entry.name)).toEqual(["Клапан редукционный PRV-L"]);
});
it("lists all separately indexed pipe types before SKU variants and asks which to describe",async()=>{
  const results=[[],[],[],[
    {documentId:1,filename:"труба_теплый_пол.md",name:"Труба SANEXT Теплый пол"},
    {documentId:2,filename:"труба_универсальная.md",name:"Труба SANEXT Универсальная"},
    {documentId:3,filename:"краны.md",name:"Кран для трубы"},
  ]];let index=0;
  vi.mocked(getDb).mockResolvedValue({select:()=>{
    const rows=results[index++]??[];const chain:any={from:()=>chain,innerJoin:()=>chain,leftJoin:()=>chain,where:async()=>rows};return chain;
  }} as any);
  const response=await catalogAssortmentResponse("какая есть труба");
  expect(response?.response).toContain("Труба SANEXT Теплый пол");expect(response?.response).toContain("Труба SANEXT Универсальная");
  expect(response?.response).not.toContain("Кран");expect(response?.response).toContain("О каком виде рассказать подробнее");
  expect(response?.sources).toHaveLength(2);
});
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
    [],
  ];
  const queries:any[]=[];
  vi.mocked(getDb).mockResolvedValue({select:()=>{
    const chain:any={from:vi.fn(()=>chain),innerJoin:vi.fn(()=>chain),leftJoin:vi.fn(()=>chain),where:vi.fn().mockResolvedValue(results[queries.length]??[])};
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
it.each(["какая есть труба","какой есть фитинг","какое есть оборудование — фитинги"])("recognizes singular assortment questions: %s",query=>expect(assortmentFamily(query)).not.toBeNull());
it("answers the singular pipe question with actual pipe lines",()=>{
  const query="какая есть труба";
  expect(selectAssortment(fixtures(["Труба SANEXT Теплый пол","Труба SANEXT Универсальная","Кран для трубы"]),assortmentFamily(query)!,query)).toHaveLength(2);
});
it("lists both indexed fitting lines instead of accessories mentioning fittings",()=>{
  const entries=[
    {documentId:1,filename:"фитинги_lite.md",name:"фитинги_lite",kind:"catalog" as const},
    {documentId:2,filename:"аксиальные_фитинги.md",name:"аксиальные_фитинги",kind:"catalog" as const},
    ...fixtures(["Кольцо компрессионное для фитинга","Фитинг подключения медной трубки","Ключ для аксиальных фитингов"]),
  ];
  expect(selectAssortment(entries,assortmentFamily("какие есть фитинги")!,"какие есть фитинги").map(entry=>entry.name)).toEqual(["аксиальные фитинги","фитинги lite"]);
  expect(selectAssortment(entries,assortmentFamily("какие есть аксиальные фитинги")!,"какие есть аксиальные фитинги").map(entry=>entry.name)).toEqual(["аксиальные фитинги"]);
});
it("loads fitting line names from indexed catalogs even if SKU names omit the word fitting",async()=>{
  const results=[[],[{documentId:1,filename:"фитинги_lite.md",name:"Муфта"}],[],[
    {documentId:1,filename:"фитинги_lite.md",name:null},
    {documentId:2,filename:"аксиальные_фитинги.md",name:"Аксиальные фитинги"},
  ]];let index=0;
  vi.mocked(getDb).mockResolvedValue({select:()=>{
    const rows=results[index++]??[];const chain:any={from:()=>chain,innerJoin:()=>chain,leftJoin:()=>chain,where:async()=>rows};return chain;
  }} as any);
  const response=await catalogAssortmentResponse("какие есть фитинги");
  expect(response?.response).toContain("фитинги lite");expect(response?.response).toContain("Аксиальные фитинги");
  expect(response?.sources.map(source=>source.documentId).sort()).toEqual([1,2]);
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
