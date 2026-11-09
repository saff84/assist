import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { widgetConsentSchema, type WidgetConsentSettings } from "@shared/widgetConsent";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function WidgetConsentSettingsPanel() {
  const query = trpc.widget.getConsent.useQuery(undefined, { refetchOnWindowFocus: false });
  const [draft, setDraft] = useState<WidgetConsentSettings | null>(null);
  const utils = trpc.useUtils();
  const save = trpc.widget.saveConsent.useMutation({
    onSuccess: value => {
      utils.widget.getConsent.setData(undefined, value);
      setDraft(null);
      toast.success("Настройки согласия сохранены");
    },
    onError: error => toast.error(error.message),
  });
  const value = draft ?? query.data;
  const update = (patch: Partial<WidgetConsentSettings>) => { if (value) setDraft({ ...value, ...patch }); };
  return <Card>
    <CardHeader><CardTitle>Согласие на обработку персональных данных</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Если включено, после первого вопроса виджет предложит дать согласие. До нажатия кнопки вопрос остаётся в браузере. После согласия он отправится автоматически. Для нового диалога согласие запрашивается заново.</p>
      {query.error && <p role="alert">{query.error.message} <Button variant="outline" onClick={() => query.refetch()}>Повторить</Button></p>}
      {!value ? <p>Загрузка…</p> : <fieldset disabled={save.isPending} className="space-y-4">
        <label className="flex items-center gap-3"><input type="checkbox" checked={value.enabled} onChange={e => update({ enabled: e.target.checked })} /><span>Запрашивать согласие перед ответом</span></label>
        <label className="block space-y-2"><span>Текст согласия</span><Textarea rows={10} maxLength={12000} value={value.text} onChange={e => update({ text: e.target.value })} /></label>
        <p className="text-sm text-muted-foreground">Замените поля в квадратных скобках данными своей компании и обработчиков. Текст можно полностью отредактировать, включая срок обработки.</p>
        <label className="block space-y-2"><span>Ссылка на политику обработки персональных данных</span><Input type="url" value={value.policyUrl} placeholder="https://example.com/privacy" onChange={e => update({ policyUrl: e.target.value })} /></label>
        <div className="rounded-xl border bg-muted/30 p-4 max-w-md space-y-3">
          <p className="text-sm whitespace-pre-wrap break-words">{value.text}</p>
          {value.policyUrl && <p className="text-sm break-all text-blue-600">{value.policyUrl}</p>}
          <div className="rounded-full bg-primary text-primary-foreground text-center py-3 font-bold">ДАЮ СОГЛАСИЕ</div>
        </div>
        <Button disabled={!draft || save.isPending} onClick={() => {
          const parsed = widgetConsentSchema.safeParse(value);
          if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
          save.mutate(parsed.data);
        }}>{save.isPending ? "Сохранение…" : "Сохранить настройки согласия"}</Button>
      </fieldset>}
    </CardContent>
  </Card>;
}
