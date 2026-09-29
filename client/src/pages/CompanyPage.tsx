import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, Trash2, Download, RefreshCw, Building2 } from "lucide-react";
import { toast } from "sonner";

type CompanySection = {
  id: string;
  title: string;
  filename: string;
  sourceType: "upload" | "paste";
  documentId: number | null;
  createdAt: string;
  charCount: number;
};

type Stats = {
  sectionCount: number;
  charCount: number;
  estimatedTokens: number;
  path: string;
};

export default function CompanyPage() {
  const [sections, setSections] = useState<CompanySection[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [assembledPreview, setAssembledPreview] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, mdRes] = await Promise.all([
        fetch("/api/company/sections"),
        fetch("/api/company/assembled"),
      ]);
      if (!listRes.ok) throw new Error("Не удалось загрузить список секций");
      if (!mdRes.ok) throw new Error("Не удалось загрузить сборный MD");
      const listJson = (await listRes.json()) as {
        sections: CompanySection[];
        stats: Stats;
      };
      const mdJson = (await mdRes.json()) as { markdown: string; stats: Stats };
      setSections(listJson.sections ?? []);
      setStats(mdJson.stats ?? listJson.stats);
      setAssembledPreview(mdJson.markdown ?? "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (uploadTitle.trim()) form.append("title", uploadTitle.trim());
      const res = await fetch("/api/company/upload", {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Ошибка загрузки (${res.status})`);
      }
      toast.success("Файл добавлен в базу «О компании»");
      setUploadTitle("");
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка загрузки");
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = async () => {
    if (!pasteTitle.trim() || !pasteText.trim()) {
      toast.error("Укажите заголовок и текст");
      return;
    }
    setPasting(true);
    try {
      const res = await fetch("/api/company/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: pasteTitle.trim(), text: pasteText }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Ошибка сохранения (${res.status})`);
      }
      toast.success("Текст добавлен");
      setPasteTitle("");
      setPasteText("");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка сохранения");
    } finally {
      setPasting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить эту секцию из базы «О компании»?")) return;
    try {
      const res = await fetch(`/api/company/sections/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Не удалось удалить");
      toast.success("Секция удалена");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка удаления");
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Building2 className="w-6 h-6" />
            О компании
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Материалы для общих вопросов в чате (без выбора категории). Файлы
            конвертируются в Markdown и собираются в один файл; при небольшом
            объёме он целиком уходит в модель.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Обновить
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="/api/company/assembled?download=1">
              <Download className="w-4 h-4 mr-1" />
              Скачать MD
            </a>
          </Button>
        </div>
      </div>

      {stats && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary">Секций: {stats.sectionCount}</Badge>
          <Badge variant="secondary">Символов: {stats.charCount}</Badge>
          <Badge variant="secondary">~{stats.estimatedTokens} токенов</Badge>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Загрузить файл</CardTitle>
            <CardDescription>PDF, DOCX, MD, TXT, XLSX</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Заголовок секции (необязательно)"
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
            />
            <Input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.md,.markdown,.txt,.xlsx"
              onChange={(e) => void handleUpload(e.target.files?.[0] ?? null)}
              disabled={uploading}
            />
            {uploading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Обработка и индексация…
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Вставить текст</CardTitle>
            <CardDescription>Произвольный фрагмент о компании</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Заголовок"
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
            />
            <Textarea
              placeholder="Текст…"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={8}
            />
            <Button onClick={() => void handlePaste()} disabled={pasting}>
              {pasting ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-1" />
              )}
              Добавить в базу
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Секции</CardTitle>
          <CardDescription>Каждая секция — отдельный документ для RAG и часть сборного MD</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Загрузка…
            </div>
          ) : sections.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока пусто — загрузите файл или вставьте текст.</p>
          ) : (
            <ul className="space-y-2">
              {sections.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{s.title}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {s.filename} · {s.sourceType} · {s.charCount} симв.
                      {s.documentId ? ` · doc #${s.documentId}` : ""}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleDelete(s.id)}
                    aria-label="Удалить"
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Сборный Markdown</CardTitle>
          <CardDescription>Превью файла, который уходит в LLM (если укладывается в лимит)</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[420px] overflow-auto rounded-md bg-muted/50 p-3 text-xs whitespace-pre-wrap">
            {assembledPreview || "— пусто —"}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
