import { z } from "zod";
import { routeTargetSchema } from "./queryRouting";
export const intentStageLabels = {
  rules:"Правила", classification:"Определение темы ИИ", clarification:"Уточнение",
  sku:"Артикул → группа", retrieval:"Поиск источников", generation:"Ответ ИИ", response:"Выдача ответа",
} as const;
export type IntentStage = {stage:keyof typeof intentStageLabels; status:"success"|"skipped"|"clarification"|"error"; durationMs:number; detail:string};
export const intentDecisionSchema=z.object({
  targets:z.array(routeTargetSchema).min(1).max(3),
  confidence:z.number().min(0).max(1),
  clarification:z.string().max(300).default(""),
  searchQuery:z.string().min(1).max(2000),
  suggestedTerms:z.array(z.string().min(2).max(80)).max(5).default([]),
  reason:z.string().max(400),
});
export type IntentDecision=z.infer<typeof intentDecisionSchema>;
export type IntentTrace={id:string; createdAt:string; query:string; searchQuery?:string; clarificationQuestion?:string; product?:import("./productScope").ProductScope; sourcePolicy?:string; sources?:Array<{documentId:number;filename:string;sectionPath?:string}>; source:string; sessionHash?:string; targets:string[]; method:"rule"|"llm"|"manual"|"product"|"none"; stages:IntentStage[]; durationMs:number; outcome:"answer"|"clarification"|"error"; sourceCount:number; classification?:IntentDecision};
