import { expect, it, vi } from "vitest";
vi.mock("./db",()=>({getDb:vi.fn()}));
import { getDb } from "./db";
import { findCatalogSku, catalogNameFromContent, buildCatalogHierarchy } from "./catalogSkuLookup";
it("resolves manual catalog SKUs only from article cells, preserving their assigned group",async()=>{
  const where=vi.fn().mockResolvedValueOnce([{groupName:"Группа из products",productName:"Товар"}])
    .mockResolvedValueOnce([
      {metadata:{productGroupName:"Группа из ручной разметки",productVariantName:"Вариант"},rows:[{Артикул:5905}]},
      {metadata:{productGroupName:"Чужая группа"},rows:[{Артикул:59050},{Артикул:15905},{Длина:5905}]},
    ]);
  const chain:any={from:vi.fn(()=>chain),innerJoin:vi.fn(()=>chain),leftJoin:vi.fn(()=>chain),where};
  vi.mocked(getDb).mockResolvedValue({select:vi.fn(()=>chain)} as any);
  expect(await findCatalogSku("5905")).toEqual([
    {groupName:"Группа из products",productName:"Товар"},
    {groupName:"Группа из ручной разметки",productName:"Вариант"},
  ]);
});
it("does not mask database unavailability as a missing article",async()=>{
  vi.mocked(getDb).mockResolvedValue(null);
  await expect(findCatalogSku("5905")).rejects.toThrow("Database not available");
});
it("resolves automatically indexed catalog tables whose product name is only in the section heading",async()=>{
  const group="Краны для подключения термодатчика, ВР-ВР";
  const where=vi.fn().mockResolvedValueOnce([{groupName:null,productName:null,sectionTitle:group}])
    .mockResolvedValueOnce([{rows:[{Артикул:5905,DN:15,Назначение:"Для термодатчика"}],metadata:{section:group},content:`1.1.7. ${group} Товар: ${group} Артикул: 5905 | Артикул | DN |`}]);
  const chain:any={from:vi.fn(()=>chain),innerJoin:vi.fn(()=>chain),leftJoin:vi.fn(()=>chain),where};
  vi.mocked(getDb).mockResolvedValue({select:vi.fn(()=>chain)} as any);
  expect(await findCatalogSku("5905")).toEqual([{groupName:group,productName:null},{groupName:group,productName:null}]);
  expect(catalogNameFromContent(`1.1.7. ${group} Товар: ${group} Артикул: 5905 | Артикул | DN |`)).toBe(group);
});
it("walks actual parent sections and includes the catalog product line",()=>{
  const hierarchy=buildCatalogHierarchy("1.2.1.1",[
    {sectionPath:"1.2.1.1",title:"Заглушки",parentPath:"1.2"},
    {sectionPath:"1.2",title:"Фитинги PPSU Lite",parentPath:"1"},
    {sectionPath:"1",title:"Номенклатура"},
    {sectionPath:"1.20",title:"Другая категория"},
  ],"Фитинги_lite.md");
  expect(hierarchy).toEqual(["Заглушки","Фитинги PPSU Lite","Фитинги lite"]);
});
it("enriches an exact SKU row with its catalog id and complete hierarchy without reindexing",async()=>{
  const where=vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
    {catalogId:10,catalogFilename:"Фитинги_lite.md",sectionPath:"1.2.1.1",sectionTitle:"Заглушки",rows:[{Артикул:44293}],metadata:{}},
  ]).mockResolvedValueOnce([
    {documentId:10,sectionPath:"1.2.1.1",title:"Заглушки",parentPath:"1.2"},
    {documentId:10,sectionPath:"1.2",title:"Фитинги PPSU Lite",parentPath:null},
  ]);
  const chain:any={from:vi.fn(()=>chain),innerJoin:vi.fn(()=>chain),leftJoin:vi.fn(()=>chain),where};
  vi.mocked(getDb).mockResolvedValue({select:vi.fn(()=>chain)} as any);
  expect(await findCatalogSku("44293")).toEqual([{groupName:"Заглушки",productName:null,catalogId:10,hierarchy:["Заглушки","Фитинги PPSU Lite","Фитинги lite"]}]);
});
