import { beforeEach,expect,it,vi } from "vitest";
vi.mock("./db",()=>({getDb:vi.fn()}));
vi.mock("./documentApplicabilityStore",()=>({listDocumentApplicability:vi.fn()}));
import { applicabilityScore,findApplicableDocuments } from "./documentApplicability";
import { getDb } from "./db";
import { listDocumentApplicability } from "./documentApplicabilityStore";
import { emptyApplicability } from "../shared/documentApplicability";
const match={catalogId:10,groupName:"Заглушки",productName:null,hierarchy:["Заглушки","Фитинги PPSU Lite"]};
beforeEach(()=>vi.clearAllMocks());
it("supports exact SKU links without requiring a catalog record",()=>{
  expect(applicabilityScore({...emptyApplicability(1),skus:["44293"]},"44293",[])).toBe(3);
  expect(applicabilityScore({...emptyApplicability(1),skus:["44293"]},"442930",[])).toBe(0);
});
it("supports a whole catalog family and keeps its scope away from other catalogs",()=>{
  const binding={...emptyApplicability(1),catalogIds:[10]};
  expect(applicabilityScore(binding,"44293",[match])).toBe(1);
  expect(applicabilityScore(binding,"44293",[{...match,catalogId:20}])).toBe(0);
  expect(applicabilityScore(emptyApplicability(1),"44293",[match])).toBe(0);
});
it("matches category and product line together when both constraints are configured",()=>{
  const binding={...emptyApplicability(1),categories:["ЗАГЛУШКИ"],productLines:["Фитинги PPSU Lite"]};
  expect(applicabilityScore(binding,"44293",[match])).toBe(2);
  expect(applicabilityScore(binding,"44293",[{...match,hierarchy:["Заглушки","Фитинги PPSU"]}])).toBe(0);
  expect(applicabilityScore(binding,"44293",[{...match,groupName:"Муфты",hierarchy:["Муфты","Фитинги PPSU Lite"]}])).toBe(0);
});
it("returns only existing indexed documents of the requested type, preserving link specificity",async()=>{
  vi.mocked(listDocumentApplicability).mockResolvedValue([
    {...emptyApplicability(2),catalogIds:[10]}, {...emptyApplicability(1),skus:["44293"]},
  ]);
  const where=vi.fn().mockResolvedValue([{id:2},{id:1}]);
  const chain:any={from:vi.fn(()=>chain),where};
  vi.mocked(getDb).mockResolvedValue({select:vi.fn(()=>chain)} as any);
  expect(await findApplicableDocuments("44293","certificate",[match])).toEqual([{id:1},{id:2}]);
  expect(where).toHaveBeenCalledTimes(1);
});
