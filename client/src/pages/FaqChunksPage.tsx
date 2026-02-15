import { useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, Trash2, Search, Plus, X, Pencil } from "lucide-react";
import { toast } from "sonner";

type UploadedImage = {
  key: string;
  filename: string;
  mimeType: string;
  url: string;
};

async function uploadFaqImage(file: File): Promise<UploadedImage> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/faq-images/upload", { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Upload failed (${res.status})`);
  }
  return (await res.json()) as UploadedImage;
}

export default function FaqChunksPage() {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [existingImages, setExistingImages] = useState<UploadedImage[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const listQuery = trpc.faq.list.useQuery(
    { search: search.trim() || undefined },
    { staleTime: 10_000, refetchOnWindowFocus: false }
  );

  const createMutation = trpc.faq.create.useMutation({
    onSuccess: () => {
      toast.success("FAQ-чанк сохранён");
      setTitle("");
      setAnswerText("");
      setExistingImages([]);
      setSelectedFiles([]);
      listQuery.refetch();
    },
    onError: (e) => toast.error(e.message || "Не удалось сохранить FAQ-чанк"),
  });

  const updateMutation = trpc.faq.update.useMutation({
    onSuccess: () => {
      toast.success("FAQ-чанк обновлён");
      setEditingId(null);
      setTitle("");
      setAnswerText("");
      setExistingImages([]);
      setSelectedFiles([]);
      listQuery.refetch();
    },
    onError: (e) => toast.error(e.message || "Не удалось обновить FAQ-чанк"),
  });

  const deleteMutation = trpc.faq.delete.useMutation({
    onSuccess: () => {
      toast.success("FAQ-чанк удалён");
      listQuery.refetch();
    },
    onError: (e) => toast.error(e.message || "Не удалось удалить FAQ-чанк"),
  });

  const previews = useMemo(
    () =>
      selectedFiles.map((f) => ({
        file: f,
        url: URL.createObjectURL(f),
      })),
    [selectedFiles]
  );

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const handlePickFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (next.length === 0) {
      toast.error("Выберите изображения (png/jpg/webp/gif)");
      return;
    }
    setSelectedFiles((prev) => [...prev, ...next].slice(0, 12));
  };

  const handleRemoveSelected = (idx: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleRemoveExistingImage = (idx: number) => {
    setExistingImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    const t = title.trim();
    const a = answerText.trim();
    if (t.length < 3) return toast.error("Заголовок слишком короткий");
    if (a.length < 3) return toast.error("Ответ слишком короткий");

    try {
      let uploaded: UploadedImage[] = [];
      if (selectedFiles.length > 0) {
        toast.message("Загружаю изображения…");
        uploaded = await Promise.all(selectedFiles.map(uploadFaqImage));
      }
      const mergedImages = [...existingImages, ...uploaded].slice(0, 12);

      if (editingId) {
        updateMutation.mutate({
          id: editingId,
          title: t,
          answerText: a,
          images: mergedImages.length ? mergedImages : undefined,
        });
      } else {
        createMutation.mutate({
          title: t,
          answerText: a,
          images: mergedImages.length ? mergedImages : undefined,
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить изображения");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">FAQ-чанки (ручной ввод)</h1>
          <p className="text-muted-foreground">
            Создавайте пары «проблема → ответ» (с текстом и картинками) для выдачи в чате.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              {editingId ? "Редактирование FAQ-чанка" : "Новый FAQ-чанк"}
            </CardTitle>
            <CardDescription>
              Заголовок — это формулировка проблемы, с которой пишут в чат. Ответ можно писать в Markdown.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">Заголовок (проблема)</div>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: Экран теплосчётчика не показывает" />
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Ответ</div>
              <Textarea
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                placeholder="Напишите инструкцию/скрипт ответа. Можно списки, ссылки, и т.д."
                className="min-h-48"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Картинки к ответу (до 12)</div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSaving}
                >
                  <Upload className="h-4 w-4" />
                  Добавить
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handlePickFiles(e.target.files)}
              />

              {editingId && existingImages.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">
                    Уже прикреплено: {existingImages.length}
                  </div>
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                    {existingImages.map((img, idx) => (
                      <div key={`${img.key}-${idx}`} className="relative group">
                        <img
                          src={img.url}
                          alt={img.filename}
                          className="h-20 w-full rounded-md object-cover border"
                        />
                        <button
                          type="button"
                          className="absolute top-1 right-1 rounded-md bg-background/80 border px-1.5 py-1 opacity-0 group-hover:opacity-100 transition"
                          onClick={() => handleRemoveExistingImage(idx)}
                          title="Убрать"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {previews.length > 0 && (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {previews.map((p, idx) => (
                    <div key={`${p.file.name}-${idx}`} className="relative group">
                      <img
                        src={p.url}
                        alt={p.file.name}
                        className="h-20 w-full rounded-md object-cover border"
                      />
                      <button
                        type="button"
                        className="absolute top-1 right-1 rounded-md bg-background/80 border px-1.5 py-1 opacity-0 group-hover:opacity-100 transition"
                        onClick={() => handleRemoveSelected(idx)}
                        title="Убрать"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSubmit} disabled={isSaving} className="gap-2">
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {editingId ? "Сохранение…" : "Сохранение…"}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    {editingId ? "Сохранить изменения" : "Сохранить"}
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={() => {
                  setEditingId(null);
                  setTitle("");
                  setAnswerText("");
                  setExistingImages([]);
                  setSelectedFiles([]);
                }}
              >
                {editingId ? "Отмена" : "Очистить"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Список FAQ-чанков
            </CardTitle>
            <CardDescription>
              Поиск по заголовку и тексту ответа.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск…"
              />
              <Button variant="outline" onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}>
                Обновить
              </Button>
            </div>

            {listQuery.isLoading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : listQuery.data && listQuery.data.length > 0 ? (
              <div className="space-y-3">
                {listQuery.data.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{entry.title}</div>
                        <div className="text-xs text-muted-foreground">
                          Обновлено: {new Date(entry.updatedAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => {
                            setEditingId(entry.id);
                            setTitle(entry.title);
                            setAnswerText(entry.answerText);
                            setExistingImages(
                              Array.isArray(entry.images) ? (entry.images as UploadedImage[]) : []
                            );
                            setSelectedFiles([]);
                            toast.message("Открыто редактирование FAQ-чанка");
                          }}
                          disabled={isSaving}
                          title="Редактировать"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => deleteMutation.mutate({ id: entry.id })}
                          disabled={deleteMutation.isPending}
                          title="Удалить"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                      {entry.answerText}
                    </div>

                    {Array.isArray(entry.images) && entry.images.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">
                          Картинок: {entry.images.length}
                        </Badge>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Пока нет FAQ-чанков.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

