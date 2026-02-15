import { useState, useRef, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Trash2, Upload, AlertCircle, CheckCircle2, Clock, FileText, ShoppingCart, BookOpen, Eye, Tag, Grid3x3, RefreshCw, Download } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type ProcessingType =
  | "general"
  | "instruction"
  | "catalog"
  | "certificate"
  | "passport"
  | "warranty_faq"
  | "manual";

export default function DocumentsPage() {
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [processingType, setProcessingType] = useState<ProcessingType>("general");
  const [shouldPoll, setShouldPoll] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<string>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [, setLocation] = useLocation();

  // Fetch documents
  const { data: documents, isLoading, refetch } = trpc.document.listDocuments.useQuery(undefined, {
    refetchInterval: shouldPoll ? 2000 : false,
  });

  const {
    data: modelStatus,
    isLoading: isModelStatusLoading,
    refetch: refetchModelStatus,
  } = trpc.system.getModelStatus.useQuery(undefined, {
    enabled: isUploadDialogOpen,
    refetchInterval: 3000,
  });

  const modelBadges = useMemo(() => {
    if (!modelStatus) return [];

    const list: Array<{
      label: string;
      variant?: "default" | "secondary" | "outline" | "destructive";
      loading?: boolean;
    }> = [];

    list.push({
      label: modelStatus.ollama.ok ? "Ollama: OK" : "Ollama: недоступно",
      variant: modelStatus.ollama.ok ? "secondary" : "destructive",
    });

    const llmReady = Boolean(modelStatus.llm?.ready);
    const llmModel = modelStatus.llm?.model ?? "—";
    list.push({
      label: `Генерация (LLM): ${llmModel} — ${llmReady ? "OK" : "загружается…"}`,
      variant: llmReady ? "outline" : "secondary",
      loading: !llmReady,
    });

    const embReady = Boolean(modelStatus.embeddings?.ready);
    const embModel = modelStatus.embeddings?.model ?? "—";
    list.push({
      label: `Эмбеддинги: ${embModel} — ${embReady ? "OK" : "загружается…"}`,
      variant: embReady ? "outline" : "secondary",
      loading: !embReady,
    });

    return list;
  }, [modelStatus]);

  useEffect(() => {
    if (!documents || documents.length === 0) {
      setShouldPoll(false);
      return;
    }
    const hasProcessing = documents.some(
      (doc) => doc.status === "processing" || (doc.processingStage && doc.processingStage !== "completed" && doc.processingStage !== "failed")
    );
    setShouldPoll(hasProcessing);
  }, [documents]);

  // Delete document mutation
  const deleteDocMutation = trpc.document.deleteDocument.useMutation({
    onSuccess: () => {
      toast.success("Document deleted successfully");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete document");
    },
  });

  // Regenerate all embeddings mutation
  const regenerateAllMutation = trpc.document.regenerateAllEmbeddings.useMutation({
    onSuccess: (result) => {
      toast.success(`✅ ${result.message}`);
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to regenerate embeddings");
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const supportedFormats = [".pdf", ".xlsx", ".xls", ".docx"];
    const fileExt = "." + file.name.split(".").pop()?.toLowerCase();

    if (!supportedFormats.includes(fileExt)) {
      toast.error(`Unsupported file format. Supported: ${supportedFormats.join(", ")}`);
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      toast.error("File size exceeds 100MB limit");
      return;
    }

    await uploadFile(file, processingType);
  };

  const uploadFile = async (file: File, type: ProcessingType) => {
    setIsUploading(true);
    setShouldPoll(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const skipFullProcessing =
        type === "manual" || type === "certificate" || type === "passport" || type === "warranty_faq";
      // For manual mode, keep docType as general but skip full processing
      const actualProcessingType = type === "manual" ? "general" : type;
      formData.append("processingType", actualProcessingType);
      formData.append("skipFullProcessing", skipFullProcessing.toString());
      
      const response = await fetch("/api/upload/document", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Upload failed");
      }

      const result = await response.json();
      toast.success(result.message || "Document uploaded successfully");
      setIsUploadDialogOpen(false);
      
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      
      // Refresh document list
      refetch();

      // For specialized/manual flows, jump straight to annotation
      if (skipFullProcessing && result?.documentId) {
        setLocation(`/documents/${result.documentId}/annotate`);
      }
    } catch (error) {
      console.error("Upload error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to upload document");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteDocument = (docId: number) => {
    if (confirm("Are you sure you want to delete this document?")) {
      deleteDocMutation.mutate({ id: docId });
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "indexed":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "processing":
        return <Clock className="w-4 h-4 text-yellow-500 animate-spin" />;
      case "failed":
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getStageLabel = (stage?: string | null) => {
    switch (stage) {
      case "queued":
        return "Ожидает обработки";
      case "parsing":
        return "Извлечение структуры";
      case "chunking":
        return "Разделение на чанки";
      case "embedding":
        return "Генерация эмбеддингов";
      case "saving":
        return "Сохранение данных";
      case "completed":
        return "Завершено";
      case "failed":
        return "Ошибка обработки";
      default:
        return "Подготовка";
    }
  };

  const docTypeMeta = useMemo(() => {
    return {
      catalog: { title: "Каталоги", icon: ShoppingCart, hint: "Номенклатура и товары" },
      instruction: { title: "Инструкции", icon: BookOpen, hint: "Руководства и инструкции" },
      passport: { title: "Паспорта", icon: FileText, hint: "Паспорта изделий (ручная разметка)" },
      certificate: { title: "Сертификаты", icon: Eye, hint: "Сертификаты (ручная разметка / файл)" },
      warranty_faq: { title: "FAQ по гарантии", icon: Grid3x3, hint: "Вопрос–ответ по гарантийным обращениям" },
      general: { title: "Общие документы", icon: FileText, hint: "Прочие документы" },
    } as const;
  }, []);

  const filteredDocuments = useMemo(() => {
    const list = documents ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((d) => {
      const hay = `${d.title ?? ""} ${d.filename ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [documents, search]);

  const groupedDocuments = useMemo(() => {
    const map = new Map<string, typeof filteredDocuments>();
    filteredDocuments.forEach((doc) => {
      const key = (doc.docType ?? "general") as string;
      const prev = map.get(key) ?? [];
      prev.push(doc);
      map.set(key, prev);
    });

    const order = [
      "catalog",
      "instruction",
      "passport",
      "certificate",
      "warranty_faq",
      "general",
    ];

    return order.map((key) => ({
      key,
      meta: (docTypeMeta as any)[key] as (typeof docTypeMeta)[keyof typeof docTypeMeta],
      docs: map.get(key) ?? [],
    }));
  }, [docTypeMeta, filteredDocuments]);

  const overallStats = useMemo(() => {
    const list = documents ?? [];
    let indexed = 0;
    let processing = 0;
    let failed = 0;
    let chunks = 0;
    list.forEach((d) => {
      if (d.status === "indexed") indexed += 1;
      else if (d.status === "processing") processing += 1;
      else if (d.status === "failed") failed += 1;
      chunks += Number(d.chunksCount ?? 0);
    });
    return { total: list.length, indexed, processing, failed, chunks };
  }, [documents]);

  const tabItems = useMemo(() => {
    const counts: Record<string, number> = {};
    groupedDocuments.forEach((g) => {
      counts[g.key] = g.docs.length;
    });

    return [
      { value: "all", label: "Все", count: filteredDocuments.length },
      { value: "passport", label: "Паспорта", count: counts.passport ?? 0 },
      { value: "certificate", label: "Сертификаты", count: counts.certificate ?? 0 },
      { value: "warranty_faq", label: "FAQ гарантия", count: counts.warranty_faq ?? 0 },
      { value: "catalog", label: "Каталоги", count: counts.catalog ?? 0 },
      { value: "instruction", label: "Инструкции", count: counts.instruction ?? 0 },
      { value: "general", label: "Общие", count: counts.general ?? 0 },
    ].filter((t) => t.value === "all" || t.count > 0);
  }, [filteredDocuments.length, groupedDocuments]);

  const renderDocumentCard = (doc: any) => {
    const displayTitle = (doc.title && String(doc.title).trim()) || doc.filename;
    const showFilename = displayTitle !== doc.filename;
    const canUseDoc = doc.status === "indexed";

    return (
      <Card key={doc.id} className="overflow-hidden">
        <CardHeader className="py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <CardTitle className="text-sm font-semibold truncate">
                {displayTitle}
              </CardTitle>
              <CardDescription className="text-xs truncate">
                {showFilename ? doc.filename : `${doc.fileType.toUpperCase()} • ${(doc.fileSize / 1024 / 1024).toFixed(2)}MB`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {getStatusIcon(doc.status)}
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() =>
                  window.open(`/api/documents/${doc.id}/file?download=1`, "_blank")
                }
                title="Скачать файл"
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setLocation(`/documents/${doc.id}/annotate`)}
                title="Разметка"
                disabled={!canUseDoc}
              >
                <Tag className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setLocation(`/documents/${doc.id}/visualize`)}
                title="Визуализация"
                disabled={!canUseDoc}
              >
                <Grid3x3 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setLocation(`/documents/${doc.id}`)}
                title="Детали"
              >
                <Eye className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => handleDeleteDocument(doc.id)}
                disabled={deleteDocMutation.isPending}
                title="Удалить"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[11px]">
              {doc.fileType.toUpperCase()}
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              {(doc.fileSize / 1024 / 1024).toFixed(2)}MB
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              Чанков: {doc.chunksCount}
            </Badge>
            {doc.pages ? (
              <Badge variant="outline" className="text-[11px]">
                Страниц: {doc.pages}
              </Badge>
            ) : null}
          </div>

          {doc.status === "processing" && (
            <div className="mt-3 space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate">
                  {doc.processingMessage ||
                    getStageLabel(doc.processingStage) ||
                    "Обработка"}
                </span>
                <span className="shrink-0">
                  {Math.round(doc.processingProgress ?? 0)}%
                </span>
              </div>
              <Progress value={doc.processingProgress ?? 0} className="h-1.5" />
            </div>
          )}

          {(doc.status !== "processing" && doc.processingMessage) ? (
            <div className="mt-2 text-xs text-muted-foreground line-clamp-2">
              {doc.processingMessage}
            </div>
          ) : null}

          {doc.errorMessage ? (
            <div className="mt-2 text-xs text-destructive line-clamp-2">
              {doc.errorMessage}
            </div>
          ) : null}

          <div className="mt-2 text-[11px] text-muted-foreground">
            Загружен: {new Date(doc.uploadedAt).toLocaleString()}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Documents</h1>
          <p className="text-muted-foreground">Manage your knowledge base documents</p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => regenerateAllMutation.mutate()} 
            disabled={regenerateAllMutation.isPending}
            variant="outline"
            className="gap-2"
          >
            {regenerateAllMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Генерация эмбеддингов...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Перестроить индексы (AI)
              </>
            )}
          </Button>
          <Button onClick={() => setIsUploadDialogOpen(true)} className="gap-2">
            <Upload className="w-4 h-4" />
            Upload Document
          </Button>
        </div>
      </div>

      {/* Upload Dialog */}
      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
            <DialogDescription>
              Upload a PDF, Excel, or Word document to add to your knowledge base
            </DialogDescription>
          </DialogHeader>

          {/* Models status */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Модели:</span>
            {isModelStatusLoading && (
              <Badge variant="secondary" className="gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Проверка…
              </Badge>
            )}
            {!isModelStatusLoading &&
              modelBadges.map((b) => (
                <Badge key={b.label} variant={b.variant ?? "outline"} className={b.loading ? "gap-1" : undefined}>
                  {b.loading && <Loader2 className="h-3 w-3 animate-spin" />}
                  {b.label}
                </Badge>
              ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() => refetchModelStatus()}
              title="Обновить статус моделей"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {/* Important instructions (collapsed style) */}
          <details className="rounded-lg border bg-blue-50/60 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-blue-900 dark:text-blue-100">
              ⚠️ Важно: проверьте PDF на текстовый слой
            </summary>
            <div className="mt-2 text-sm text-blue-800 dark:text-blue-200">
              <ul className="space-y-1 list-disc list-inside">
                <li>
                  Откройте PDF в Adobe Reader и попробуйте выделить текст мышкой.
                </li>
                <li>
                  Если текст не выделяется — это скан без текстового слоя (нужен OCR).
                </li>
              </ul>
            </div>
          </details>

          <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
            {/* Processing type - horizontal */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Тип обработки</Label>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: "general" as const, label: "Общий", icon: FileText, group: "Авто" },
                  { value: "instruction" as const, label: "Инструкция", icon: BookOpen, group: "Авто" },
                  { value: "catalog" as const, label: "Каталог", icon: ShoppingCart, group: "Авто" },
                  { value: "certificate" as const, label: "Сертификат", icon: Eye, group: "Ручной" },
                  { value: "passport" as const, label: "Паспорт", icon: FileText, group: "Ручной" },
                  { value: "warranty_faq" as const, label: "FAQ гарантия", icon: Grid3x3, group: "Ручной" },
                  { value: "manual" as const, label: "Ручной", icon: Tag, group: "Ручной" },
                ].map((opt) => {
                  const Icon = opt.icon;
                  const selected = processingType === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setProcessingType(opt.value)}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/60",
                        selected && "border-primary bg-primary/5",
                        opt.value === "manual" && "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20"
                      )}
                      title={opt.group}
                    >
                      <Icon className={cn("h-4 w-4", opt.value === "manual" && "text-green-600 dark:text-green-400")} />
                      <span className="font-medium">{opt.label}</span>
                      <Badge variant="outline" className="ml-1 text-[10px] px-1.5 py-0">
                        {opt.group}
                      </Badge>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Спецтипы/ручной режим после загрузки откроют экран разметки.
              </p>
            </div>

            {/* Upload area */}
            <div className="space-y-3">
              <div
                className="border-2 border-dashed rounded-lg p-5 text-center cursor-pointer hover:bg-muted/50 transition"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-7 h-7 mx-auto mb-2 text-muted-foreground" />
                <p className="font-medium">Выбрать файл</p>
                <p className="text-xs text-muted-foreground">PDF / Excel / Word • до 100MB</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  accept=".pdf,.xlsx,.xls,.docx"
                  className="hidden"
                />
              </div>

              <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="w-full">
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  "Select File"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Documents List */}
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Всего: {overallStats.total}</Badge>
                <Badge variant="outline">Проиндексировано: {overallStats.indexed}</Badge>
                <Badge variant="outline">В обработке: {overallStats.processing}</Badge>
                <Badge variant={overallStats.failed > 0 ? "destructive" : "outline"}>
                  Ошибки: {overallStats.failed}
                </Badge>
                <Badge variant="outline">Чанков: {overallStats.chunks}</Badge>
              </div>
              <div className="flex gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по названию/файлу…"
                  className="h-9 w-full lg:w-80 rounded-md border bg-background px-3 text-sm"
                />
                <Button variant="outline" className="gap-2" onClick={() => refetch()}>
                  <RefreshCw className="w-4 h-4" />
                  Обновить
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <Card>
            <CardContent className="pt-6">
              <div className="flex justify-center items-center h-32">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        ) : filteredDocuments && filteredDocuments.length > 0 ? (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="flex flex-wrap h-auto justify-start">
              {tabItems.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="gap-2">
                  <span>{t.label}</span>
                  <Badge variant="secondary" className="h-5 px-2 text-[11px]">
                    {t.count}
                  </Badge>
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="all" className="space-y-8">
              {groupedDocuments
                .filter((g) => g.docs.length > 0)
                .map((group) => {
                  const Icon = group.meta.icon;
                  return (
                    <div key={group.key} className="space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="rounded-md bg-primary/10 p-2">
                            <Icon className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <div className="text-base font-semibold">{group.meta.title}</div>
                            <div className="text-xs text-muted-foreground">{group.meta.hint}</div>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[11px]">
                          Документов: {group.docs.length}
                        </Badge>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                        {group.docs.map(renderDocumentCard)}
                      </div>
                    </div>
                  );
                })}
            </TabsContent>

            {groupedDocuments
              .filter((g) => g.docs.length > 0)
              .map((group) => (
                <TabsContent key={group.key} value={group.key} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {group.docs.map(renderDocumentCard)}
                  </div>
                </TabsContent>
              ))}
          </Tabs>
        ) : documents && documents.length > 0 ? (
          <Card className="border-dashed">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="p-4 bg-muted rounded-full mb-4">
                  <Upload className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Ничего не найдено</h3>
                <p className="text-sm text-muted-foreground mb-6 max-w-md">
                  Попробуйте изменить строку поиска или очистить фильтр.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSearch("")}
                  className="gap-2"
                >
                  Очистить поиск
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="p-4 bg-muted rounded-full mb-4">
                  <Upload className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Документы не загружены</h3>
                <p className="text-sm text-muted-foreground mb-6 max-w-md">
                  Начните работу, загрузив первый документ в базу знаний. Поддерживаются форматы PDF, Excel и Word.
                </p>
                <Button
                  onClick={() => setIsUploadDialogOpen(true)}
                  className="gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Загрузить первый документ
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
