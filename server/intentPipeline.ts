import type { RAGQuery, RAGResponse } from "./ragModule";
import type { RAGOptions, DocumentType } from "./rag/types";
import { readQueryRouting } from "./queryRoutingStore";
import { resolveQueryRoute, routeDocumentTypes } from "../shared/queryRouting";
import { classifyQueryIntent } from "./intentClassifier";
import { createIntentTrace, listIntentTraces, recordIntentStage, runWithIntentTrace, saveIntentTrace, trackIntentStage } from "./intentTrace";
import { intentStageLabels } from "../shared/intentProcessing";
export async function runIntentPipeline(
  ragQuery:RAGQuery, options:RAGOptions|undefined, executeRAGQuery:(query:RAGQuery,options?:RAGOptions)=>Promise<RAGResponse>
):Promise<RAGResponse> {
  const trace=createIntentTrace(ragQuery.query,ragQuery.source,ragQuery.sessionId);
  const start=Date.now();
  return runWithIntentTrace(trace,async()=>{
    try {
      const config=await readQueryRouting();
      const rule=await trackIntentStage("rules","Проверка правил администратора",async()=>resolveQueryRoute(ragQuery.query,config));
      if(!rule)trace.stages[trace.stages.length-1].detail=config.enabled?"Ни одно правило не совпало":"Автоматическая маршрутизация выключена";
      let query=ragQuery;
      if(rule) {
        trace.method="rule";trace.targets=[rule.target,...rule.additionalTargets];
        trace.stages[trace.stages.length-1].detail=`Правило «${rule.ruleName}», совпадение «${rule.term}»`;
        if(trace.sessionHash && /(?:^|\s)(?:е[её]|его|их|этого|этой|него|не[её]|это|они|он|она)(?:[?.,!]|\s|$)/i.test(ragQuery.query)) {
          const previous=(await listIntentTraces()).find(item=>item.sessionHash===trace.sessionHash && item.outcome==="answer");
          if(previous)query={...ragQuery,query:`${ragQuery.query}\nКонтекст предыдущего вопроса: ${(previous.searchQuery??previous.query).slice(0,2000)}`};
        }
      } else if(options?.forceDocumentType) {
        trace.method="manual";trace.targets=[options.forceDocumentType];
      } else if(config.enabled && config.fallback==="llm") {
        trace.method="llm";
        const history=trace.sessionHash?(await listIntentTraces()).filter(item=>item.sessionHash===trace.sessionHash).slice(0,3):[];
        let decision;
        try {decision=await trackIntentStage("classification","Определение темы запроса",()=>classifyQueryIntent(ragQuery.query,history));}
        catch(error) {
          trace.outcome="clarification";
          const response="Не удалось определить тему вопроса. Уточните, что нужно: характеристики или подбор изделия, монтаж, документ, гарантия или информация о компании. Укажите название изделия или артикул.";
          recordIntentStage("clarification","clarification","Ошибка классификатора; задано уточнение");
          recordIntentStage("response","success","Пользователю отправлено уточнение");
          return {response,sources:[],responseTime:Date.now()-start,tokensUsed:0};
        }
        trace.method="llm";trace.classification=decision;trace.targets=decision.targets;
        if(decision.confidence<0.75 || decision.clarification) {
          trace.outcome="clarification";
          recordIntentStage("clarification","clarification",decision.clarification||"Низкая уверенность классификации");
          recordIntentStage("response","success","Пользователю отправлено уточнение");
          return {response:decision.clarification||"Уточните, какая информация об изделии нужна и его название или артикул.",sources:[],responseTime:Date.now()-start,tokensUsed:0};
        }
        query={...ragQuery,query:decision.searchQuery};
      } else {trace.targets=[options?.forceDocumentType??"company"];}
      trace.searchQuery=query.query;
      const targets=trace.targets as DocumentType[];
      options={...options,requireSynthesis:trace.method==="llm"||trace.method==="rule"||options?.requireSynthesis,
        forceDocumentType:targets[0],allowedDocumentTypes:Array.from(new Set(targets.flatMap(target=>routeDocumentTypes(target as any))))};
      const response=await executeRAGQuery(query,options);
      trace.sourceCount=response.sources.length+(response.attachments?.length??0);
      recordIntentStage("response","success",`Выдан ответ; источников: ${trace.sourceCount}`);
      return {...response,mode:targets[0]==="company"?"company":"scoped",responseTime:Date.now()-start};
    } catch(error) {
      trace.outcome="error";recordIntentStage("response","error",error instanceof Error?error.message:"Ошибка обработки");throw error;
    } finally {
      for(const stage of Object.keys(intentStageLabels) as Array<keyof typeof intentStageLabels>) {
        if(!trace.stages.some(item=>item.stage===stage))recordIntentStage(stage,"skipped","Этап не потребовался для этого запроса");
      }
      trace.durationMs=Date.now()-start;
      try {await saveIntentTrace(trace);}catch(error){console.error("[Intent] Failed to persist trace",error);}
    }
  });
}

