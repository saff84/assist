import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Send, Eye } from "lucide-react";
import { toast } from "sonner";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  attachments?: Array<{
    type: "document";
    documentId: number;
    filename: string;
    title?: string | null;
    fileType: string;
    docType: "catalog" | "instruction" | "general" | "certificate" | "passport" | "warranty_faq";
    previewUrl: string;
    downloadUrl: string;
  }>;
  sources?: Array<{
    documentId: number;
    filename: string;
    chunkIndex: number;
    relevance: number;
    chunkContent?: string;
  }>;
  chunks?: Array<{
    documentId: number;
    chunkIndex: number;
    sectionPath: string;
    pageNumber: number;
    elementType: string;
    filename: string;
    relevance: number;
    hasTable: boolean;
    chunkContent?: string;
  }>;
  responseTime?: number;
}

type ProcessingStage = "idle" | "search" | "think" | "type";
const stageOrder: ProcessingStage[] = ["search", "think", "type"];
const stageLabels: Record<Exclude<ProcessingStage, "idle">, string> = {
  search: "Ищу информацию",
  think: "Думаю",
  type: "Печатаю",
};
const stageLabel = (stage: ProcessingStage) => {
  switch (stage) {
    case "search":
      return stageLabels.search;
    case "think":
      return stageLabels.think;
    case "type":
      return stageLabels.type;
    default:
      return stageLabels.think;
  }
};

type ChatTopic = "products" | "certificates" | "passports" | "warranty";
type ForcedDocType = "catalog" | "certificate" | "passport" | "warranty_faq";

export default function TestPanelPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId] = useState(() => `session-${Date.now()}-${Math.random()}`);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>("idle");
  const stageTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const [topic, setTopic] = useState<ChatTopic | null>(null);
  const [forceDocumentType, setForceDocumentType] = useState<ForcedDocType | null>(null);
  const { data: availableTopics } = trpc.document.getAvailableChatTopics.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(
    () => () => {
      stageTimers.current.forEach((timer) => clearTimeout(timer));
      stageTimers.current = [];
    },
    []
  );
  const [selectedChunk, setSelectedChunk] = useState<{
    documentId: number;
    chunkIndex: number;
    sectionPath: string;
    pageNumber: number;
    elementType: string;
    filename: string;
    relevance: number;
    hasTable: boolean;
    chunkContent?: string;
  } | null>(null);

  // Ask assistant mutation
  const askMutation = trpc.document.askAssistant.useMutation({
    onError: (error) => {
      toast.error(error.message || "Failed to get response");
    },
  });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim() || processingStage !== "idle" || !forceDocumentType) return;

    // Add user message
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      type: "user",
      content: input,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    try {
      setProcessingStage("search");
      stageTimers.current.forEach((timer) => clearTimeout(timer));
      stageTimers.current = [
        setTimeout(() => {
          setProcessingStage((prev) =>
            prev === "search" ? "think" : prev
          );
        }, 2000),
        setTimeout(() => {
          setProcessingStage((prev) =>
            stageOrder.indexOf(prev) < stageOrder.indexOf("type") ? "type" : prev
          );
        }, 3500),
      ];
      const response = await askMutation.mutateAsync({
      query: input,
      sessionId,
      source: "test",
      forceDocumentType,
    });
      stageTimers.current.forEach((timer) => clearTimeout(timer));
      stageTimers.current = [];
      setProcessingStage("think");
      await new Promise((resolve) => setTimeout(resolve, 300));
      setProcessingStage("type");
      const assistantMessage: Message = {
        id: `msg-${Date.now()}`,
        type: "assistant",
        content: response.response,
        sources: response.sources,
        chunks: response.chunks,
        attachments: response.attachments ?? [],
        responseTime: response.responseTime,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      await new Promise((resolve) => setTimeout(resolve, 400));
      setProcessingStage("idle");
    } catch (error) {
      stageTimers.current.forEach((timer) => clearTimeout(timer));
      stageTimers.current = [];
      setProcessingStage("idle");
    }
  };

  const handlePickTopic = (picked: ChatTopic) => {
    if (processingStage !== "idle") return;
    setTopic(picked);
    const forced: ForcedDocType =
      picked === "products"
        ? "catalog"
        : picked === "certificates"
          ? "certificate"
          : picked === "passports"
            ? "passport"
            : "warranty_faq";
    setForceDocumentType(forced);

    const followUp =
      picked === "products"
        ? "Уточните, пожалуйста: какой товар (артикул/наименование) и что именно нужно — характеристики, подбор/совместимость, комплектация?"
        : picked === "certificates"
          ? "Уточните, пожалуйста: по какому товару (артикул/наименование) нужен сертификат и какой именно (например, соответствия/пожарный/гигиенический)?"
          : picked === "passports"
            ? "Уточните, пожалуйста: по какому изделию/модели нужен паспорт и какой раздел/параметры вас интересуют?"
          : "Уточните, пожалуйста: по какому товару (артикул/наименование) вопрос по гарантии и в чём суть обращения (симптом/проблема/дата покупки)?";

    setMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}`,
        type: "assistant",
        content: `Здравствуйте! Чтобы точнее искать по базе знаний, уточню: ${followUp}`,
      },
    ]);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Тестовая панель</h1>
        <p className="text-muted-foreground mt-1">Тестирование ассистента и проверка ответов</p>
      </div>

      <div
        className="grid gap-6 lg:grid-cols-3 min-h-0 overflow-hidden"
        style={{ height: "calc(100vh - 200px)" }}
      >
        {/* Chat Area */}
        <div className="lg:col-span-2 min-h-0 h-full flex flex-col">
          <Card className="flex-1 min-h-0 flex flex-col overflow-hidden transition-all hover:shadow-md">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="flex items-center gap-2">
                <Send className="w-5 h-5 text-primary" />
                Чат
              </CardTitle>
              <CardDescription>Задавайте вопросы для тестирования ассистента</CardDescription>
              {processingStage !== "idle" && (
                <div className="mt-3">
                  <ProcessingTimeline stage={processingStage} />
                </div>
              )}
            </CardHeader>
            <CardContent className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-4 pt-4">
              {messages.length === 0 && !askMutation.isPending ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-10">
                  <div className="w-full max-w-2xl text-left">
                    <div className="p-4 rounded-lg border bg-muted/40">
                      <div className="font-semibold mb-1">Здравствуйте!</div>
                      <div className="text-sm text-muted-foreground">
                        Чтобы точнее искать по базе знаний, выберите тематику вопроса:
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={topic === "products" ? "default" : "outline"}
                          onClick={() => handlePickTopic("products")}
                          disabled={processingStage !== "idle"}
                        >
                          Вопрос по: Товарам
                        </Button>
                        {availableTopics?.hasCertificates && (
                          <Button
                            type="button"
                            size="sm"
                            variant={topic === "certificates" ? "default" : "outline"}
                            onClick={() => handlePickTopic("certificates")}
                            disabled={processingStage !== "idle"}
                          >
                            Вопрос по: Сертификатам
                          </Button>
                        )}
                        {availableTopics?.hasPassports && (
                          <Button
                            type="button"
                            size="sm"
                            variant={topic === "passports" ? "default" : "outline"}
                            onClick={() => handlePickTopic("passports")}
                            disabled={processingStage !== "idle"}
                          >
                            Вопрос по: Паспортам
                          </Button>
                        )}
                        {availableTopics?.hasWarrantyFaq && (
                          <Button
                            type="button"
                            size="sm"
                            variant={topic === "warranty" ? "default" : "outline"}
                            onClick={() => handlePickTopic("warranty")}
                            disabled={processingStage !== "idle"}
                          >
                            Вопрос по: По гарантии
                          </Button>
                        )}
                      </div>
                      <div className="mt-3 text-xs text-muted-foreground">
                        {forceDocumentType
                          ? "Теперь ответьте на уточняющий вопрос (в чате появится сообщение) и отправьте ответ ниже."
                          : "Сначала выберите тематику."}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.type === "user" ? "justify-end" : "justify-start"} gap-2`}
                    >
                      <div
                        className={`w-full max-w-3xl px-4 py-3 rounded-lg shadow-sm ${
                          msg.type === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground border"
                        }`}
                      >
                        <div className="text-sm leading-relaxed">
                          {msg.type === "assistant" ? (
                            <MarkdownRenderer content={msg.content} />
                          ) : (
                            msg.content
                          )}
                        </div>
                        {msg.type === "assistant" && msg.attachments && msg.attachments.length > 0 && (
                          <div className="mt-3">
                            <MessageAttachments attachments={msg.attachments} />
                          </div>
                        )}
                        {msg.type === "assistant" && msg.chunks && msg.chunks.length > 0 && (
                          <div className="text-xs mt-3 pt-3 border-t border-current/20">
                            <div className="font-semibold mb-2 opacity-90">Источники:</div>
                            <div className="space-y-1.5">
                              {msg.chunks.map((chunk, idx) => (
                                <div key={idx} className="opacity-80">
                                  <span className="font-medium">{chunk.filename}</span>
                                  <span className="opacity-70"> • раздел {chunk.sectionPath} • стр. {chunk.pageNumber}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {msg.responseTime && (
                          <div className="text-xs opacity-70 mt-2 pt-2 border-t border-current/10">
                            Время ответа: {msg.responseTime}мс
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {askMutation.isPending && (
                    <div className="flex justify-start">
                      <div className="w-full max-w-3xl px-4 py-2 rounded-lg bg-muted text-foreground">
                        <div className="flex items-center gap-2 text-sm">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>
                            {stageLabel(
                              processingStage === "idle" ? "think" : processingStage
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
              <div ref={messagesEndRef} />
            </CardContent>
          </Card>

          {/* Input Area */}
          <div className="flex gap-2 mt-4">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder={forceDocumentType ? "Введите сообщение..." : "Выберите тематику выше..."}
              disabled={askMutation.isPending || processingStage !== "idle" || !forceDocumentType}
              className="flex-1"
            />
            <Button
              onClick={handleSendMessage}
              disabled={
                !input.trim() ||
                askMutation.isPending ||
                processingStage !== "idle" ||
                !forceDocumentType
              }
              className="gap-2 shrink-0"
              size="default"
            >
              {askMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Отправка...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Отправить
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Info Panel */}
        <div className="min-h-0 h-full flex flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto space-y-4 pr-1">
            <Card className="transition-all hover:shadow-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="w-4 h-4 text-primary" />
                  Информация о сессии
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="font-medium text-foreground mb-1.5">ID сессии</p>
                  <p className="font-mono text-xs break-all text-muted-foreground">
                    {sessionId}
                  </p>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <span className="font-medium text-foreground">Сообщений:</span>
                  <span className="font-semibold text-primary">{messages.length}</span>
                </div>
              </CardContent>
            </Card>

            {/* Last Response Sources */}
            {messages.length > 0 && messages[messages.length - 1].type === "assistant" && (
              <>
                <Card className="transition-all hover:shadow-md">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Eye className="w-4 h-4 text-primary" />
                      Источники
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {messages[messages.length - 1].sources &&
                    messages[messages.length - 1].sources!.length > 0 ? (
                      <div className="space-y-2 text-sm">
                        {messages[messages.length - 1].sources!.map((source, idx) => (
                          <div
                            key={idx}
                            className="p-3 bg-muted/50 rounded-lg border transition-colors hover:bg-muted"
                          >
                            <p className="font-medium text-foreground mb-1">{source.filename}</p>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Чанк {source.chunkIndex}</span>
                              <span className="font-semibold text-primary">
                                Релевантность: {(source.relevance * 100).toFixed(0)}%
                              </span>
                            </div>
                            {source.chunkContent && (
                              <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap bg-background/60 p-2 rounded">
                                {source.chunkContent}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6">
                        <p className="text-sm text-muted-foreground">Источники не использованы</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Chunks Information */}
                {messages[messages.length - 1].chunks &&
                messages[messages.length - 1].chunks!.length > 0 && (
                  <Card className="transition-all hover:shadow-md">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Eye className="w-4 h-4 text-primary" />
                        Чанки документа
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Информация о чанках, использованных для формирования ответа
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        {messages[messages.length - 1].chunks!.map((chunk, idx) => (
                          <div
                            key={idx}
                            className="border rounded-lg p-3 space-y-2 text-xs bg-card transition-all hover:shadow-sm"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-foreground">
                                Чанк #{chunk.chunkIndex}
                              </span>
                              <span className="px-2 py-0.5 bg-primary/10 text-primary rounded-full font-medium text-xs">
                                {(chunk.relevance * 100).toFixed(0)}%
                              </span>
                            </div>
                            <div className="space-y-1 text-muted-foreground">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground">Документ:</span>
                                <span className="truncate">{chunk.filename}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground">Раздел:</span>
                                <span className="truncate">{chunk.sectionPath}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground">Страница:</span>
                                <span>{chunk.pageNumber}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground">Тип:</span>
                                <span className="px-1.5 py-0.5 bg-muted rounded text-xs">
                                  {chunk.elementType}
                                </span>
                              </div>
                              {chunk.hasTable && (
                                <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 font-medium mt-1">
                                  <span className="text-xs">✓</span>
                                  <span className="text-xs">Содержит таблицу</span>
                                </div>
                              )}
                            </div>
                            {chunk.chunkContent && (
                              <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded whitespace-pre-wrap max-h-32 overflow-auto">
                                {chunk.chunkContent}
                              </div>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-2 w-full text-xs"
                              onClick={() => setSelectedChunk(chunk)}
                            >
                              <Eye className="w-3 h-3 mr-2" />
                              Просмотреть содержимое
                            </Button>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Chunk Content Dialog */}
      {selectedChunk && (
        <ChunkContentDialog
          documentId={selectedChunk.documentId}
          chunkIndex={selectedChunk.chunkIndex}
          onClose={() => setSelectedChunk(null)}
        />
      )}
    </div>
  );
}

function MessageAttachments({
  attachments,
}: {
  attachments: NonNullable<Message["attachments"]>;
}) {
  const docs = attachments.filter((a) => a.type === "document");
  if (!docs.length) return null;

  return (
    <div className="space-y-2">
      {docs.map((doc) => {
        const title = (doc.title && doc.title.trim()) || doc.filename;
        const isPdf =
          doc.fileType.toLowerCase() === "pdf" ||
          doc.filename.toLowerCase().endsWith(".pdf");

        return (
          <div key={`${doc.type}-${doc.documentId}`} className="rounded-md border bg-background/60 p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">{title}</div>
                <div className="text-[11px] text-muted-foreground truncate">{doc.filename}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={doc.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 items-center justify-center rounded-md border px-2 text-xs hover:bg-muted"
                >
                  Открыть
                </a>
                <a
                  href={doc.downloadUrl}
                  className="inline-flex h-7 items-center justify-center rounded-md border px-2 text-xs hover:bg-muted"
                >
                  Скачать
                </a>
              </div>
            </div>
            {isPdf && (
              <div className="mt-2 overflow-hidden rounded border bg-background">
                <iframe
                  title={`preview-${doc.documentId}`}
                  src={doc.previewUrl}
                  className="h-56 w-full"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProcessingTimeline({ stage }: { stage: ProcessingStage }) {
  if (stage === "idle") return null;
  const activeIndex = stageOrder.indexOf(stage);
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {stageOrder.map((key, idx) => (
        <div key={key} className="flex items-center gap-2">
          <div
            className={`h-2.5 w-2.5 rounded-full ${
              idx <= activeIndex
                ? "bg-primary animate-pulse"
                : "bg-muted-foreground/40"
            }`}
          />
          <span
            className={`${
              idx === activeIndex ? "text-primary font-semibold" : ""
            }`}
          >
            {stageLabel(key)}
          </span>
          {idx < stageOrder.length - 1 && (
            <div className="h-px w-6 bg-border opacity-70" />
          )}
        </div>
      ))}
    </div>
  );
}

// Chunk Content Dialog Component for TestPanelPage
function ChunkContentDialog({
  documentId,
  chunkIndex,
  onClose,
}: {
  documentId: number;
  chunkIndex: number;
  onClose: () => void;
}) {
  const { data: chunk, isLoading } = trpc.document.getChunkContent.useQuery(
    { documentId, chunkIndex },
    { enabled: !!documentId && chunkIndex !== null }
  );

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[50vw] max-w-[50vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Полное содержимое чанка #{chunkIndex}</DialogTitle>
          <DialogDescription>
            Документ ID: {documentId}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : chunk ? (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium mb-2">Основное содержимое:</div>
              <div className="p-4 bg-muted rounded-md font-mono text-sm whitespace-pre-wrap max-h-96 overflow-auto">
                {chunk.fullContent}
              </div>
            </div>
            {chunk.tableData && chunk.tableData.rows.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">
                  Табличные данные ({chunk.tableData.rowCount} строк):
                </div>
                <div className="border rounded-md overflow-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        {chunk.tableData.columns.map((col) => (
                          <th key={col} className="p-2 text-left border-b">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {chunk.tableData.rows.map((row, idx) => (
                        <tr key={idx} className="border-b">
                          {chunk.tableData.columns.map((col) => (
                            <td key={col} className="p-2">
                              {String(row[col] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">Раздел:</span> {chunk.sectionPath || "не указан"}
              </div>
              <div>
                <span className="font-medium">Страница:</span> {chunk.pageNumber || "не указана"}
              </div>
              <div>
                <span className="font-medium">Тип:</span> {chunk.elementType}
              </div>
              <div>
                <span className="font-medium">Токены:</span> {chunk.tokenCount}
              </div>
            </div>
            {chunk.metadata && (
              <div>
                <div className="text-sm font-medium mb-2">Метаданные:</div>
                <div className="p-4 bg-muted rounded-md font-mono text-xs overflow-auto">
                  <pre>{JSON.stringify(chunk.metadata, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            Чанк не найден
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
