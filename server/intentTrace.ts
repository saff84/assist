import { AsyncLocalStorage } from "async_hooks";
import fs from "fs/promises";
import path from "path";
import { randomUUID, createHash } from "crypto";
import type { IntentStage, IntentTrace } from "../shared/intentProcessing";
const context=new AsyncLocalStorage<IntentTrace>();
export const intentTraceRoot=path.resolve("uploads","intent-traces");
export function createIntentTrace(query:string,source:string,sessionId?:string):IntentTrace {
  return {id:`${Date.now()}-${randomUUID()}`,createdAt:new Date().toISOString(),query,source,
    sessionHash:sessionId?createHash("sha256").update(source+":"+sessionId).digest("hex"):undefined,
    targets:[],method:"none",stages:[],durationMs:0,outcome:"answer",sourceCount:0};
}
export const runWithIntentTrace=<T>(trace:IntentTrace,fn:()=>Promise<T>)=>context.run(trace,fn);
export function recordIntentStage(stage:IntentStage["stage"],status:IntentStage["status"],detail:string,durationMs=0) {
  context.getStore()?.stages.push({stage,status,detail,durationMs});
}
export async function trackIntentStage<T>(stage:IntentStage["stage"],detail:string,fn:()=>Promise<T>):Promise<T> {
  const start=Date.now();
  try {const value=await fn();recordIntentStage(stage,"success",detail,Date.now()-start);return value;}
  catch(error){recordIntentStage(stage,"error",error instanceof Error?error.message:"Ошибка",Date.now()-start);throw error;}
}
export async function saveIntentTrace(trace:IntentTrace) {
  await fs.mkdir(intentTraceRoot,{recursive:true});
  const target=path.join(intentTraceRoot,trace.id+".json");
  const temp=target+".tmp";
  await fs.writeFile(temp,JSON.stringify(trace),"utf8");
  await fs.rename(temp,target);
}
export async function listIntentTraces(limit=500):Promise<IntentTrace[]> {
  let files:string[];
  try {files=await fs.readdir(intentTraceRoot);} catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}
  const names=files.filter(name=>/^\d+-[a-f0-9-]+\.json$/.test(name)).sort().reverse().slice(0,limit);
  const values=await Promise.all(names.map(async name=>{
    try{return JSON.parse(await fs.readFile(path.join(intentTraceRoot,name),"utf8")) as IntentTrace;}
    catch(error){console.warn("[Intent] Cannot read trace",name,error);return null;}
  }));
  return values.filter((value):value is IntentTrace=>value!==null);
}
