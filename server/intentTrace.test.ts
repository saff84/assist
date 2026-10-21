import { expect, it, vi } from "vitest";
const files=vi.hoisted(()=>({mkdir:vi.fn(),writeFile:vi.fn(),rename:vi.fn(),readFile:vi.fn(),readdir:vi.fn()}));
vi.mock("fs/promises",()=>({default:files}));
import { createIntentTrace, saveIntentTrace, listIntentTraces, intentTraceRoot } from "./intentTrace";
it("stores completed traces atomically and hashes session identifiers",async()=>{
  const trace=createIntentTrace("Как подключить?","website","visitor-session");
  expect(trace.sessionHash).not.toContain("visitor-session");
  expect(createIntentTrace("Другой вопрос","website","visitor-session").sessionHash).toBe(trace.sessionHash);
  expect(createIntentTrace("Другой вопрос","test","visitor-session").sessionHash).not.toBe(trace.sessionHash);
  await saveIntentTrace(trace);
  expect(files.writeFile).toHaveBeenCalledWith(expect.stringContaining(intentTraceRoot),JSON.stringify(trace),"utf8");
  expect(files.rename).toHaveBeenCalledWith(expect.stringContaining(".tmp"),expect.stringContaining(trace.id+".json"));
});
it("reports only completed request files and supports an empty statistics directory",async()=>{
  files.readdir.mockRejectedValueOnce(Object.assign(new Error("missing"),{code:"ENOENT"}));
  expect(await listIntentTraces()).toEqual([]);
  const trace=createIntentTrace("Вопрос","test");
  files.readdir.mockResolvedValue([trace.id+".json",trace.id+".json.tmp","unrelated.json"]);
  files.readFile.mockResolvedValue(JSON.stringify(trace));
  expect(await listIntentTraces()).toEqual([trace]);
});
