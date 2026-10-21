import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { chatGreetingSchema, defaultChatGreeting, type ChatGreetingSettings } from "@shared/chatGreeting";
import { ChatGreetingContent } from "./ChatGreeting";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
export function ChatGreetingSettingsPanel() {
  const query=trpc.chatGreeting.get.useQuery(undefined,{refetchOnWindowFocus:false});
  const utils=trpc.useUtils();
  const [draft,setDraft]=useState<ChatGreetingSettings|null>(null);
  const [dirty,setDirty]=useState(false);
  useEffect(()=>{if(query.data&&!draft)setDraft(query.data);},[query.data,draft]);
  const save=trpc.chatGreeting.save.useMutation({onSuccess:settings=>{utils.chatGreeting.get.setData(undefined,settings);setDraft(settings);setDirty(false);toast.success("Приветствие сохранено для виджета и тестового окна");},onError:error=>toast.error(error.message)});
  return <Card><CardHeader><CardTitle>Приветствие помощника</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">Единый текст для рабочего виджета и тестовой панели. Расскажите, о чём бот, какие вопросы решает и какие данные помогают дать точный ответ. Поддерживаются переносы строк; HTML не выполняется. Изменения появятся при открытии чата, новом диалоге или возвращении на вкладку.</p>
    {query.error&&<p role="alert">{query.error.message}<Button variant="outline" onClick={()=>query.refetch()}>Повторить</Button></p>}
    {!draft?<p>Загрузка…</p>:<fieldset disabled={save.isPending} className="space-y-4">
      <label className="block space-y-2"><span>Описание и возможности бота</span><Textarea rows={5} maxLength={3000} value={draft.description} onChange={e=>{setDraft({...draft,description:e.target.value});setDirty(true);}}/></label>
      <label className="block space-y-2"><span>Как лучше задавать вопросы</span><Textarea rows={5} maxLength={3000} value={draft.questionHelp} onChange={e=>{setDraft({...draft,questionHelp:e.target.value});setDirty(true);}}/></label>
      <p className="text-sm font-medium">Предпросмотр приветствия</p><div className="border rounded-lg p-4 max-w-md"><ChatGreetingContent settings={draft}/></div>
      <div className="flex flex-wrap gap-3"><Button disabled={!dirty||save.isPending} onClick={()=>{const result=chatGreetingSchema.safeParse(draft);if(!result.success){toast.error(result.error.issues[0].message);return;}save.mutate(result.data);}}>{save.isPending?"Сохранение…":"Сохранить приветствие"}</Button><Button variant="outline" onClick={()=>{setDraft({...defaultChatGreeting});setDirty(true);}}>Вернуть стандартный текст</Button></div>
    </fieldset>}
  </CardContent></Card>;
}
