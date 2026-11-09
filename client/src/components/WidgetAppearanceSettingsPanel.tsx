import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { widgetAppearanceSchema, type WidgetAppearance } from "@shared/widgetAppearance";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function WidgetAppearanceSettingsPanel() {
  const query = trpc.widget.getAppearance.useQuery(undefined, { refetchOnWindowFocus: false });
  const [draft, setDraft] = useState<WidgetAppearance | null>(null);
  const [isReadingLogo, setIsReadingLogo] = useState(false);
  const utils = trpc.useUtils();
  const save = trpc.widget.saveAppearance.useMutation({
    onSuccess: value => {
      utils.widget.getAppearance.setData(undefined, value);
      setDraft(null);
      toast.success("Шапка виджета сохранена");
    },
    onError: error => toast.error(error.message),
  });
  const value = draft ?? query.data;
  const update = (patch: Partial<WidgetAppearance>) => { if (value) setDraft({ ...value, ...patch }); };
  return <Card>
    <CardHeader><CardTitle>Шапка виджета</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Изменения появятся на подключённых сайтах при следующем открытии чата. Если в коде сайта явно заданы title и subtitle, они имеют приоритет — уберите их, чтобы использовать эти настройки.</p>
      {query.error && <p role="alert">{query.error.message} <Button variant="outline" onClick={() => query.refetch()}>Повторить</Button></p>}
      {!value ? <p>Загрузка…</p> : <fieldset disabled={save.isPending || isReadingLogo} className="space-y-4">
        <label className="block space-y-2"><span>Надпись над названием</span><Input maxLength={60} value={value.brand} onChange={e => update({ brand: e.target.value })} /></label>
        <label className="block space-y-2"><span>Название ассистента</span><Input maxLength={100} value={value.title} onChange={e => update({ title: e.target.value })} /></label>
        <label className="block space-y-2"><span>Подзаголовок</span><Input maxLength={200} value={value.subtitle} onChange={e => update({ subtitle: e.target.value })} /></label>
        <label className="block space-y-2"><span>HTTPS-ссылка на логотип</span><Input type="url" value={value.logoUrl.startsWith("data:") ? "" : value.logoUrl} placeholder="https://example.com/logo.png" onChange={e => update({ logoUrl: e.target.value })} /></label>
        <label className="block space-y-2"><span>Или загрузите логотип (PNG, JPEG, WebP, до 500 КБ)</span><Input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size > 500 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
            toast.error("Выберите PNG, JPEG или WebP до 500 КБ"); return;
          }
          setIsReadingLogo(true);
          try {
            const logoUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
              reader.readAsDataURL(file);
            });
            setDraft(current => ({ ...(current ?? value), logoUrl }));
          } catch { toast.error("Не удалось прочитать логотип"); }
          finally { setIsReadingLogo(false); }
        }} /></label>
        {isReadingLogo && <p role="status" className="text-sm text-muted-foreground">Чтение логотипа…</p>}
        {value.logoUrl && <Button variant="outline" onClick={() => update({ logoUrl: "" })}>Удалить логотип</Button>}
        <p className="text-sm font-medium">Предпросмотр шапки</p>
        <div className="flex items-center gap-3 rounded-xl p-5 text-white max-w-md" style={{ background: "linear-gradient(135deg, #2f343c, #3d8fb0)" }}>
          {value.logoUrl && widgetAppearanceSchema.safeParse(value).success && <img src={value.logoUrl} alt="Логотип ассистента" className="w-12 h-12 rounded-lg bg-white object-contain p-1 shrink-0" />}
          <div className="min-w-0 break-words"><div className="text-xs uppercase tracking-widest opacity-70">{value.brand}</div><div className="text-lg font-bold">{value.title}</div><div className="text-sm opacity-90">{value.subtitle}</div></div>
        </div>
        <Button disabled={!draft || save.isPending || isReadingLogo} onClick={() => {
          const parsed = widgetAppearanceSchema.safeParse(value);
          if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
          save.mutate(parsed.data);
        }}>{save.isPending ? "Сохранение…" : "Сохранить шапку"}</Button>
      </fieldset>}
    </CardContent>
  </Card>;
}
