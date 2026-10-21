import fs from "fs/promises";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { listIntentTraces } from "./intentTrace";
import { readQueryRouting, saveQueryRouting } from "./queryRoutingStore";
import { resolveQueryRoute, routeLabels } from "../shared/queryRouting";
const root=path.resolve("uploads","intent-recommendations");
export async function listIntentRecommendations() {
  const [traces,config]=await Promise.all([listIntentTraces(),readQueryRouting()]);
  const grouped=new Map<string,{id:string;target:keyof typeof routeLabels;additionalTargets:Array<keyof typeof routeLabels>;terms:string[];examples:string[];count:number;reason:string;existingRuleId?:string;existingRuleName?:string}>();
  for(const trace of traces) {
    const decision=trace.classification;
    if(trace.method!=="llm"||trace.outcome!=="answer"||!decision||decision.confidence<0.75||!decision.suggestedTerms.length)continue;
    const matched=resolveQueryRoute(trace.query,config);
    if(matched && matched.target===decision.targets[0])continue;
    const terms=Array.from(new Set(decision.suggestedTerms.map(term=>term.trim().toLowerCase()))).sort();
    const id=createHash("sha256").update(JSON.stringify([decision.targets,terms])).digest("hex");
    try{await fs.access(path.join(root,id+".json"));continue;}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    const previous=grouped.get(id);
    if(previous){previous.count++;if(previous.examples.length<3)previous.examples.push(trace.query);continue;}
    const existing=config.rules.find(rule=>rule.enabled && rule.target===decision.targets[0] && JSON.stringify(rule.additionalTargets??[])===JSON.stringify(decision.targets.slice(1)));
    grouped.set(id,{id,target:decision.targets[0],additionalTargets:decision.targets.slice(1),terms,examples:[trace.query],count:1,reason:decision.reason,existingRuleId:existing?.id,existingRuleName:existing?.name});
  }
  return Array.from(grouped.values()).sort((a,b)=>b.count-a.count);
}
export async function reviewIntentRecommendation(id:string,action:"accept"|"dismiss",terms?:string[]) {
  const recommendation=(await listIntentRecommendations()).find(item=>item.id===id);
  if(!recommendation)throw new Error("Рекомендация уже обработана или устарела. Обновите список.");
  if(action==="accept") {
    const config=await readQueryRouting();
    const chosen=terms??recommendation.terms;
    const existing=config.rules.find(rule=>rule.id===recommendation.existingRuleId);
    if(existing)existing.terms=Array.from(new Set([...existing.terms,...chosen]));
    else config.rules.push({id:randomUUID(),name:`Вопросы: ${routeLabels[recommendation.target]}`.slice(0,120),target:recommendation.target,additionalTargets:recommendation.additionalTargets,terms:chosen,enabled:true});
    await saveQueryRouting(config);
  }
  await fs.mkdir(root,{recursive:true});
  await fs.writeFile(path.join(root,id+".json"),JSON.stringify({action,reviewedAt:new Date().toISOString()}),"utf8");
  return {success:true};
}
