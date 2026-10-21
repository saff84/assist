import { expect,it,vi } from "vitest";
vi.mock("./db",()=>({getDb:vi.fn()}));
vi.mock("./documentApplicabilityStore",()=>({readDocumentApplicability:vi.fn(),saveDocumentApplicability:vi.fn()}));
import { documentApplicabilityRouter } from "./documentApplicabilityRouter";
import { getDb } from "./db";
import { saveDocumentApplicability } from "./documentApplicabilityStore";
import { emptyApplicability } from "../shared/documentApplicability";
const caller=(role:string|null)=>documentApplicabilityRouter.createCaller({user:role?{role}:null} as any);
it.each([null,"editor","user"])("restricts confirmed applicability edits to administrators: %s",async role=>{
  await expect(caller(role).resources()).rejects.toMatchObject({code:"FORBIDDEN"});
  await expect(caller(role).get({documentId:1})).rejects.toMatchObject({code:"FORBIDDEN"});
  await expect(caller(role).save(emptyApplicability(1))).rejects.toMatchObject({code:"FORBIDDEN"});
});
it("validates document and catalog ids before saving a confirmed link",async()=>{
  const chain:any={from:vi.fn(()=>chain),where:vi.fn().mockResolvedValue([{id:1,docType:"certificate"},{id:10,docType:"catalog"}])};
  vi.mocked(getDb).mockResolvedValue({select:vi.fn(()=>chain)} as any);
  await caller("admin").save({...emptyApplicability(1),catalogIds:[10]});
  expect(saveDocumentApplicability).toHaveBeenCalledWith({...emptyApplicability(1),catalogIds:[10]});
  await expect(caller("admin").save(emptyApplicability(10))).rejects.toMatchObject({code:"BAD_REQUEST"});
  await expect(caller("admin").save({...emptyApplicability(1),catalogIds:[99]})).rejects.toMatchObject({code:"BAD_REQUEST"});
});
