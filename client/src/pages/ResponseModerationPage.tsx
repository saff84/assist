import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { defaultResponseModeration, moderationLines, responseModerationSchema, type ResponseModerationSettings } from "@shared/responseModeration";
import { ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function ResponseModerationPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();
  const settings = trpc.responseModeration.get.useQuery(undefined, { enabled: isAdmin, refetchOnWindowFocus: false });
  const events = trpc.responseModeration.events.useQuery(undefined, { enabled: isAdmin, refetchOnWindowFocus: false });
  const [draft, setDraft] = useState<ResponseModerationSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sample, setSample] = useState("");
  const preview = trpc.responseModeration.preview.useMutation();
  useEffect(() => { if (settings.data && !draft) setDraft({ ...settings.data }); }, [settings.data, draft]);
  const save = trpc.responseModeration.save.useMutation({
    onSuccess: value => {
      utils.responseModeration.get.setData(undefined, value);
      setDraft({ ...value }); setDirty(false);
      toast.success("Модерация сохранена и применяется к новым ответам");
    }, onError: error => toast.error(error.message),
  });
  function edit(value: ResponseModerationSettings) { setDraft(value); setDirty(true); preview.reset(); }
  function parsedDraft() {
    const result = responseModerationSchema.safeParse(draft);
    if (!result.success) { toast.error(result.error.issues[0]?.message ?? "Проверьте настройки"); return null; }
    return result.data;
  }
  if (!isAdmin) return <div className="p-6">Раздел доступен только администратору.</div>;
  if (settings.isLoading) return <div className="flex items-center gap-2 p-8"><Loader2 className="h-5 w-5 animate-spin" />Загрузка модерации…</div>;
  return <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8">
    <div className="flex items-start gap-3"><ShieldCheck className="mt-1 h-7 w-7 text-primary" /><div>
      <h1 className="text-2xl font-semibold">Модерация ответов</h1>
      <p className="mt-1 text-sm text-muted-foreground">Проверка исходящих ответов в виджете, тестовой панели и Bitrix24. Без дополнительной модели и запросов к Ollama.</p>
    </div></div>
    {settings.error && <div role="alert" className="rounded-lg border border-destructive p-4 text-sm">
      {settings.error.message} При ошибке чтения настроек пользователям выдаётся нейтральный запасной ответ.
    </div>}
    <Button variant="outline" onClick={() => edit({ ...defaultResponseModeration })} disabled={save.isPending}>Загрузить начальный словарь в форму</Button>
    {draft && <>
      <Card><CardHeader><CardTitle>Защита исходящих ответов</CardTitle></CardHeader><CardContent className="space-y-4">
        <label className="flex items-center gap-3"><Switch disabled={save.isPending} checked={draft.enabled} onCheckedChange={enabled => edit({ ...draft, enabled })} aria-label="Включить модерацию ответов" />
          <span>{draft.enabled ? "Фильтр включён" : "Фильтр выключен"}</span></label>
        <p className="text-sm text-muted-foreground">При совпадении весь ответ заменяется нейтральным текстом; ссылки и отладочный контекст этого ответа не отправляются. Вопросы пользователей не блокируются этим фильтром. Фильтр распознаёт словоформы и простые маскировки, но не оценивает завуалированные оскорбления по смыслу.</p>
      </CardContent></Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Слова и выражения · {moderationLines(draft.terms).length}</CardTitle></CardHeader><CardContent className="space-y-3">
          <label className="block space-y-2"><span className="text-sm">Одна запись на строку</span>
            <Textarea disabled={save.isPending} rows={16} maxLength={20000} value={draft.terms} onChange={event => edit({ ...draft, terms: event.target.value })} spellCheck={false} aria-label="Запрещённые слова и выражения" /></label>
          <p className="text-sm text-muted-foreground">Для обычных слов учитываются распространённые падежные окончания и формы прилагательных. Например: «идиот» → «идиота», «идиотами». Основа с * охватывает любые продолжения слова. Для нестандартных форм добавляйте отдельные записи или основы. Не используйте слишком короткие основы.</p>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Исключения</CardTitle></CardHeader><CardContent className="space-y-3">
          <label className="block space-y-2"><span className="text-sm">Точные разрешённые слова или фразы, по одному на строку</span>
            <Textarea disabled={save.isPending} rows={9} maxLength={20000} value={draft.exceptions} onChange={event => edit({ ...draft, exceptions: event.target.value })} spellCheck={false} aria-label="Исключения модерации" /></label>
          <p className="text-sm text-muted-foreground">Исключение действует только на совпавшее слово или фразу. Другие запрещённые выражения в том же ответе по-прежнему блокируются. Исключения не используют *.</p>
          <label className="block space-y-2"><span className="text-sm font-medium">Запасной ответ</span>
            <Textarea disabled={save.isPending} rows={4} maxLength={1000} value={draft.fallback} onChange={event => edit({ ...draft, fallback: event.target.value })} aria-label="Запасной ответ модерации" /></label>
          <p className="text-sm text-muted-foreground">Запасной ответ также проверяется по вашему словарю при сохранении.</p>
        </CardContent></Card>
      </div>
      <div className="flex items-center gap-3"><Button disabled={!dirty || save.isPending} onClick={() => { const value = parsedDraft(); if (value) save.mutate(value); }}>
        {save.isPending ? "Сохранение…" : "Сохранить настройки"}</Button><span className="text-sm text-muted-foreground">{dirty ? "Есть несохранённые изменения" : "Настройки сохранены"}</span></div>
      <Card><CardHeader><CardTitle>Проверить пример ответа</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Проверка использует текущую форму, включая несохранённые изменения. Пример не записывается в журнал и не отправляется модели.</p>
        <Textarea rows={4} maxLength={12000} value={sample} onChange={event => { setSample(event.target.value); preview.reset(); }} placeholder="Введите пример ответа для проверки" aria-label="Текст для проверки модерации" />
        <Button variant="outline" disabled={!sample.trim() || preview.isPending} onClick={() => { const value = parsedDraft(); if (value) preview.mutate({ text: sample, settings: value }); }}>{preview.isPending ? "Проверка…" : "Проверить"}</Button>
        {preview.error && <p role="alert" className="text-sm text-destructive">{preview.error.message}</p>}
        {preview.data && <div role="status" className="space-y-2 rounded-lg border p-4 text-sm">
          <p className="font-medium">{!draft.enabled ? "Фильтр выключен: текст пройдёт без проверки" : preview.data.blocked ? "Ответ будет заменён" : "Запрещённых выражений не найдено"}</p>
          {preview.data.rules.length > 0 && <p>Правила: {preview.data.rules.join(", ")}</p>}
          <p className="whitespace-pre-wrap">{preview.data.response}</p>
        </div>}
      </CardContent></Card>
    </>}
    <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>Последние срабатывания</CardTitle>
      <Button variant="outline" size="sm" onClick={() => events.refetch()} disabled={events.isFetching}>Обновить</Button></CardHeader><CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">Последние 100 событий за 30 дней. Исходные вопросы и ответы в журнал не записываются; сохраняются канал, причина и сработавшие правила.</p>
      {events.error && <p role="alert" className="text-sm text-destructive">{events.error.message}</p>}
      {!events.isLoading && !events.error && events.data?.length === 0 && <p className="text-sm text-muted-foreground">Срабатываний пока нет.</p>}
      {events.data?.map(event => <div key={event.id} className="rounded-lg border p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><span>{new Date(event.at).toLocaleString("ru-RU")}</span><span>{({ website: "Виджет", bitrix24: "Bitrix24", test: "Тестовая панель" })[event.channel]}</span></div>
        <p className="mt-1">{event.reason === "settings_error" ? "Ошибка настроек: выдан безопасный ответ" : event.reason === "too_long" ? "Превышен размер проверяемого ответа" : `Правила: ${event.rules.join(", ")}`}</p>
      </div>)}
    </CardContent></Card>
  </div>;
}
