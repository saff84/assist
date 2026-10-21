import { expect, it, vi } from "vitest";
vi.mock("./queryRoutingStore",()=>({readQueryRouting:vi.fn(),saveQueryRouting:vi.fn()}));
import { queryRoutingRouter } from "./queryRoutingRouter";
import { defaultQueryRouting } from "../shared/queryRouting";
import { readQueryRouting, saveQueryRouting } from "./queryRoutingStore";
const caller=(role:string|null)=>queryRoutingRouter.createCaller({user:role?{id:1,role}:null} as any);
it("allows admins to preview the draft with the same matching rules as live queries",async()=>{
  expect(await caller("admin").preview({query:"условия монтажа по паспорту",config:defaultQueryRouting})).toMatchObject({target:"installation",term:"монтаж*"});
  vi.mocked(readQueryRouting).mockResolvedValue(defaultQueryRouting);
  expect(await caller("admin").get()).toEqual(defaultQueryRouting);
  vi.mocked(saveQueryRouting).mockResolvedValue(defaultQueryRouting);
  await caller("admin").save(defaultQueryRouting);
  expect(saveQueryRouting).toHaveBeenCalledWith(defaultQueryRouting);
});
it.each([null,"editor","user"])("rejects unauthorized settings access for %s",async role=>{
  await expect(caller(role).get()).rejects.toMatchObject({code:"FORBIDDEN"});
  await expect(caller(role).save(defaultQueryRouting)).rejects.toMatchObject({code:"FORBIDDEN"});
  await expect(caller(role).preview({query:"монтаж",config:defaultQueryRouting})).rejects.toMatchObject({code:"FORBIDDEN"});
  await expect(caller(role).traces()).rejects.toMatchObject({code:"FORBIDDEN"});
  await expect(caller(role).recommendations()).rejects.toMatchObject({code:"FORBIDDEN"});
  await expect(caller(role).review({id:"a".repeat(64),action:"dismiss"})).rejects.toMatchObject({code:"FORBIDDEN"});
});
