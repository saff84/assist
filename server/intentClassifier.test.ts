import { expect, it, vi } from "vitest";
vi.mock("./_core/llm",()=>({invokeLLM:vi.fn()}));
import { invokeLLM } from "./_core/llm";
import { classifyQueryIntent } from "./intentClassifier";
const decision={targets:["catalog"],confidence:0.9,searchQuery:"размеры 5905",clarification:"",suggestedTerms:["размеры","5905","выдуманная фраза"],reason:"Характеристики"};
const respond=(value:unknown)=>vi.mocked(invokeLLM).mockResolvedValue({choices:[{message:{content:JSON.stringify(value)}}]} as any);
it("validates structured classification and recommends only phrases present in the request",async()=>{
  respond(decision);
  expect(await classifyQueryIntent("размеры 5905")).toMatchObject({suggestedTerms:["размеры"],targets:["catalog"]});
});
it("preserves user numbers when a rewritten query loses them",async()=>{
  respond({...decision,searchQuery:"размеры трубы"});
  expect((await classifyQueryIntent("размеры 5905")).searchQuery).toBe("размеры 5905");
});
it("rejects invented databases and malformed output",async()=>{
  respond({...decision,targets:["internet"]});
  await expect(classifyQueryIntent("размеры")).rejects.toThrow();
  vi.mocked(invokeLLM).mockResolvedValue({choices:[{message:{content:"not JSON"}}]} as any);
  await expect(classifyQueryIntent("размеры")).rejects.toThrow();
});
it("asks for clarification when file search is mixed with answer generation",async()=>{
  respond({...decision,targets:["passport","catalog"]});
  expect(await classifyQueryIntent("размеры 5905")).toMatchObject({confidence:0,clarification:expect.stringContaining("PDF")});
});
