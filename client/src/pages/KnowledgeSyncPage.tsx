import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Download,
  ExternalLink,
  FileText,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type DocType = "certificate" | "passport";
type TitleSource = "link_text" | "filename";

type SourceForm = {
  name: string;
  pageUrl: string;
  docType: DocType;
  enabled: boolean;
  hrefMustContain: string;
  fileExtension: string;
  titleSource: TitleSource;
  titleStripPrefix: string;
  linkTextMustContain: string;
};

const emptyForm = (): SourceForm => ({
  name: "",
  pageUrl: "",
  docType: "passport",
  enabled: true,
  hrefMustContain: "/upload/",
  fileExtension: ".pdf",
  titleSource: "link_text",
  titleStripPrefix: "pdf",
  linkTextMustContain: "",
});

function formFromSource(s: {
  name: string;
  pageUrl: string;
  docType: DocType;
  enabled: boolean;
  hrefMustContain: string;
  fileExtension: string;
  titleSource: TitleSource;
  titleStripPrefix: string | null;
  linkTextMustContain: string | null;
}): SourceForm {
  return {
    name: s.name,
    pageUrl: s.pageUrl,
    docType: s.docType,
    enabled: s.enabled,
    hrefMustContain: s.hrefMustContain || "/upload/",
    fileExtension: s.fileExtension || ".pdf",
    titleSource: s.titleSource || "link_text",
    titleStripPrefix: s.titleStripPrefix ?? "pdf",
    linkTextMustContain: s.linkTextMustContain ?? "",
  };
}

export default function KnowledgeSyncPage() {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<SourceForm>(emptyForm());
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<SourceForm>(emptyForm());

  const utils = trpc.useUtils();
  const { data: sources, isLoading } = trpc.document.listKnowledgeSyncSources.useQuery();
  const { data: syncStatus, refetch: refetchStatus } =
    trpc.document.getSanextSyncStatus.useQuery(undefined, {
      refetchInterval: (q) => (q.state.data?.inProgress ? 2000 : 30_000),
    });

  const { data: sourceDocs, isLoading: docsLoading } =
    trpc.document.getKnowledgeSyncSourceDocuments.useQuery(
      { sourceId: expandedId! },
      { enabled: expandedId != null }
    );

  const createMutation = trpc.document.createKnowledgeSyncSource.useMutation({
    onSuccess: async () => {
      toast.success("Источник добавлен");
      setShowCreate(false);
      setCreateForm(emptyForm());
      await utils.document.listKnowledgeSyncSources.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.document.updateKnowledgeSyncSource.useMutation({
    onSuccess: async () => {
      toast.success("Сохранено");
      setEditingId(null);
      await utils.document.listKnowledgeSyncSources.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.document.deleteKnowledgeSyncSource.useMutation({
    onSuccess: async (result) => {
      toast.success(
        `Источник удалён. Оставлено в базе: ${result.detached}, удалено битых: ${result.deletedFailed}`
      );
      if (expandedId) setExpandedId(null);
      setEditingId(null);
      await Promise.all([
        utils.document.listKnowledgeSyncSources.invalidate(),
        utils.document.listDocuments.invalidate(),
        utils.document.getKnowledgeSyncSourceDocuments.invalidate(),
      ]);
    },
    onError: (e) => toast.error(e.message),
  });

  const syncMutation = trpc.document.runSanextSync.useMutation({
    onSuccess: async (result) => {
      toast.success(
        `Синхронизация: +${result.added}, обновлено ${result.updated}, без изменений ${result.unchanged}, снято ${result.orphaned}`
      );
      if (result.errors?.length) {
        const preview = result.errors
          .slice(0, 3)
          .map((e) => e.message)
          .join("; ");
        toast.warning(
          `Предупреждения (${result.errors.length}): ${preview}${
            result.errors.length > 3 ? "…" : ""
          }`
        );
      }
      await Promise.all([
        utils.document.listKnowledgeSyncSources.invalidate(),
        utils.document.getKnowledgeSyncSourceDocuments.invalidate(),
        utils.document.listDocuments.invalidate(),
        refetchStatus(),
      ]);
    },
    onError: (e) => {
      toast.error(e.message);
      void refetchStatus();
    },
  });

  const syncBusy = syncMutation.isPending || Boolean(syncStatus?.inProgress);

  const sortedSources = useMemo(() => sources ?? [], [sources]);

  const renderFormFields = (
    form: SourceForm,
    setForm: (next: SourceForm) => void,
    idPrefix: string
  ) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-name`}>Название пункта</Label>
        <Input
          id={`${idPrefix}-name`}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Напр. Технические паспорта"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-url`}>Страница для парсинга (URL)</Label>
        <Input
          id={`${idPrefix}-url`}
          value={form.pageUrl}
          onChange={(e) => setForm({ ...form, pageUrl: e.target.value })}
          placeholder="https://www.sanext.ru/baza-znaniy/…"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Тип документов</Label>
        <Select
          value={form.docType}
          onValueChange={(v) => setForm({ ...form, docType: v as DocType })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="passport">Паспорта</SelectItem>
            <SelectItem value="certificate">Сертификаты</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Откуда брать название</Label>
        <Select
          value={form.titleSource}
          onValueChange={(v) => setForm({ ...form, titleSource: v as TitleSource })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="link_text">Текст ссылки на странице</SelectItem>
            <SelectItem value="filename">Имя файла PDF</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-href`}>Ссылка должна содержать</Label>
        <Input
          id={`${idPrefix}-href`}
          value={form.hrefMustContain}
          onChange={(e) => setForm({ ...form, hrefMustContain: e.target.value })}
          placeholder="/upload/"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-ext`}>Расширение файла</Label>
        <Input
          id={`${idPrefix}-ext`}
          value={form.fileExtension}
          onChange={(e) => setForm({ ...form, fileExtension: e.target.value })}
          placeholder=".pdf"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-strip`}>Убрать префикс из названия</Label>
        <Input
          id={`${idPrefix}-strip`}
          value={form.titleStripPrefix}
          onChange={(e) => setForm({ ...form, titleStripPrefix: e.target.value })}
          placeholder="pdf"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-text`}>Текст ссылки должен содержать</Label>
        <Input
          id={`${idPrefix}-text`}
          value={form.linkTextMustContain}
          onChange={(e) => setForm({ ...form, linkTextMustContain: e.target.value })}
          placeholder="опционально, напр. Паспорт"
        />
      </div>
      <div className="flex items-center gap-2 sm:col-span-2 pt-1">
        <Switch
          checked={form.enabled}
          onCheckedChange={(v) => setForm({ ...form, enabled: v })}
          id={`${idPrefix}-enabled`}
        />
        <Label htmlFor={`${idPrefix}-enabled`}>Участвует в автоматической синхронизации</Label>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Синхронизация с сайта</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Укажите страницы для парсинга и правила отбора ссылок. В каждом пункте — список уже
            скачанных документов. Поиск в чате идёт по названию файла.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="gap-2"
            disabled={syncBusy}
            onClick={() => syncMutation.mutate(undefined)}
          >
            {syncBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Синхронизировать все
          </Button>
          <Button
            className="gap-2"
            onClick={() => {
              setShowCreate(true);
              setCreateForm(emptyForm());
            }}
          >
            <Plus className="h-4 w-4" />
            Добавить источник
          </Button>
        </div>
      </div>

      {(syncStatus?.lastRunAt || syncStatus?.lastError) && (
        <div className="text-xs text-muted-foreground -mt-2 space-y-1">
          <p>
            Последний прогон:{" "}
            {syncStatus.lastRunAt
              ? new Date(syncStatus.lastRunAt).toLocaleString()
              : "—"}
            {syncStatus.lastResult
              ? ` (+${syncStatus.lastResult.added} / ~${syncStatus.lastResult.updated} / =${syncStatus.lastResult.unchanged})`
              : ""}
            {syncStatus.lastError ? ` · ошибка: ${syncStatus.lastError}` : ""}
          </p>
          {syncStatus.lastResult?.errors?.length ? (
            <ul className="list-disc list-inside text-amber-700 dark:text-amber-400 max-h-24 overflow-auto">
              {syncStatus.lastResult.errors.slice(0, 8).map((e, i) => (
                <li key={`${e.url ?? ""}-${i}`}>
                  {e.url ? `${e.url}: ` : ""}
                  {e.message}
                </li>
              ))}
              {syncStatus.lastResult.errors.length > 8 ? (
                <li>…и ещё {syncStatus.lastResult.errors.length - 8}</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      )}

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle>Новый источник</CardTitle>
            <CardDescription>
              URL страницы и правила: какие ссылки качать и как назвать документ.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {renderFormFields(createForm, setCreateForm, "create")}
            <div className="flex gap-2">
              <Button
                disabled={createMutation.isPending || !createForm.name.trim() || !createForm.pageUrl.trim()}
                onClick={() =>
                  createMutation.mutate({
                    name: createForm.name,
                    pageUrl: createForm.pageUrl,
                    docType: createForm.docType,
                    enabled: createForm.enabled,
                    hrefMustContain: createForm.hrefMustContain,
                    fileExtension: createForm.fileExtension,
                    titleSource: createForm.titleSource,
                    titleStripPrefix: createForm.titleStripPrefix || null,
                    linkTextMustContain: createForm.linkTextMustContain.trim() || null,
                  })
                }
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Создать"
                )}
              </Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>
                Отмена
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
          Загрузка источников…
        </div>
      ) : (
        <div className="space-y-4">
          {sortedSources.map((source) => {
            const open = expandedId === source.id;
            const editing = editingId === source.id;
            return (
              <Card
                key={source.id}
                className={cn(!source.enabled && "opacity-75 border-dashed")}
              >
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-lg">{source.name}</CardTitle>
                        <Badge variant="outline">
                          {source.docType === "passport" ? "Паспорта" : "Сертификаты"}
                        </Badge>
                        {!source.enabled && <Badge variant="secondary">Выкл.</Badge>}
                        <Badge variant="secondary">
                          {source.documentsCount} док.
                        </Badge>
                      </div>
                      <CardDescription className="break-all">
                        <a
                          href={source.pageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 hover:underline"
                        >
                          {source.pageUrl}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </CardDescription>
                      <p className="text-xs text-muted-foreground">
                        Название:{" "}
                        {source.titleSource === "filename"
                          ? "из имени файла"
                          : "из текста ссылки"}
                        {source.titleStripPrefix
                          ? ` · убрать префикс «${source.titleStripPrefix}»`
                          : ""}
                        {" · "}ссылка содержит «{source.hrefMustContain}», файл{" "}
                        {source.fileExtension}
                        {source.linkTextMustContain
                          ? ` · текст содержит «${source.linkTextMustContain}»`
                          : ""}
                      </p>
                      {source.lastSyncedAt && (
                        <p className="text-xs text-muted-foreground">
                          Синхр.: {new Date(source.lastSyncedAt).toLocaleString()}
                          {source.lastSyncMessage ? ` — ${source.lastSyncMessage}` : ""}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={syncBusy}
                        onClick={() => syncMutation.mutate({ sourceId: source.id })}
                      >
                        {syncBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        Синхронизировать
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setExpandedId(open ? null : source.id);
                          setEditingId(null);
                        }}
                      >
                        {open ? "Скрыть файлы" : "Показать файлы"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={syncBusy || updateMutation.isPending}
                        onClick={() => {
                          setEditingId(editing ? null : source.id);
                          setEditForm(formFromSource(source));
                          setExpandedId(source.id);
                        }}
                      >
                        {editing ? "Закрыть правку" : "Правила"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={deleteMutation.isPending || syncBusy}
                        onClick={() => {
                          if (
                            confirm(
                              `Удалить источник «${source.name}»?\n\nАктуальные и ранее снятые файлы останутся в Documents (отвяжутся).\nУдалятся только битые записи, у которых файл не удалось сохранить.`
                            )
                          ) {
                            deleteMutation.mutate({ id: source.id });
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {(editing || open) && (
                  <CardContent className="space-y-4 border-t pt-4">
                    {editing && (
                      <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                        <p className="text-sm font-medium">Правила парсинга</p>
                        {renderFormFields(editForm, setEditForm, `edit-${source.id}`)}
                        <Button
                          size="sm"
                          className="gap-1.5"
                          disabled={updateMutation.isPending || syncBusy}
                          onClick={() =>
                            updateMutation.mutate({
                              id: source.id,
                              name: editForm.name,
                              pageUrl: editForm.pageUrl,
                              docType: editForm.docType,
                              enabled: editForm.enabled,
                              hrefMustContain: editForm.hrefMustContain,
                              fileExtension: editForm.fileExtension,
                              titleSource: editForm.titleSource,
                              titleStripPrefix: editForm.titleStripPrefix || null,
                              linkTextMustContain:
                                editForm.linkTextMustContain.trim() || null,
                            })
                          }
                        >
                          {updateMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          Сохранить
                        </Button>
                      </div>
                    )}

                    {open && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          Скачанные документы
                        </p>
                        {docsLoading ? (
                          <div className="text-sm text-muted-foreground flex items-center gap-2 py-4">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Загрузка…
                          </div>
                        ) : !sourceDocs?.length ? (
                          <p className="text-sm text-muted-foreground py-2">
                            Пока пусто — нажмите «Синхронизировать».
                          </p>
                        ) : (
                          <ul className="divide-y rounded-md border max-h-80 overflow-auto">
                            {sourceDocs.map((doc) => (
                              <li
                                key={doc.id}
                                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                              >
                                <div className="min-w-0">
                                  <div className="font-medium truncate">
                                    {doc.title || doc.filename}
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate">
                                    {doc.filename}
                                    {doc.sourceSyncedAt
                                      ? ` · ${new Date(doc.sourceSyncedAt).toLocaleString()}`
                                      : ""}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Badge
                                    variant={
                                      doc.status === "indexed"
                                        ? "secondary"
                                        : doc.status === "failed"
                                          ? "destructive"
                                          : "outline"
                                    }
                                  >
                                    {doc.status}
                                  </Badge>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2"
                                    asChild
                                  >
                                    <a
                                      href={`/api/documents/${doc.id}/file?download=1`}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                    </a>
                                  </Button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}

          {!sortedSources.length && (
            <p className="text-center text-muted-foreground py-8">
              Источников нет. Добавьте страницу для парсинга.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
