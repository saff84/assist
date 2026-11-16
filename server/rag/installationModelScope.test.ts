import { expect, it } from "vitest";
import { scopeInstallationModel } from "./installationModelScope";

const manual = (documentId: number, title: string, content = "Монтаж DPV") => ({
  documentId, title, content, docType: "installation", filename: `passport-${documentId}.md`,
});

it("selects DPV's own passport instead of RKU passports mentioning DPV", () => {
  const own = manual(1, "Паспорт клапана SANEXT DPV");
  const section = { ...own, content: "Подключение импульсной трубки" };
  const chunks = [manual(237, "Паспорт РКУ SANEXT квартирный"),
    manual(230, "Паспорт РКУ SANEXT ЭТАЖНЫЙ-DSI SF"), own, section,
    manual(2, "Паспорт DPV-C"), manual(3, "Паспорт DPV Н")];
  expect(scopeInstallationModel("монтаж DPV", chunks)).toEqual([own, section]);
});

it("keeps general installation sources if no dedicated model manual is indexed", () => {
  const chunks = [manual(237, "Паспорт РКУ квартирный"), manual(2, "DPV-C")];
  expect(scopeInstallationModel("монтаж DPV", chunks)).toBe(chunks);
});

it("preserves requests comparing models and generic mounting questions", () => {
  const chunks = [manual(1, "DPV"), manual(2, "DPV-C")];
  expect(scopeInstallationModel("сравни монтаж DPV и DPV-C", chunks)).toBe(chunks);
  expect(scopeInstallationModel("монтаж узла", chunks)).toBe(chunks);
});
