import type { RAGQuery, RAGResponse } from "./ragModule";
import type { RAGOptions, DocumentType } from "./rag/types";
import { readQueryRouting } from "./queryRoutingStore";
import { resolveQueryRoute, routeDocumentTypes } from "../shared/queryRouting";
import { classifyQueryIntent } from "./intentClassifier";
import { createIntentTrace, listIntentTraces, recordIntentStage, runWithIntentTrace, saveIntentTrace, trackIntentStage } from "./intentTrace";
import { intentStageLabels } from "../shared/intentProcessing";
import { isProductOnlyQuery, productTaskQuestion, isTaskSelection, productTaskTargets } from "./productQuestion";
import { assortmentFamily, catalogAssortmentResponse } from "./catalogAssortment";
import { resolveCatalogSubject } from "./catalogSubject";
import { resolveCatalogProductScope } from "./catalogProductScope";
import { modelCodes } from "../shared/productScope";
import { productSourcePolicy, isSourceComparison } from "../shared/productSourcePolicy";
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
      const history=trace.sessionHash?(await listIntentTraces()).filter(item=>item.sessionHash===trace.sessionHash).slice(0,3):[];
      const previous=history[0];
      const bareTask=/^(?:(?:общее|общие|технические)\s+)?(?:характеристики|описание|параметры|размеры|подбор|монтаж|совместимость)[.!?]*$/i.test(ragQuery.query.trim());
      const inheritedProduct=bareTask?previous?.product:undefined;
      const previousModelQuery=previous?(modelCodes(previous.query).length===1?previous.query:previous.searchQuery??previous.query):"";
      if(inheritedProduct) {
        trace.product=inheritedProduct;
        ragQuery={...ragQuery,query:`${ragQuery.query}\nВыбранный товар: ${inheritedProduct.name}`};
      } else if(bareTask&&previous&&modelCodes(previousModelQuery).length===1) {
        ragQuery={...ragQuery,query:`${ragQuery.query}\nПредыдущий товар: ${previousModelQuery}`};
      }
      if(assortmentFamily(ragQuery.query) && (!options?.forceDocumentType || options.forceDocumentType==="catalog") && (!rule || rule.target==="catalog")) {
        trace.method=rule?"rule":"product";trace.targets=["catalog"];trace.searchQuery=ragQuery.query;
        const overview=await trackIntentStage("retrieval","Сбор групп и линеек из индексированных каталогов",()=>catalogAssortmentResponse(ragQuery.query));
        if(overview) {
          if(overview.needsClarification) {
            trace.outcome="clarification";trace.clarificationQuestion=overview.response;
            recordIntentStage("clarification","clarification","В базе товаров не найдено соответствующих товарных позиций");
          }
          trace.sourceCount=overview.sources.length;
          recordIntentStage("response","success",`Обзор ассортимента; источников: ${trace.sourceCount}`);
          return {...overview,mode:"scoped",responseTime:Date.now()-start};
        }
      }
      const productAnswerFollowup=previous?.outcome==="clarification"&&isTaskSelection(previous.query)&&isProductOnlyQuery(ragQuery.query)
        ? `${ragQuery.query}\nЗадача пользователя: ${previous.query}`:null;
      const subjectStarted=Date.now();
      const resolvedSubject=!options?.forceDocumentType&&config.enabled?await resolveCatalogSubject(ragQuery.query):null;
      if(resolvedSubject) {
        recordIntentStage("retrieval","success",`Название изделия уточнено по каталогу: ${resolvedSubject}`,Date.now()-subjectStarted);
        ragQuery={...ragQuery,query:`${ragQuery.query}\nТовар из каталога: ${resolvedSubject}`};
      }
      const taskFollowup=productAnswerFollowup??(previous?.outcome==="clarification"&&isTaskSelection(ragQuery.query)
        ? `${previous.searchQuery??previous.query}\nВопрос пользователя: ${ragQuery.query}`:null);
      const pureModel=modelCodes(ragQuery.query).length===1&&ragQuery.query.trim().replace(/[«»"'\s‐‑–—-]/g,"").toUpperCase().replace(/Н/g,"H")===modelCodes(ragQuery.query)[0].replace(/-/g,"");
      if(!productAnswerFollowup&&!options?.forceDocumentType && (isProductOnlyQuery(ragQuery.query)||pureModel) && (!rule||["catalog","installation","instruction"].includes(rule.target))) {
        if(pureModel) {
          const match=await trackIntentStage("sku","Определение точной модели в каталоге",()=>resolveCatalogProductScope(ragQuery.query));
          if(match.scope)trace.product=match.scope;
        }
        const response=productTaskQuestion(trace.product?.name??ragQuery.query);
        trace.method=rule?"rule":"product";trace.targets=rule?[rule.target,...rule.additionalTargets]:["catalog","installation"];
        trace.outcome="clarification";trace.searchQuery=ragQuery.query;trace.clarificationQuestion=response;
        recordIntentStage("clarification","clarification","Название товара определено; уточняем цель вопроса");
        recordIntentStage("response","success","Пользователю задан один вопрос о задаче");
        return {response,sources:[],responseTime:Date.now()-start,tokensUsed:0};
      }
      let query=ragQuery;
      const compareSources=isSourceComparison(ragQuery.query);
      if(compareSources) {
        trace.method="product";trace.targets=["catalog","installation"];
      } else if(rule) {
        trace.method="rule";trace.targets=[rule.target,...rule.additionalTargets];
        const ruleStage=trace.stages.find(stage=>stage.stage==="rules");
        if(ruleStage)ruleStage.detail=`Правило «${rule.ruleName}», совпадение «${rule.term}»`;
        if(trace.sessionHash && /(?:^|\s)(?:е[её]|его|их|этого|этой|него|не[её]|это|они|он|она)(?:[?.,!]|\s|$)/i.test(ragQuery.query)) {
          const context=history.find(item=>item.outcome==="answer");
          if(context)query={...ragQuery,query:`${ragQuery.query}\nКонтекст предыдущего вопроса: ${(context.searchQuery??context.query).slice(0,2000)}`};
        }
      } else if(options?.forceDocumentType) {
        trace.method="manual";trace.targets=[options.forceDocumentType];
      } else if(productAnswerFollowup||resolvedSubject||inheritedProduct) {
        trace.method="product";trace.targets=productAnswerFollowup?productTaskTargets(previous!.query):["catalog"];
        if(inheritedProduct)trace.targets=productTaskTargets(ragQuery.query);
      } else if(taskFollowup && previous && isProductOnlyQuery(previous.query)) {
        trace.method="product";trace.targets=productTaskTargets(ragQuery.query);
      } else if(config.enabled && config.fallback==="llm") {
        trace.method="llm";
        let decision;
        try {decision=await trackIntentStage("classification","Определение темы запроса",()=>classifyQueryIntent(ragQuery.query,history));}
        catch(error) {
          trace.outcome="clarification";
          const response="Не удалось определить тему вопроса. Уточните, что нужно: характеристики или подбор изделия, монтаж, документ, гарантия или информация о компании. Укажите название изделия или артикул.";
          trace.clarificationQuestion=response;
          recordIntentStage("clarification","clarification","Ошибка классификатора; задано уточнение");
          recordIntentStage("response","success","Пользователю отправлено уточнение");
          return {response,sources:[],responseTime:Date.now()-start,tokensUsed:0};
        }
        trace.method="llm";trace.classification=decision;trace.targets=decision.targets;
        if(decision.confidence<0.75 || decision.clarification) {
          trace.outcome="clarification";
          trace.clarificationQuestion=decision.clarification||"Уточните, какая информация об изделии нужна и его название или артикул.";
          recordIntentStage("clarification","clarification",decision.clarification||"Низкая уверенность классификации");
          recordIntentStage("response","success","Пользователю отправлено уточнение");
          return {response:decision.clarification||"Уточните, какая информация об изделии нужна и его название или артикул.",sources:[],responseTime:Date.now()-start,tokensUsed:0};
        }
        query={...ragQuery,query:decision.searchQuery};
      } else {trace.targets=[options?.forceDocumentType??"company"];}
      if(taskFollowup)query={...query,query:taskFollowup};
      trace.searchQuery=query.query;
      const policy=productSourcePolicy(query.query,trace.targets as any,config);
      if(policy) {
        trace.targets=policy.targets;trace.sourcePolicy=policy.reason;
        recordIntentStage("rules","success",policy.reason);
      }
      if(trace.targets.length===1&&trace.targets[0]==="catalog") {
        const match=await trackIntentStage("sku","Выбор точного раздела товара в каталоге",()=>resolveCatalogProductScope(query.query));
        if(!match.scope&&!match.clarification&&inheritedProduct)match.scope=inheritedProduct;
        if(match.clarification) {
          trace.outcome="clarification";trace.clarificationQuestion=match.clarification;
          recordIntentStage("clarification","clarification",match.clarification);
          recordIntentStage("response","success","Запрошена точная модель; паспорта не использованы");
          return {response:match.clarification,needsClarification:true,sources:[],tokensUsed:0,responseTime:Date.now()-start};
        }
        if(match.scope) {
          trace.product=match.scope;
          query={...query,query:`${query.query}\nТочный раздел каталога: ${match.scope.name}`};
          trace.searchQuery=query.query;
        }
      }
      const targets=trace.targets as DocumentType[];
      options={...options,requireSynthesis:trace.method==="llm"||trace.method==="rule"||trace.method==="product"||options?.requireSynthesis,
        productScope:targets.length===1&&targets[0]==="catalog"?trace.product:undefined,
        forceDocumentType:targets[0],allowedDocumentTypes:Array.from(new Set(targets.flatMap(target=>routeDocumentTypes(target as any))))};
      const response=await executeRAGQuery(query,options);
      if(response.needsClarification) {
        trace.outcome="clarification";trace.clarificationQuestion=response.response;
        recordIntentStage("clarification","clarification","Недостаточно результатов поиска; запрошено уточнение изделия");
      }
      trace.sourceCount=response.sources.length+(response.attachments?.length??0);
      trace.sources=response.sources.map(({documentId,filename,sectionPath})=>({documentId,filename,sectionPath}));
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

