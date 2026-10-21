import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./catalogAssortment",async original=>({...await original<typeof import("./catalogAssortment")>(),catalogAssortmentResponse:vi.fn().mockResolvedValue(null)}));
import { catalogAssortmentResponse } from "./catalogAssortment";
it("answers a catalog assortment query without single-chunk search or classification",async()=>{
  vi.mocked(catalogAssortmentResponse).mockResolvedValueOnce({response:"Линейки труб из каталогов",sources:[],tokensUsed:0,responseTime:0});
  const execute=vi.fn();
  const response=await runIntentPipeline(input("какие трубы есть у Sanext"),undefined,execute);
  expect(response.response).toContain("Линейки труб");
  expect(execute).not.toHaveBeenCalled();expect(classifyQueryIntent).not.toHaveBeenCalled();
});
vi.mock("./queryRoutingStore",()=>({readQueryRouting:vi.fn()}));
vi.mock("./intentClassifier",()=>({classifyQueryIntent:vi.fn()}));
vi.mock("./intentTrace",async original=>({...await original<typeof import("./intentTrace")>(),listIntentTraces:vi.fn().mockResolvedValue([]),saveIntentTrace:vi.fn().mockResolvedValue(undefined)}));
import { runIntentPipeline } from "./intentPipeline";
import { classifyQueryIntent } from "./intentClassifier";
import { readQueryRouting } from "./queryRoutingStore";
import { saveIntentTrace, listIntentTraces, trackIntentStage, createIntentTrace } from "./intentTrace";
import { defaultQueryRouting } from "../shared/queryRouting";
import type { IntentTrace } from "../shared/intentProcessing";
const input=(query:string,sessionId="a")=>({query,sessionId,source:"test" as const});
const result={response:"Ответ по теме",sources:[],responseTime:1,tokensUsed:1};
const decision={targets:["installation","catalog"] as Array<"installation"|"catalog">,confidence:0.9,clarification:"",searchQuery:"совместимость трубы Теплый пол",suggestedTerms:["совместимость"],reason:"Подбор соединения"};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(readQueryRouting).mockResolvedValue(structuredClone(defaultQueryRouting));vi.mocked(listIntentTraces).mockResolvedValue([]);vi.mocked(classifyQueryIntent).mockResolvedValue(structuredClone(decision));});
it("uses rules first and does not call the classifier",async()=>{
  const execute=vi.fn().mockResolvedValue(result);
  await runIntentPipeline(input("монтаж по паспорту"),undefined,execute);
  expect(classifyQueryIntent).not.toHaveBeenCalled();
  expect(execute).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({forceDocumentType:"installation",allowedDocumentTypes:["installation","instruction"]}));
  expect(saveIntentTrace).toHaveBeenCalledWith(expect.objectContaining({method:"rule",outcome:"answer"}));
});
it("classifies unmatched requests and searches only the selected databases",async()=>{
  const execute=vi.fn().mockResolvedValue(result);
  await runIntentPipeline(input("подойдет ли это соединение"),undefined,execute);
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({query:decision.searchQuery}),expect.objectContaining({requireSynthesis:true,allowedDocumentTypes:["installation","instruction","catalog"]}));
  expect(saveIntentTrace).toHaveBeenCalledWith(expect.objectContaining({method:"llm",classification:decision}));
});
it("asks for clarification without performing retrieval or generating an answer",async()=>{
  vi.mocked(classifyQueryIntent).mockResolvedValue({...decision,confidence:0.4,clarification:"Рабочее давление или давление опрессовки?"});
  const execute=vi.fn();
  const response=await runIntentPipeline(input("какое давление"),undefined,execute);
  expect(response.response).toContain("опрессовки");expect(execute).not.toHaveBeenCalled();
  expect(saveIntentTrace).toHaveBeenCalledWith(expect.objectContaining({outcome:"clarification",stages:expect.arrayContaining([expect.objectContaining({stage:"retrieval",status:"skipped"})])}));
});
it("keeps classifier failures visible and asks a question instead of searching every base",async()=>{
  vi.mocked(classifyQueryIntent).mockRejectedValueOnce(new Error("invalid JSON"));
  const execute=vi.fn();
  const response=await runIntentPipeline(input("помогите"),undefined,execute);
  expect(response.response).toContain("Уточните");expect(execute).not.toHaveBeenCalled();
  expect(saveIntentTrace).toHaveBeenCalledWith(expect.objectContaining({method:"llm",stages:expect.arrayContaining([expect.objectContaining({stage:"classification",status:"error"})])}));
});
it("uses only the same session as context for an answer to a clarification",async()=>{
  const previous=createIntentTrace("какое давление","test","a");
  const other=createIntentTrace("вопрос другого посетителя","test","b");
  vi.mocked(listIntentTraces).mockResolvedValue([other,previous]);
  await runIntentPipeline(input("для опрессовки"),undefined,vi.fn().mockResolvedValue(result));
  expect(classifyQueryIntent).toHaveBeenCalledWith("для опрессовки",[previous]);
});
it("keeps product context for a follow-up that matches an explicit rule",async()=>{
  vi.mocked(listIntentTraces).mockResolvedValue([createIntentTrace("Труба Теплый пол 2182","test","a")]);
  const execute=vi.fn().mockResolvedValue(result);
  await runIntentPipeline(input("а ее монтаж?"),undefined,execute);
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({query:expect.stringContaining("Труба Теплый пол 2182")}),expect.objectContaining({forceDocumentType:"installation"}));
  expect(classifyQueryIntent).not.toHaveBeenCalled();
});
it("supports disabling AI fallback and preserves manual administrator selection",async()=>{
  vi.mocked(readQueryRouting).mockResolvedValue({...defaultQueryRouting,fallback:"company"});
  const execute=vi.fn().mockResolvedValue(result);
  await runIntentPipeline(input("неизвестный вопрос"),undefined,execute);
  expect(execute).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({forceDocumentType:"company"}));
  await runIntentPipeline(input("неизвестный вопрос"),{forceDocumentType:"catalog"},execute);
  expect(execute).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({forceDocumentType:"catalog"}));
  expect(classifyQueryIntent).not.toHaveBeenCalled();
});
it("persists errors and isolates concurrent request stages",async()=>{
  const execute=vi.fn(async(query:any)=>trackIntentStage("retrieval",query.query,async()=>{await Promise.resolve();return result;}));
  await Promise.all([runIntentPipeline(input("монтаж A","a"),undefined,execute),runIntentPipeline(input("монтаж B","b"),undefined,execute)]);
  const saved=vi.mocked(saveIntentTrace).mock.calls.map(call=>call[0]);
  for(const trace of saved)expect(trace.stages.filter(stage=>stage.stage==="retrieval").map(stage=>stage.detail)).toEqual([trace.query]);
  await expect(runIntentPipeline(input("монтаж"),undefined,async()=>{throw new Error("offline");})).rejects.toThrow("offline");
  expect(saveIntentTrace).toHaveBeenLastCalledWith(expect.objectContaining({outcome:"error"}));
});
it.each(["труба для теплого пола","поршневой редуктор","аксиальные фитинги"])("clarifies the task before searching a product-only query: %s",async query=>{
  const execute=vi.fn();
  const reply=await runIntentPipeline(input(query),undefined,execute);
  expect(reply.response).toContain("Что вас интересует");expect(reply.response).not.toContain("нет информации");
  expect(execute).not.toHaveBeenCalled();expect(classifyQueryIntent).not.toHaveBeenCalled();
  expect(saveIntentTrace).toHaveBeenCalledWith(expect.objectContaining({outcome:"clarification",clarificationQuestion:reply.response}));
});
it.each(["характеристики","подбор","монтаж","общее описание"])("keeps the product when the user answers the task clarification: %s",async task=>{
  const previous={...createIntentTrace("труба для теплого пола","test","a"),outcome:"clarification" as const,clarificationQuestion:"Что вас интересует?"};
  vi.mocked(listIntentTraces).mockResolvedValue([previous]);
  const execute=vi.fn().mockResolvedValue(result);
  await runIntentPipeline(input(task),undefined,execute);
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({query:expect.stringContaining("труба для теплого пола")}),expect.objectContaining({requireSynthesis:true}));
  expect(execute.mock.calls[0][0].query).toContain(task);expect(classifyQueryIntent).not.toHaveBeenCalled();
});
it("records a retrieval clarification so the next short answer can use it as context",async()=>{
  await runIntentPipeline(input("монтаж трубы"),undefined,vi.fn().mockResolvedValue({...result,needsClarification:true,response:"Уточните линейку трубы?"}));
  expect(saveIntentTrace).toHaveBeenCalledWith(expect.objectContaining({outcome:"clarification",clarificationQuestion:"Уточните линейку трубы?"}));
});
