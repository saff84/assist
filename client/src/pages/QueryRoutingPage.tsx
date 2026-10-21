import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { IntentRecommendationsPanel } from "@/components/IntentRecommendationsPanel";
import { defaultQueryRouting, queryRoutingSchema, routeLabels, type QueryRoutingConfig, type RouteTarget } from "@shared/queryRouting";

type Draft = {enabled:boolean; fallback:QueryRoutingConfig["fallback"]; rules:Array<Omit<QueryRoutingConfig["rules"][number], "terms"> & {termsText:string}>};
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
      <p>Правила проверяются первыми. Если совпадений нет, ИИ определяет тему и выбирает нужные базы. Если вопрос неоднозначен, задаёт конкретное уточнение. В режиме «О компании» без совпадения используется только база компании. Выключение автоматического переключения сохраняет ручной раздел или базу компании.</p>
      <p>После определения темы ИИ предлагает дополнения к правилам в блоке рекомендаций ниже. Администратор проверяет и применяет их вручную. Подробные стадии каждого обращения доступны в разделе «Статистика».</p>
      <p>«Монтаж» использует проиндексированные MD паспортов и инструкции. «Паспорта» и «Сертификаты» подбирают PDF по названию для просмотра и скачивания. Для содержательного ответа по паспорту используйте «Монтаж».</p>
      <p><strong>Поиск по артикулу:</strong> «мне нужен сертификат на 5905» или «мне нужен паспорт на 5905» сначала ищет точный артикул в проиндексированных товарах каталога, определяет товарную группу, затем ищет PDF по её названию. Поддерживаются числовые артикулы из 4–8 цифр. Если группа не назначена, используется название товара — это будет указано в ответе. При неоднозначности система попросит уточнение. Совпадение названия документа не подтверждает его применимость ко всем артикулам группы.</p>
      <p>Сначала проверьте правило на примере ниже, затем нажмите «Сохранить». Изменения действуют на новые запросы без пересоздания MD и перезапуска сервера.</p>
    </CardContent></Card>
    <fieldset disabled={save.isPending} className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <label className="flex items-center gap-3"><Switch checked={draft.enabled} onCheckedChange={enabled=>edit({...draft,enabled})}/>Автоматическое переключение</label>
        <Button onClick={()=>{const config=validated(); if(config) save.mutate(config);}} disabled={!dirty || save.isPending}>{save.isPending ? "Сохранение…" : "Сохранить"}{dirty ? " *" : ""}</Button>
      </div>
      <label className="block space-y-2"><span>Если ни одно правило не совпало</span><select className="border rounded-md p-2 w-full bg-background" value={draft.fallback} onChange={e=>edit({...draft,fallback:e.target.value as Draft["fallback"]})}><option value="llm">Определять тему через ИИ и при необходимости уточнять вопрос</option><option value="company">Искать в базе «О компании»</option></select></label>
      {draft.rules.map((rule,index)=><Card key={rule.id}><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Правило {index+1}</CardTitle><div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={index===0} onClick={()=>move(index,-1)} aria-label={`Поднять правило ${rule.name}`}>Выше</Button>
        <Button variant="outline" size="sm" disabled={index===draft.rules.length-1} onClick={()=>move(index,1)} aria-label={`Опустить правило ${rule.name}`}>Ниже</Button>
        <Button variant="outline" size="sm" onClick={()=>edit({...draft,rules:draft.rules.filter(r=>r.id!==rule.id)})}>Удалить</Button>
      </div></div></CardHeader><CardContent className="space-y-4">
        <label className="flex items-center gap-3"><Switch checked={rule.enabled} onCheckedChange={enabled=>edit({...draft,rules:draft.rules.map(r=>r.id===rule.id?{...r,enabled}:r)})}/>Правило включено</label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2"><span>Название</span><Input maxLength={120} value={rule.name} onChange={e=>edit({...draft,rules:draft.rules.map(r=>r.id===rule.id?{...r,name:e.target.value}:r)})}/></label>
          <label className="space-y-2"><span>Раздел назначения</span><select className="flex w-full rounded-md border bg-background p-2 text-sm" value={rule.target} onChange={e=>edit({...draft,rules:draft.rules.map(r=>r.id===rule.id?{...r,target:e.target.value as RouteTarget,additionalTargets:[]}:r)})}>{Object.entries(routeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <div className="space-y-2"><p className="text-sm">Дополнительные базы для этого правила</p><div className="flex flex-wrap gap-3">{Object.entries(routeLabels).filter(([target])=>target!==rule.target && ["catalog","instruction","installation","warranty_faq"].includes(target) && ["catalog","instruction","installation","warranty_faq"].includes(rule.target)).map(([target,label])=><label key={target} className="text-sm flex items-center gap-2"><input type="checkbox" checked={rule.additionalTargets?.includes(target as RouteTarget)??false} onChange={e=>edit({...draft,rules:draft.rules.map(r=>r.id===rule.id?{...r,additionalTargets:e.target.checked?[...(r.additionalTargets??[]),target as RouteTarget]:(r.additionalTargets??[]).filter(value=>value!==target)}:r)})}/>{label}</label>)}</div><p className="text-xs text-muted-foreground">Для паспортов и сертификатов используется только основной раздел — поиск PDF. Дополнительные базы применяются к содержательным ответам.</p></div>
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
        setPreviewText(result ? `Вопрос «${query}» → ${[result.target,...result.additionalTargets].map(target=>routeLabels[target]).join(" + ")}. Правило: «${result.ruleName}», совпадение: «${result.term}».` : draft.enabled && draft.fallback==="llm" ? "Правило не совпало. В реальном запросе тему определит ИИ; эта проверка ИИ не вызывает." : "Правило не совпало. Будет использован ручной раздел или база компании.");
      }}>{preview.isPending?"Проверка…":"Проверить"}</Button>
      <p aria-live="polite" className="text-sm whitespace-pre-wrap">{previewText}</p>
    </CardContent></Card>
    <IntentRecommendationsPanel disabled={dirty||save.isPending} onApplied={()=>{void settings.refetch().then(result=>{if(result.data)setDraft(toDraft(result.data));});}}/>
  </div>;
}
