import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./intentTrace",()=>({listIntentTraces:vi.fn()}));
vi.mock("./queryRoutingStore",()=>({readQueryRouting:vi.fn(),saveQueryRouting:vi.fn()}));
const files=vi.hoisted(()=>({access:vi.fn(),mkdir:vi.fn(),writeFile:vi.fn()}));
vi.mock("fs/promises",()=>({default:files}));
import { listIntentRecommendations, reviewIntentRecommendation } from "./intentRecommendations";
import { listIntentTraces } from "./intentTrace";
import { readQueryRouting, saveQueryRouting } from "./queryRoutingStore";
import { defaultQueryRouting } from "../shared/queryRouting";
import type { IntentTrace } from "../shared/intentProcessing";
const trace={id:"test",createdAt:"2026-10-21",query:"размотка трубы",source:"test",targets:["installation"],method:"llm",stages:[],durationMs:1,outcome:"answer",sourceCount:1,
  classification:{targets:["installation"],confidence:0.9,clarification:"",searchQuery:"размотка трубы",suggestedTerms:["размотка"],reason:"Монтаж"}} as IntentTrace;
beforeEach(()=>{
  vi.clearAllMocks();files.access.mockRejectedValue(Object.assign(new Error("missing"),{code:"ENOENT"}));
  vi.mocked(readQueryRouting).mockImplementation(async()=>structuredClone(defaultQueryRouting));
  vi.mocked(listIntentTraces).mockResolvedValue([structuredClone(trace),structuredClone(trace)]);
});
it("groups recommendations, identifies the existing rule, and does not apply them automatically",async()=>{
  const proposals=await listIntentRecommendations();
  expect(proposals).toHaveLength(1);
  expect(proposals[0]).toMatchObject({existingRuleId:"installation",terms:["размотка"],count:2});
  expect(saveQueryRouting).not.toHaveBeenCalled();
});
it("applies only after administrator review and appends approved terms without changing priorities",async()=>{
  const proposal=(await listIntentRecommendations())[0];
  await reviewIntentRecommendation(proposal.id,"accept",["размотк*"]);
  const saved=vi.mocked(saveQueryRouting).mock.calls[0][0];
  expect(saved.rules.map(rule=>rule.id)).toEqual(defaultQueryRouting.rules.map(rule=>rule.id));
  expect(saved.rules[0].terms).toContain("размотк*");
  expect(files.writeFile).toHaveBeenCalledWith(expect.stringContaining(proposal.id+".json"),expect.stringContaining("accept"),"utf8");
});
it("ignores uncertain, failed, covered and previously dismissed proposals",async()=>{
  vi.mocked(listIntentTraces).mockResolvedValue([{...trace,outcome:"clarification"},{...trace,outcome:"error"},{...trace,query:"монтаж трубы"}]);
  expect(await listIntentRecommendations()).toEqual([]);
  vi.mocked(listIntentTraces).mockResolvedValue([trace]);files.access.mockResolvedValue(undefined);
  expect(await listIntentRecommendations()).toEqual([]);
});
it("dismisses a recommendation without changing rules",async()=>{
  const proposal=(await listIntentRecommendations())[0];
  await reviewIntentRecommendation(proposal.id,"dismiss");
  expect(saveQueryRouting).not.toHaveBeenCalled();
});
