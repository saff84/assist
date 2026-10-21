import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { routeLabels } from "@shared/queryRouting";
import { toast } from "sonner";
export function IntentRecommendationsPanel({disabled,onApplied}:{disabled:boolean;onApplied:()=>void}) {
  const query=trpc.queryRouting.recommendations.useQuery();
  const [edits,setEdits]=useState<Record<string,string>>({});
  const review=trpc.queryRouting.review.useMutation({onSuccess:()=>{void query.refetch();onApplied();toast.success("Рекомендация обработана");},onError:error=>toast.error(error.message)});
  return <Card><CardHeader><CardTitle>Рекомендации по правилам</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">Здесь появляются предложения после уверенной классификации ИИ. Они основаны на последних 500 обращениях и не применяются автоматически. Проверьте смысл и при необходимости отредактируйте слова. {disabled?"Сначала сохраните изменения правил выше.":""}</p>
    <Button variant="outline" onClick={()=>query.refetch()}>Обновить рекомендации</Button>
    {query.error && <p role="alert">{query.error.message}</p>}
    {query.isLoading?<p>Загрузка…</p>:query.data?.length===0?<p>Новых рекомендаций нет.</p>:null}
    {query.data?.map(item=><div key={item.id} className="border rounded-lg p-4 space-y-3">
      <p className="font-medium">{[item.target,...item.additionalTargets].map(target=>routeLabels[target]).join(" + ")}</p>
      <p className="text-sm">{item.reason} · Обращений: {item.count}</p>
      {item.examples.map((example,index)=><blockquote key={index} className="text-sm border-l-2 pl-3 whitespace-pre-wrap">{example}</blockquote>)}
      <label className="block text-sm space-y-2"><span>Предлагаемые слова и фразы</span><Textarea value={edits[item.id]??item.terms.join("\n")} onChange={e=>setEdits({...edits,[item.id]:e.target.value})}/></label>
      <p className="text-sm">{item.existingRuleName?`Будет дополнено правило «${item.existingRuleName}».` : "Будет создано новое правило в конце списка приоритетов."}</p>
      <div className="flex flex-wrap gap-2"><Button disabled={disabled||review.isPending} onClick={()=>review.mutate({id:item.id,action:"accept",terms:(edits[item.id]??item.terms.join("\n")).split(/[\n,;]+/).map(term=>term.trim()).filter(Boolean)})}>Применить рекомендацию</Button><Button variant="outline" disabled={disabled||review.isPending} onClick={()=>review.mutate({id:item.id,action:"dismiss"})}>Отклонить</Button></div>
    </div>)}
  </CardContent></Card>;
}
