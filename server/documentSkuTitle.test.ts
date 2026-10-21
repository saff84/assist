import { expect,it } from "vitest";
import { exactDocumentSkuPattern } from "./rag/documentDiscovery";
it("matches exact article numbers inside filenames and enumerated product lists",()=>{
  const pattern=new RegExp(exactDocumentSkuPattern("5905"));
  expect(pattern.test("Кран DN15 (5905, 5906, 5907).pdf")).toBe(true);
  expect(pattern.test("Кран_5905_сертификат.pdf")).toBe(true);
  expect(pattern.test("Кран 15905.pdf")).toBe(false);
  expect(pattern.test("Кран 59050.pdf")).toBe(false);
  expect(pattern.test("Модель A5905.pdf")).toBe(false);
  expect(()=>exactDocumentSkuPattern("5905.*")).toThrow();
});
