import { expect, it, vi } from "vitest";
vi.mock("./db",()=>({getDb:vi.fn()}));
import { getDb } from "./db";
import { findCatalogSku } from "./catalogSkuLookup";
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
