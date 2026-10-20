import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { defaultQueryRouting, queryRoutingSchema, routeLabels, type QueryRoutingConfig, type RouteTarget } from "@shared/queryRouting";

type Draft = {enabled:boolean; rules:Array<Omit<QueryRoutingConfig["rules"][number], "terms"> & {termsText:string}>};
const toDraft = (config:QueryRoutingConfig):Draft => ({...config, rules:config.rules.map(rule => ({...rule, termsText:rule.terms.join("\n")}))});
const toConfig = (draft:Draft):QueryRoutingConfig => ({...draft, rules:draft.rules.map(({termsText,...rule}) => ({...rule, terms:termsText.split(/[\n,;]+/).map(t=>t.trim()).filter(Boolean)}))});

export default function QueryRoutingPage() {
  const utils = trpc.useUtils();
  const settings = trpc.queryRouting.get.useQuery(undefined, {refetchOnWindowFocus:false});
  const [draft,setDraft] = useState<Draft | null>(null);
  const [dirty,setDirty] = useState(false);
  const [query,setQuery] = useState("монтаж трубы теплый пол по паспорту");
  const [previewText,setPreviewText] = useState("");
  useEffect(()=>{if(settings.data && !draft) setDraft(toDraft(settings.data));},[settings.data,draft]);
  const save = trpc.queryRouting.save.useMutation({
    onSuccess:config=>{utils.queryRouting.get.setData(undefined,config); setDirty(false); toast.success("Правила сохранены и применяются к новым запросам");},
    onError:error=>toast.error(error.message),
  });
  const preview = trpc.queryRouting.preview.useMutation({onError:error=>toast.error(error.message)});
  const edit = (next:Draft) => {setDraft(next); setDirty(true); setPreviewText("");};
  const validated = () => {
    const result=queryRoutingSchema.safeParse(toConfig(draft!));
    if(!result.success) {toast.error("У каждого правила должны быть название и хотя бы одно слово. Не более 50 правил и 100 слов в правиле."); return null;}
    return result.data;
  };
  if(settings.isLoading) return <p>Загрузка правил…</p>;
  if(settings.error) return <div role="alert">{settings.error.message}<Button onClick={()=>settings.refetch()}>Повторить</Button></div>;
  if(!draft) return null;
  const move = (index:number,offset:number) => {
    const rules=[...draft.rules];
    [rules[index],rules[index+offset]]=[rules[index+offset],rules[index]];
    edit({...draft,rules});
  };
  return <div className="max-w-5xl mx-auto space-y-6 pb-12">
    <div><h1 className="text-3xl font-bold">Маршрутизация вопросов</h1><p className="text-muted-foreground mt-2">Настройте, в каком разделе искать ответ по словам в запросе.</p></div>
    <Card><CardHeader><CardTitle>Как пользоваться</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
      <p>Добавьте правило, выберите раздел и перечислите слова или фразы — каждое с новой строки. Можно разделять запятыми или точками с запятой. Достаточно совпадения одного слова или фразы.</p>
      <p><strong>Словоформы:</strong> «монтаж*» найдёт «монтаж», «монтажа», «монтажные». «паспорт*» — «паспорт», «паспорта», «паспортов». Без звёздочки ищется целое слово: «монтаж» не совпадёт с «монтажа». Для фразы звёздочка применяется к последнему слову. Регистр, «ё/е» и знаки препинания не влияют.</p>
      <p><strong>Приоритет:</strong> правила проверяются сверху вниз. Побеждает первое включённое правило. Поставьте монтаж выше паспортов, чтобы «монтаж по паспорту» направлялся в монтаж.</p>
      <p>Совпадение переключает раздел, даже если в чате ранее был выбран другой. Если совпадений нет или маршрутизация выключена, сохраняется обычный выбор раздела. Поиск не расширяется на остальные разделы, если в выбранном нет ответа.</p>
      <p>«Монтаж» использует проиндексированные MD паспортов и инструкции. «Паспорта» и «Сертификаты» подбирают PDF по названию для просмотра и скачивания. Для содержательного ответа по паспорту используйте «Монтаж».</p>
      <p>Сначала проверьте правило на примере ниже, затем нажмите «Сохранить». Изменения действуют на новые запросы без пересоздания MD и перезапуска сервера.</p>
    </CardContent></Card>
    <fieldset disabled={save.isPending} className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <label className="flex items-center gap-3"><Switch checked={draft.enabled} onCheckedChange={enabled=>edit({...draft,enabled})}/>Автоматическое переключение</label>
        <Button onClick={()=>{const config=validated(); if(config) save.mutate(config);}} disabled={!dirty || save.isPending}>{save.isPending ? "Сохранение…" : "Сохранить"}{dirty ? " *" : ""}</Button>
      </div>
      {draft.rules.map((rule,index)=><Card key={rule.id}><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Правило {index+1}</CardTitle><div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={index===0} onClick={()=>move(index,-1)} aria-label={`Поднять правило ${rule.name}`}>Выше</Button>
        <Button variant="outline" size="sm" disabled={index===draft.rules.length-1} onClick={()=>move(index,1)} aria-label={`Опустить правило ${rule.name}`}>Ниже</Button>
        <Button variant="outline" size="sm" onClick={()=>edit({...draft,rules:draft.rules.filter(r=>r.id!==rule.id)})}>Удалить</Button>
      </div></div></CardHeader><CardContent className="space-y-4">
        <label className="flex items-center gap-3"><Switch checked={rule.enabled} onCheckedChange={enabled=>edit({...draft,rules:draft.rules.map(r=>r.id===rule.id?{...r,enabled}:r)})}/>Правило включено</label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2"><span>Название</span><Input maxLength={120} value={rule.name} onChange={e=>edit({...draft,rules:draft.rules.map(r=>r.id===rule.id?{...r,name:e.target.value}:r)})}/></label>
          <label className="space-y-2"><span>Раздел назначения</span><select className="flex w-full rounded-md border bg-background p-2 text-sm" value={rule.target} onChange={e=>edit({...draft,rules:draft.rules.map(r=>r.id===rule.id?{...r,target:e.target.value as RouteTarget}:r)})}>{Object.entries(routeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <label className="block space-y-2"><span>Слова, словоформы и фразы</span><Textarea rows={4} value={rule.termsText} placeholder={"монтаж*\nустановк*\nподключени*"} onChange={e=>edit({...draft,rules:draft.rules.map(r=>r.id===rule.id?{...r,termsText:e.target.value}:r)})}/></label>
      </CardContent></Card>)}
      <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={draft.rules.length>=50} onClick={()=>edit({...draft,rules:[...draft.rules,{id:crypto.randomUUID(),name:"Новое правило",target:"installation",enabled:true,termsText:""}]})}>Добавить правило</Button>
        <Button variant="outline" onClick={()=>edit(toDraft(structuredClone(defaultQueryRouting)))}>Вернуть стандартные правила</Button></div>
    </fieldset>
    <Card><CardHeader><CardTitle>Проверить переключение</CardTitle></CardHeader><CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">Проверка использует текущие поля формы, включая несохранённые изменения. Она не вызывает ИИ и не проверяет наличие документов.</p>
      <label className="block space-y-2"><span>Пример вопроса</span><Input maxLength={4000} value={query} onChange={e=>{setQuery(e.target.value);setPreviewText("");}}/></label>
      <Button disabled={!query.trim() || preview.isPending} onClick={async()=>{
        const config=validated(); if(!config) return;
        const result=await preview.mutateAsync({query,config}).catch(()=>undefined);
        if(result===undefined) return;
        setPreviewText(result ? `Вопрос «${query}» → ${routeLabels[result.target]}. Правило: «${result.ruleName}», совпадение: «${result.term}».` : "Совпадений нет или маршрутизация выключена. Будет использован обычный выбор раздела.");
      }}>{preview.isPending?"Проверка…":"Проверить"}</Button>
      <p aria-live="polite" className="text-sm whitespace-pre-wrap">{previewText}</p>
    </CardContent></Card>
  </div>;
}
