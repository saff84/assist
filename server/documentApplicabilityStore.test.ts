import { beforeEach,expect,it,vi } from "vitest";
const files=vi.hoisted(()=>({readFile:vi.fn(),writeFile:vi.fn(),mkdir:vi.fn(),rename:vi.fn(),rm:vi.fn(),readdir:vi.fn()}));
vi.mock("fs/promises",()=>({default:files}));
import { readDocumentApplicability, saveDocumentApplicability,listDocumentApplicability,applicabilityRoot } from "./documentApplicabilityStore";
import { emptyApplicability } from "../shared/documentApplicability";
beforeEach(()=>vi.resetAllMocks());
it("loads an empty mapping only when none exists",async()=>{
  files.readFile.mockRejectedValueOnce(Object.assign(new Error("missing"),{code:"ENOENT"}));
  expect(await readDocumentApplicability(1)).toEqual(emptyApplicability(1));
  files.readFile.mockResolvedValue(JSON.stringify(emptyApplicability(2)));
  await expect(readDocumentApplicability(1)).rejects.toThrow("mismatch");
  await expect(readDocumentApplicability(-1)).rejects.toThrow();
});
it("persists mappings atomically outside the reindexed document/chunk files",async()=>{
  const mapping={...emptyApplicability(1),categories:["Заглушки"],catalogIds:[10]};
  expect(await saveDocumentApplicability(mapping)).toEqual(mapping);
  expect(files.rename).toHaveBeenCalledWith(expect.stringContaining(".tmp"),expect.stringContaining("1.json"));
  expect(files.writeFile).toHaveBeenCalledWith(expect.stringContaining(applicabilityRoot),JSON.stringify(mapping,null,2),"utf8");
  files.readdir.mockResolvedValue(["1.json","1.json.tmp","unrelated.json"]);files.readFile.mockResolvedValue(JSON.stringify(mapping));
  expect(await listDocumentApplicability()).toEqual([mapping]);
});
