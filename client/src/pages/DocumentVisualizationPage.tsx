import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, ArrowLeft, Table, FileText, Image, List, Tag, Package, Eye, Grid3x3, CheckCircle2, XCircle, BarChart3 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function DocumentVisualizationPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const documentId = parseInt(params.id || "0", 10);
  const [viewMode, setViewMode] = useState<"pages" | "chunks" | "groups">("pages");

  // Fetch document info
  const { data: document } = trpc.document.getDocument.useQuery(
    { id: documentId },
    { enabled: documentId > 0 }
  );

  // Fetch chunks with annotations (always fetch once document metadata is available)
  const chunksQueryEnabled = documentId > 0 && document !== undefined;
  const { data: chunks, isLoading: isLoadingChunks } = trpc.document.getDocumentChunksWithAnnotations.useQuery(
    { documentId },
    { enabled: chunksQueryEnabled }
  );

  // Fetch product groups
  const { data: productGroups } = trpc.document.getDocumentProductGroups.useQuery(
    { documentId },
    { enabled: documentId > 0 }
  );

  // Fetch sections
  const { data: sections } = trpc.document.getDocumentSections.useQuery(
    { documentId },
    { enabled: documentId > 0 }
  );

  const getAnnotationTypeColor = (type: string, isNomenclature: boolean) => {
    if (isNomenclature) return "bg-green-500/20 border-green-500";
    if (type === "table" || type === "table_with_articles") return "bg-blue-500/20 border-blue-500";
    if (type === "figure") return "bg-purple-500/20 border-purple-500";
    if (type === "list") return "bg-orange-500/20 border-orange-500";
    return "bg-gray-500/20 border-gray-500";
  };

  const getAnnotationTypeIcon = (type: string) => {
    switch (type) {
      case "table":
      case "table_with_articles":
        return <Table className="w-4 h-4" />;
      case "figure":
        return <Image className="w-4 h-4" />;
      case "list":
        return <List className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  const getGroupColor = (groupId: number | null) => {
    if (!groupId) return "bg-gray-100 dark:bg-gray-800";
    const colors = [
      "bg-blue-100 dark:bg-blue-900/30",
      "bg-green-100 dark:bg-green-900/30",
      "bg-yellow-100 dark:bg-yellow-900/30",
      "bg-purple-100 dark:bg-purple-900/30",
      "bg-pink-100 dark:bg-pink-900/30",
      "bg-indigo-100 dark:bg-indigo-900/30",
      "bg-red-100 dark:bg-red-900/30",
      "bg-cyan-100 dark:bg-cyan-900/30",
    ];
    return colors[groupId % colors.length];
  };

  // Group chunks by page (only if chunks exist)
  const chunksByPage = new Map<number, Array<typeof chunks[0]>>();
  if (chunks && chunks.length > 0) {
    chunks.forEach((chunk) => {
      const page = chunk.pageNumber || 0;
      if (!chunksByPage.has(page)) {
        chunksByPage.set(page, []);
      }
      chunksByPage.get(page)!.push(chunk);
    });
  }

  // Group chunks by product group (only if chunks exist)
  const chunksByGroup = new Map<number | null, Array<typeof chunks[0]>>();
  if (chunks && chunks.length > 0) {
    chunks.forEach((chunk) => {
      const groupId = chunk.annotation?.productGroupId || null;
      if (!chunksByGroup.has(groupId)) {
        chunksByGroup.set(groupId, []);
      }
      chunksByGroup.get(groupId)!.push(chunk);
    });
  }

  // Calculate coverage statistics (only if chunks exist)
  const coverageStats = useMemo(() => {
    if (!document || !chunks || chunks.length === 0) return null;

    const totalChunks = chunks.length;
    const annotatedChunks = chunks.filter((c) => c.annotation).length;
    const unannotatedChunks = totalChunks - annotatedChunks;

    const highestPageFromChunks = chunks.reduce(
      (max, chunk) => Math.max(max, chunk.pageNumber || 0),
      0
    );
    const totalPages =
      (document.pages && document.pages > 0 ? document.pages : highestPageFromChunks) || 0;

    // Count by annotation type
    const typeCounts = {
      table: 0,
      table_with_articles: 0,
      text: 0,
      figure: 0,
      list: 0,
      nomenclature: 0,
    };

    chunks.forEach((chunk) => {
      if (chunk.annotation) {
        const type = chunk.annotation.annotationType;
        if (type in typeCounts) {
          typeCounts[type as keyof typeof typeCounts]++;
        }
        if (chunk.annotation.isNomenclatureTable) {
          typeCounts.nomenclature++;
        }
      }
    });

    // Count chunks with product groups
    const chunksWithGroups = chunks.filter((c) => c.annotation?.productGroupId).length;
    const chunksWithoutGroups = annotatedChunks - chunksWithGroups;

    // Coverage by page
    const pageCoverage = new Map<number, { total: number; annotated: number }>();
    const annotatedPagesSet = new Set<number>();
    chunks.forEach((chunk) => {
      const page = chunk.pageNumber || 0;
      if (!pageCoverage.has(page)) {
        pageCoverage.set(page, { total: 0, annotated: 0 });
      }
      const stats = pageCoverage.get(page)!;
      stats.total++;
      if (chunk.annotation) {
        stats.annotated++;
        if (page > 0) {
          annotatedPagesSet.add(page);
        }
      }
    });

    const annotatedPages = annotatedPagesSet.size;
    const unannotatedPages = totalPages > 0 ? Math.max(totalPages - annotatedPages, 0) : 0;
    const coveragePercent =
      totalPages > 0 ? Math.round((annotatedPages / totalPages) * 100) : 0;

    return {
      totalChunks,
      annotatedChunks,
      unannotatedChunks,
      coveragePercent,
      totalPages,
      annotatedPages,
      unannotatedPages,
      typeCounts,
      chunksWithGroups,
      chunksWithoutGroups,
      pageCoverage,
    };
  }, [chunks, document]);

  // Show loading while fetching document
  if (!document) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show loading while fetching chunks
  if (isLoadingChunks) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No chunks found
  if (!chunks || chunks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <Grid3x3 className="w-12 h-12 text-muted-foreground" />
        <p className="text-lg font-semibold">Чанки не найдены</p>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          Документ ещё не содержит сохранённых чанков. Если вы выполняли ручную разметку, убедитесь,
          что сгенерировали чанки из выбранных областей, затем обновите страницу.
        </p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Обновить страницу
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/documents")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Назад
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Визуализация документа</h1>
            <p className="text-muted-foreground">{document.filename}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {document.pages || 0} страниц • {chunks.length} чанков • {productGroups?.length || 0} групп
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation(`/documents/${documentId}/annotate`)}
            title="Разметка документа"
          >
            <Tag className="w-4 h-4 mr-2" />
            Разметка
          </Button>
        </div>
      </div>

      {/* Coverage Statistics */}
      {coverageStats && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="relative overflow-hidden transition-all hover:shadow-md hover:border-primary/50">
            <div className="absolute top-0 right-0 w-20 h-20 bg-primary/5 rounded-bl-full" />
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <div className="p-1.5 bg-primary/10 rounded-lg">
                  <BarChart3 className="w-4 h-4 text-primary" />
                </div>
                Покрытие разметки
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Размечено страниц</span>
                  <span className="font-bold text-foreground">
                    {coverageStats.annotatedPages} / {coverageStats.totalPages}
                  </span>
                </div>
                <Progress value={coverageStats.coveragePercent} className="h-2.5" />
                <div className="text-xs text-muted-foreground text-center font-medium">
                  {coverageStats.coveragePercent}% страниц покрыто
                </div>
                <div className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-1.5 text-xs">
                  <span className="text-muted-foreground">Без разметки</span>
                  <span className="font-semibold text-foreground">
                    {coverageStats.unannotatedPages}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden transition-all hover:shadow-md hover:border-green-500/50">
            <div className="absolute top-0 right-0 w-20 h-20 bg-green-500/5 rounded-bl-full" />
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <div className="p-1.5 bg-green-500/10 rounded-lg">
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
                Размеченные чанки
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tracking-tight text-green-600 dark:text-green-400">{coverageStats.annotatedChunks}</div>
              <p className="text-xs text-muted-foreground mt-2">чанков с разметкой</p>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden transition-all hover:shadow-md hover:border-orange-500/50">
            <div className="absolute top-0 right-0 w-20 h-20 bg-orange-500/5 rounded-bl-full" />
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <div className="p-1.5 bg-orange-500/10 rounded-lg">
                  <XCircle className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                </div>
                Чанки без разметки
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tracking-tight text-orange-600 dark:text-orange-400">{coverageStats.unannotatedChunks}</div>
              <p className="text-xs text-muted-foreground mt-2">чанков без разметки</p>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden transition-all hover:shadow-md hover:border-blue-500/50">
            <div className="absolute top-0 right-0 w-20 h-20 bg-blue-500/5 rounded-bl-full" />
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <div className="p-1.5 bg-blue-500/10 rounded-lg">
                  <Package className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                Товарные группы
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tracking-tight text-blue-600 dark:text-blue-400">{productGroups?.length || 0}</div>
              <p className="text-xs text-muted-foreground mt-2">
                {coverageStats.chunksWithGroups} чанков в группах
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Annotation Type Statistics */}
      {coverageStats && (
        <Card className="transition-all hover:shadow-md">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              Статистика по типам разметки
            </CardTitle>
            <CardDescription>Распределение размеченных чанков по типам элементов</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {coverageStats.typeCounts.table > 0 && (
                <div className="flex flex-col items-center p-4 bg-blue-500/10 rounded-lg border border-blue-500/20 transition-all hover:shadow-md hover:bg-blue-500/15">
                  <div className="p-2 bg-blue-500/20 rounded-lg mb-2">
                    <Table className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{coverageStats.typeCounts.table}</div>
                  <div className="text-xs text-muted-foreground font-medium mt-1">Таблицы</div>
                </div>
              )}
              {coverageStats.typeCounts.table_with_articles > 0 && (
                <div className="flex flex-col items-center p-4 bg-blue-500/10 rounded-lg border border-blue-500/20 transition-all hover:shadow-md hover:bg-blue-500/15">
                  <div className="p-2 bg-blue-500/20 rounded-lg mb-2">
                    <Table className="w-5 h-5 text-blue-700 dark:text-blue-300" />
                  </div>
                  <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{coverageStats.typeCounts.table_with_articles}</div>
                  <div className="text-xs text-muted-foreground font-medium mt-1">Таблицы с артикулами</div>
                </div>
              )}
              {coverageStats.typeCounts.nomenclature > 0 && (
                <div className="flex flex-col items-center p-4 bg-green-500/10 rounded-lg border border-green-500/20 transition-all hover:shadow-md hover:bg-green-500/15">
                  <div className="p-2 bg-green-500/20 rounded-lg mb-2">
                    <Tag className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">{coverageStats.typeCounts.nomenclature}</div>
                  <div className="text-xs text-muted-foreground font-medium mt-1">Номенклатурные</div>
                </div>
              )}
              {coverageStats.typeCounts.figure > 0 && (
                <div className="flex flex-col items-center p-4 bg-purple-500/10 rounded-lg border border-purple-500/20 transition-all hover:shadow-md hover:bg-purple-500/15">
                  <div className="p-2 bg-purple-500/20 rounded-lg mb-2">
                    <Image className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{coverageStats.typeCounts.figure}</div>
                  <div className="text-xs text-muted-foreground font-medium mt-1">Рисунки</div>
                </div>
              )}
              {coverageStats.typeCounts.list > 0 && (
                <div className="flex flex-col items-center p-4 bg-orange-500/10 rounded-lg border border-orange-500/20 transition-all hover:shadow-md hover:bg-orange-500/15">
                  <div className="p-2 bg-orange-500/20 rounded-lg mb-2">
                    <List className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{coverageStats.typeCounts.list}</div>
                  <div className="text-xs text-muted-foreground font-medium mt-1">Списки</div>
                </div>
              )}
              {coverageStats.typeCounts.text > 0 && (
                <div className="flex flex-col items-center p-4 bg-gray-500/10 rounded-lg border border-gray-500/20 transition-all hover:shadow-md hover:bg-gray-500/15">
                  <div className="p-2 bg-gray-500/20 rounded-lg mb-2">
                    <FileText className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  </div>
                  <div className="text-2xl font-bold text-gray-600 dark:text-gray-400">{coverageStats.typeCounts.text}</div>
                  <div className="text-xs text-muted-foreground font-medium mt-1">Текст</div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as typeof viewMode)}>
        <TabsList>
          <TabsTrigger value="pages">По страницам</TabsTrigger>
          <TabsTrigger value="chunks">По чанкам</TabsTrigger>
          <TabsTrigger value="groups">По группам</TabsTrigger>
        </TabsList>

        {/* Pages View */}
        <TabsContent value="pages" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Структура документа по страницам</CardTitle>
              <CardDescription>
                Визуализация чанков и разметки по страницам документа
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[calc(100vh-300px)]">
                <div className="space-y-6">
                  {Array.from({ length: document.pages || 0 }, (_, i) => i + 1).map((pageNum) => {
                    const pageChunks = chunksByPage.get(pageNum) || [];
                    const pageSections = sections?.filter(
                      (s) => (s.pageStart || 0) <= pageNum && (s.pageEnd || document.pages || 0) >= pageNum
                    ) || [];
                    const pageAnnotated = pageChunks.filter((c) => c.annotation).length;
                    const pageCoveragePercent = pageChunks.length > 0 
                      ? Math.round((pageAnnotated / pageChunks.length) * 100) 
                      : 0;

                    return (
                      <Card key={pageNum} className="border-l-4 border-l-primary">
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">Страница {pageNum}</CardTitle>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">
                                {pageChunks.length} чанков
                                {pageAnnotated > 0 && (
                                  <span className="ml-1 text-green-600">
                                    • {pageAnnotated} размечено
                                  </span>
                                )}
                              </Badge>
                            </div>
                          </div>
                          {pageSections.length > 0 && (
                            <CardDescription>
                              Разделы: {pageSections.map((s) => s.sectionPath).join(", ")}
                            </CardDescription>
                          )}
                          {pageChunks.length > 0 && (
                            <div className="mt-2 space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">Покрытие страницы</span>
                                <span className="font-medium">{pageCoveragePercent}%</span>
                              </div>
                              <Progress value={pageCoveragePercent} className="h-1.5" />
                            </div>
                          )}
                        </CardHeader>
                        <CardContent>
                          {pageChunks.length > 0 ? (
                            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                              {pageChunks.map((chunk) => {
                                const hasAnnotation = !!chunk.annotation;
                                const isNomenclature = chunk.annotation?.isNomenclatureTable || false;
                                const groupId = chunk.annotation?.productGroupId || null;
                                const group = productGroups?.find((g) => g.id === groupId);

                                return (
                                  <Card
                                    key={chunk.chunkIndex}
                                    className={`transition-all hover:shadow-md ${
                                      hasAnnotation
                                        ? getAnnotationTypeColor(
                                            chunk.annotation!.annotationType,
                                            isNomenclature
                                          )
                                        : "bg-muted/50"
                                    } ${getGroupColor(groupId)} border-2`}
                                  >
                                    <CardHeader className="pb-2">
                                      <div className="flex items-center justify-between">
                                        <CardTitle className="text-sm">Чанк #{chunk.chunkIndex}</CardTitle>
                                        {hasAnnotation && (
                                          <div className="flex gap-1">
                                            {getAnnotationTypeIcon(chunk.annotation!.annotationType)}
                                            {isNomenclature && <Tag className="w-3 h-3" />}
                                          </div>
                                        )}
                                      </div>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                      {hasAnnotation && (
                                        <div className="flex flex-wrap gap-1">
                                          <Badge
                                            variant="outline"
                                            className="text-xs"
                                          >
                                            {chunk.annotation!.annotationType === "table_with_articles"
                                              ? "Таблица с артикулами"
                                              : chunk.annotation!.annotationType === "table"
                                              ? "Таблица"
                                              : chunk.annotation!.annotationType === "figure"
                                              ? "Рисунок"
                                              : chunk.annotation!.annotationType === "list"
                                              ? "Список"
                                              : "Текст"}
                                          </Badge>
                                          {group && (
                                            <Badge variant="outline" className="text-xs bg-blue-100 dark:bg-blue-900/30">
                                              <Package className="w-3 h-3 mr-1" />
                                              {group.name}
                                            </Badge>
                                          )}
                                        </div>
                                      )}
                                      <div className="text-xs text-muted-foreground">
                                        <div>Раздел: {chunk.sectionPath || "не указан"}</div>
                                        <div>Токены: {chunk.tokenCount}</div>
                                        {chunk.tableJson && chunk.tableJson.length > 0 && (
                                          <div className="text-blue-600">📊 {chunk.tableJson.length} строк</div>
                                        )}
                                      </div>
                                      <div className="text-xs line-clamp-2 text-muted-foreground">
                                        {chunk.content.slice(0, 100)}...
                                      </div>
                                    </CardContent>
                                  </Card>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="text-center text-muted-foreground py-8">
                              На этой странице нет чанков
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Chunks View */}
        <TabsContent value="chunks" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Все чанки документа</CardTitle>
              <CardDescription>
                Последовательное отображение всех чанков с их разметкой
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[calc(100vh-300px)]">
                <div className="space-y-3">
                  {chunks.map((chunk) => {
                    const hasAnnotation = !!chunk.annotation;
                    const isNomenclature = chunk.annotation?.isNomenclatureTable || false;
                    const groupId = chunk.annotation?.productGroupId || null;
                    const group = productGroups?.find((g) => g.id === groupId);

                    return (
                      <Card
                        key={chunk.chunkIndex}
                        className={`transition-all hover:shadow-md ${
                          hasAnnotation
                            ? getAnnotationTypeColor(
                                chunk.annotation!.annotationType,
                                isNomenclature
                              )
                            : "bg-muted/50"
                        } ${getGroupColor(groupId)} border-l-4`}
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <CardTitle className="text-base">Чанк #{chunk.chunkIndex}</CardTitle>
                              {hasAnnotation && (
                                <div className="flex gap-2">
                                  {getAnnotationTypeIcon(chunk.annotation!.annotationType)}
                                  {isNomenclature && <Tag className="w-4 h-4 text-green-600" />}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">Стр. {chunk.pageNumber || "?"}</Badge>
                              {group && (
                                <Badge variant="outline" className="bg-blue-100 dark:bg-blue-900/30">
                                  <Package className="w-3 h-3 mr-1" />
                                  {group.name}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <CardDescription className="text-xs">
                            Раздел: {chunk.sectionPath || "не указан"} • Тип: {chunk.elementType} • Токены: {chunk.tokenCount}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          {hasAnnotation && (
                            <div className="mb-3 flex flex-wrap gap-2">
                              <Badge
                                className={
                                  isNomenclature
                                    ? "bg-green-500"
                                    : chunk.annotation!.annotationType === "table" || chunk.annotation!.annotationType === "table_with_articles"
                                    ? "bg-blue-500"
                                    : "bg-gray-500"
                                }
                              >
                                {chunk.annotation!.annotationType === "table_with_articles"
                                  ? "Таблица с артикулами"
                                  : chunk.annotation!.annotationType === "table"
                                  ? "Таблица"
                                  : chunk.annotation!.annotationType === "figure"
                                  ? "Рисунок"
                                  : chunk.annotation!.annotationType === "list"
                                  ? "Список"
                                  : "Текст"}
                              </Badge>
                              {chunk.annotation!.notes && (
                                <Badge variant="outline" className="text-xs">
                                  📝 {chunk.annotation!.notes.slice(0, 50)}
                                </Badge>
                              )}
                            </div>
                          )}
                          <div className="text-sm text-muted-foreground">
                            {chunk.content.slice(0, 300)}
                            {chunk.content.length > 300 && "..."}
                          </div>
                          {chunk.tableJson && chunk.tableJson.length > 0 && (
                            <div className="mt-2 text-xs text-blue-600 font-medium">
                              📊 Таблица: {chunk.tableJson.length} строк
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Groups View */}
        <TabsContent value="groups" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Товарные группы</CardTitle>
              <CardDescription>
                Визуализация чанков, сгруппированных по товарным группам
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[calc(100vh-300px)]">
                <div className="space-y-6">
                  {/* Ungrouped chunks */}
                  {chunksByGroup.has(null) && chunksByGroup.get(null)!.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Без группы</CardTitle>
                        <CardDescription>
                          {chunksByGroup.get(null)!.length} чанков без привязки к товарной группе
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                          {chunksByGroup.get(null)!.map((chunk) => (
                            <Card key={chunk.chunkIndex} className="bg-muted/50">
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm">Чанк #{chunk.chunkIndex}</CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="text-xs text-muted-foreground">
                                  Страница {chunk.pageNumber || "?"} • {chunk.sectionPath || "не указан"}
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Grouped chunks */}
                  {productGroups?.map((group) => {
                    const groupChunks = chunksByGroup.get(group.id) || [];
                    if (groupChunks.length === 0) return null;

                    const groupAnnotated = groupChunks.filter((c) => c.annotation).length;
                    const groupCoveragePercent = groupChunks.length > 0 
                      ? Math.round((groupAnnotated / groupChunks.length) * 100) 
                      : 0;
                    const groupNomenclature = groupChunks.filter((c) => c.annotation?.isNomenclatureTable).length;

                    return (
                      <Card key={group.id} className={`${getGroupColor(group.id)} border-l-4 border-l-blue-500`}>
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <div>
                              <CardTitle className="text-lg flex items-center gap-2">
                                <Package className="w-5 h-5" />
                                {group.name}
                              </CardTitle>
                              {group.description && (
                                <CardDescription className="mt-1">{group.description}</CardDescription>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <Badge variant="outline" className="bg-blue-100 dark:bg-blue-900/30">
                                {groupChunks.length} чанков
                              </Badge>
                              {groupNomenclature > 0 && (
                                <Badge variant="outline" className="bg-green-100 dark:bg-green-900/30 text-xs">
                                  <Tag className="w-3 h-3 mr-1" />
                                  {groupNomenclature} номенклатурных
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2 mt-2 text-xs text-muted-foreground">
                            {group.sectionPath && <span>Раздел: {group.sectionPath}</span>}
                            {group.pageStart && group.pageEnd && (
                              <span>Страницы: {group.pageStart}-{group.pageEnd}</span>
                            )}
                          </div>
                          {groupChunks.length > 0 && (
                            <div className="mt-2 space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">Покрытие группы</span>
                                <span className="font-medium">{groupCoveragePercent}% ({groupAnnotated}/{groupChunks.length})</span>
                              </div>
                              <Progress value={groupCoveragePercent} className="h-1.5" />
                            </div>
                          )}
                        </CardHeader>
                        <CardContent>
                          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                            {groupChunks.map((chunk) => {
                              const hasAnnotation = !!chunk.annotation;
                              const isNomenclature = chunk.annotation?.isNomenclatureTable || false;

                              return (
                                <Card
                                  key={chunk.chunkIndex}
                                  className={`transition-all hover:shadow-md ${
                                    hasAnnotation
                                      ? getAnnotationTypeColor(
                                          chunk.annotation!.annotationType,
                                          isNomenclature
                                        )
                                      : "bg-muted/50"
                                  }`}
                                >
                                  <CardHeader className="pb-2">
                                    <div className="flex items-center justify-between">
                                      <CardTitle className="text-sm">Чанк #{chunk.chunkIndex}</CardTitle>
                                      {hasAnnotation && (
                                        <div className="flex gap-1">
                                          {getAnnotationTypeIcon(chunk.annotation!.annotationType)}
                                          {isNomenclature && <Tag className="w-3 h-3 text-green-600" />}
                                        </div>
                                      )}
                                    </div>
                                  </CardHeader>
                                  <CardContent className="space-y-2">
                                    {hasAnnotation && (
                                      <Badge
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        {chunk.annotation!.annotationType === "table_with_articles"
                                          ? "Таблица с артикулами"
                                          : chunk.annotation!.annotationType === "table"
                                          ? "Таблица"
                                          : chunk.annotation!.annotationType === "figure"
                                          ? "Рисунок"
                                          : chunk.annotation!.annotationType === "list"
                                          ? "Список"
                                          : "Текст"}
                                      </Badge>
                                    )}
                                    <div className="text-xs text-muted-foreground">
                                      <div>Страница: {chunk.pageNumber || "?"}</div>
                                      <div>Раздел: {chunk.sectionPath || "не указан"}</div>
                                      <div>Токены: {chunk.tokenCount}</div>
                                      {chunk.tableJson && chunk.tableJson.length > 0 && (
                                        <div className="text-blue-600">📊 {chunk.tableJson.length} строк</div>
                                      )}
                                    </div>
                                    <div className="text-xs line-clamp-2 text-muted-foreground">
                                      {chunk.content.slice(0, 100)}...
                                    </div>
                                  </CardContent>
                                </Card>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Legend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Легенда</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded border-2 bg-green-500/20 border-green-500" />
              <span>Номенклатурная таблица</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded border-2 bg-blue-500/20 border-blue-500" />
              <span>Таблица</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded border-2 bg-purple-500/20 border-purple-500" />
              <span>Рисунок</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded border-2 bg-orange-500/20 border-orange-500" />
              <span>Список</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded border-2 bg-gray-500/20 border-gray-500" />
              <span>Текст</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-blue-100 dark:bg-blue-900/30" />
              <span>Товарная группа</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-muted/50" />
              <span>Без разметки</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

