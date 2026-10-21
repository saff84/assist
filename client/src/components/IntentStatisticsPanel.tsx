import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { intentStageLabels } from "@shared/intentProcessing";
import { routeLabels } from "@shared/queryRouting";
const methods={rule:"Правило",llm:"Классификатор ИИ",manual:"Ручной раздел",none:"Без классификации"};
const statuses={success:"Пройден",skipped:"Пропущен",clarification:"Нужно уточнение",error:"Ошибка"};
export function IntentStatisticsPanel() {
  const query=trpc.queryRouting.traces.useQuery();
  const [search,setSearch]=useState("");
  const [outcome,setOutcome]=useState("all");
  const [shown,setShown]=useState(20);
  const rows=(query.data??[]).filter(item=>item.query.toLowerCase().includes(search.toLowerCase())&&(outcome==="all"||item.outcome===outcome));
  return <Card><CardHeader><CardTitle>Стадии обработки интента</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">Последние 500 обращений после установки этой версии: сайт, тестовая панель и Bitrix24. Старые обращения не имеют трассировки. Время стадий может перекрываться, например поиск PDF внутри обработки артикула.</p>
    <div className="flex flex-wrap gap-3"><Input className="max-w-sm" placeholder="Найти вопрос…" value={search} onChange={e=>setSearch(e.target.value)}/><select className="border rounded-md p-2 bg-background" value={outcome} onChange={e=>setOutcome(e.target.value)} aria-label="Результат обработки"><option value="all">Все результаты</option><option value="answer">Выдан ответ</option><option value="clarification">Задано уточнение</option><option value="error">Ошибка</option></select><Button variant="outline" onClick={()=>query.refetch()}>Обновить</Button></div>
    {query.error && <p role="alert">{query.error.message}</p>}
    <p className="text-sm">Обращений: {rows.length} · По правилам: {rows.filter(row=>row.method==="rule").length} · Через классификатор ИИ: {rows.filter(row=>row.method==="llm").length} · С уточнением: {rows.filter(row=>row.outcome==="clarification").length}</p>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b"><th className="p-2">Стадия</th><th>Пройдена</th><th>Пропущена</th><th>Ошибки</th><th>Среднее время</th></tr></thead><tbody>{Object.entries(intentStageLabels).map(([key,label])=>{
      const stages=rows.map(row=>{
        const calls=row.stages.filter(stage=>stage.stage===key);
        const status=calls.some(call=>call.status==="error")?"error":calls.some(call=>call.status==="clarification")?"clarification":calls.some(call=>call.status==="success")?"success":"skipped";
        return {status,durationMs:calls.reduce((sum,call)=>sum+call.durationMs,0)};
      });
      const done=stages.filter(stage=>stage.status!=="skipped");
      return <tr key={key} className="border-b"><td className="p-2">{label}</td><td>{done.filter(stage=>stage.status!=="error").length}</td><td>{stages.filter(stage=>stage.status==="skipped").length}</td><td>{stages.filter(stage=>stage.status==="error").length}</td><td>{done.length?Math.round(done.reduce((sum,stage)=>sum+stage.durationMs,0)/done.length):0} мс</td></tr>;
    })}</tbody></table></div>
    {query.isLoading?<p>Загрузка…</p>:rows.length===0?<p>Пока нет обращений с трассировкой.</p>:null}
    {rows.slice(0,shown).map(item=><details key={item.id} className="border rounded-lg p-3"><summary className="cursor-pointer break-words">{item.query}<span className="block text-xs text-muted-foreground mt-1">{new Date(item.createdAt).toLocaleString("ru-RU")} · {item.source} · {methods[item.method]} · {item.durationMs} мс · {item.outcome==="clarification"?"Уточнение":item.outcome==="error"?"Ошибка":"Ответ"}</span></summary>
      <p className="text-sm my-3">Базы: {item.targets.map(target=>routeLabels[target as keyof typeof routeLabels]??target).join(" + ")||"не определены"}. Источников в выдаче: {item.sourceCount}.</p>
      {item.searchQuery && item.searchQuery!==item.query && <p className="text-sm mb-3 whitespace-pre-wrap">Запрос для поиска с учётом контекста: {item.searchQuery}</p>}
      {item.classification && <p className="text-sm mb-3">Решение классификатора: {item.classification.reason}. Уверенность модели: {Math.round(item.classification.confidence*100)}% (оценка модели).</p>}
      <ol className="space-y-2 text-sm">{item.stages.map((stage,index)=><li key={index} className={stage.status==="error"?"text-destructive":""}><strong>{intentStageLabels[stage.stage]}</strong>: {statuses[stage.status]} · {stage.durationMs} мс<br/>{stage.detail}</li>)}</ol>
    </details>)}
    {rows.length>shown&&<Button variant="outline" onClick={()=>setShown(shown+20)}>Показать ещё</Button>}
  </CardContent></Card>;
}
