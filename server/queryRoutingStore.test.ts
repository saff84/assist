import { beforeEach, expect, it, vi } from "vitest";
const files=vi.hoisted(()=>({readFile:vi.fn(),mkdir:vi.fn(),writeFile:vi.fn(),rename:vi.fn(),rm:vi.fn()}));
vi.mock("fs/promises",()=>({default:files}));
import { readQueryRouting, saveQueryRouting, queryRoutingPath } from "./queryRoutingStore";
import { defaultQueryRouting } from "../shared/queryRouting";
beforeEach(()=>{vi.resetAllMocks();});
it("uses standard rules only when settings do not exist",async()=>{
  files.readFile.mockRejectedValue(Object.assign(new Error("missing"),{code:"ENOENT"}));
  const config=await readQueryRouting();
  config.rules[0].enabled=false;
  expect(defaultQueryRouting.rules[0].enabled).toBe(true);
  files.readFile.mockResolvedValue("broken json");
  await expect(readQueryRouting()).rejects.toThrow("Не удалось прочитать");
});
it("persists validated rules atomically in the uploads volume and reads them back",async()=>{
  const config={...structuredClone(defaultQueryRouting),enabled:false};
  await saveQueryRouting(config);
  expect(files.writeFile).toHaveBeenCalledWith(expect.stringContaining(queryRoutingPath),JSON.stringify(config,null,2),"utf8");
  expect(files.rename).toHaveBeenCalledWith(expect.stringContaining(".tmp"),queryRoutingPath);
  expect(files.rm).toHaveBeenCalledWith(expect.stringContaining(".tmp"),{force:true});
  files.readFile.mockResolvedValue(JSON.stringify(config));
  expect(await readQueryRouting()).toEqual(config);
});
it("does not overwrite settings on invalid input and reports write failure",async()=>{
  await expect(saveQueryRouting({enabled:true,rules:[{}]} as any)).rejects.toThrow();
  expect(files.writeFile).not.toHaveBeenCalled();
  files.rename.mockRejectedValue(new Error("disk error"));
  await expect(saveQueryRouting(defaultQueryRouting)).rejects.toThrow("disk error");
  expect(files.rm).toHaveBeenCalled();
});
