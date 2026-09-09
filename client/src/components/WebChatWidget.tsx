import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Send, X, MessageCircle } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { WidgetApiClient, type WidgetAttachment, type WidgetDocumentType } from "@/widget/api";

interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  attachments?: WidgetAttachment[];
}

type ChatTopic = "products" | "certificates" | "passports" | "warranty";
type ForcedDocType = Exclude<WidgetDocumentType, "instruction" | "general">;

export interface WebChatWidgetProps {
  title?: string;
  subtitle?: string;
  position?: "bottom-right" | "bottom-left";
  apiBaseUrl?: string;
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

function resolveApiBaseUrl(apiBaseUrl?: string): string {
  if (apiBaseUrl?.trim()) {
    return apiBaseUrl.trim().replace(/\/+$/, "");
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "";
}

export function WebChatWidget({
  title = "AI Assistant",
  subtitle = "Ask me anything",
  position = "bottom-right",
  apiBaseUrl,
}: WebChatWidgetProps) {
  const resolvedApiBaseUrl = resolveApiBaseUrl(apiBaseUrl);
  const widgetApi = useRef(new WidgetApiClient(resolvedApiBaseUrl));

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId] = useState(() => `session-${Date.now()}-${Math.random()}`);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>("idle");
  const [isSending, setIsSending] = useState(false);
  const stageTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const [topic, setTopic] = useState<ChatTopic | null>(null);
  const [forceDocumentType, setForceDocumentType] = useState<ForcedDocType | null>(null);
  const [availableTopics, setAvailableTopics] = useState({
    hasCertificates: false,
    hasPassports: false,
    hasWarrantyFaq: false,
  });

  useEffect(() => {
    widgetApi.current = new WidgetApiClient(resolvedApiBaseUrl);
    widgetApi.current
      .getTopics()
      .then(setAvailableTopics)
      .catch(() => {
        setAvailableTopics({
          hasCertificates: false,
          hasPassports: false,
          hasWarrantyFaq: false,
        });
      });
  }, [resolvedApiBaseUrl]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(
    () => () => {
      stageTimers.current.forEach((timer) => clearTimeout(timer));
    },
    []
  );

  const appendAssistantMessage = (content: string, attachments: WidgetAttachment[] = []) => {
    setProcessingStage("type");
    setTimeout(() => setProcessingStage("idle"), 400);
    setMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}`,
        type: "assistant",
        content,
        attachments,
      },
    ]);
  };

  const handleSendMessage = async () => {
    if (!input.trim() || processingStage !== "idle" || !forceDocumentType || isSending) return;

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      type: "user",
      content: input,
    };
    const query = input;
    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    setProcessingStage("search");
    setIsSending(true);
    stageTimers.current.forEach((timer) => clearTimeout(timer));
    stageTimers.current = [
      setTimeout(() => {
        setProcessingStage((prev) => (prev === "search" ? "think" : prev));
      }, 2000),
      setTimeout(() => {
        setProcessingStage((prev) =>
          stageOrder.indexOf(prev) < stageOrder.indexOf("type") ? "type" : prev
        );
      }, 3500),
    ];

    try {
      const response = await widgetApi.current.askAssistant({
        query,
        sessionId,
        forceDocumentType,
      });
      appendAssistantMessage(response.response, response.attachments ?? []);
    } catch {
      setProcessingStage("idle");
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}`,
          type: "assistant",
          content: "Не удалось получить ответ. Попробуйте ещё раз.",
        },
      ]);
    } finally {
      stageTimers.current.forEach((timer) => clearTimeout(timer));
      stageTimers.current = [];
      setIsSending(false);
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
        content: followUp,
      },
    ]);
  };

  const positionClasses = position === "bottom-right" ? "bottom-4 right-4" : "bottom-4 left-4";

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed ${positionClasses} z-[2147483000] p-4 bg-primary text-primary-foreground rounded-full shadow-lg hover:shadow-xl transition-shadow`}
        aria-label="Open chat"
      >
        <MessageCircle className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div
      className={`fixed ${positionClasses} z-[2147483000] w-96 h-[32rem] max-h-[calc(100vh-2rem)] bg-background border rounded-lg shadow-xl flex flex-col min-h-0 overflow-hidden`}
    >
      <div className="bg-primary text-primary-foreground p-4 rounded-t-lg flex justify-between items-center">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-xs opacity-90">{subtitle}</p>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="hover:bg-primary-foreground/20 p-1 rounded transition"
          aria-label="Close chat"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {processingStage !== "idle" && (
        <div className="px-4 py-1 border-b">
          <ProcessingTimeline stage={processingStage} />
        </div>
      )}

      {isSending && (
        <div className="flex justify-start px-4 pt-2">
          <div className="w-full px-3 py-2 rounded-lg bg-muted text-foreground">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>{stageLabel(processingStage === "idle" ? "think" : processingStage)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <div className="flex justify-start">
              <div className="w-full px-3 py-2 rounded-lg bg-muted text-foreground text-sm">
                <div className="font-medium mb-1">Здравствуйте!</div>
                <div className="text-muted-foreground">
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
                  {availableTopics.hasCertificates && (
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
                  {availableTopics.hasPassports && (
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
                  {availableTopics.hasWarrantyFaq && (
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
              </div>
            </div>

            <div className="flex items-center justify-center h-48 text-muted-foreground text-xs">
              <p>
                {forceDocumentType
                  ? "Теперь ответьте на уточняющий вопрос выше и отправьте сообщение."
                  : "Сначала выберите тематику."}
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.type === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`w-full px-3 py-2 rounded-lg text-sm ${
                  msg.type === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                {msg.type === "assistant" ? (
                  <MarkdownRenderer content={msg.content} />
                ) : (
                  msg.content
                )}
                {msg.type === "assistant" && msg.attachments && msg.attachments.length > 0 && (
                  <div className="mt-2">
                    <MessageAttachments attachments={msg.attachments} />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t p-3 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
          placeholder={forceDocumentType ? "Введите сообщение..." : "Выберите тематику выше..."}
          disabled={isSending || processingStage !== "idle" || !forceDocumentType}
          className="text-sm"
        />
        <Button
          onClick={handleSendMessage}
          disabled={!input.trim() || isSending || processingStage !== "idle" || !forceDocumentType}
          size="sm"
          className="gap-1"
        >
          {isSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
        </Button>
      </div>
    </div>
  );
}

function MessageAttachments({ attachments }: { attachments: WidgetAttachment[] }) {
  const docs = attachments.filter((a) => a.type === "document");
  if (!docs.length) return null;

  return (
    <div className="space-y-2">
      {docs.map((doc) => {
        const title = (doc.title && doc.title.trim()) || doc.filename;
        const isPdf =
          doc.fileType.toLowerCase() === "pdf" || doc.filename.toLowerCase().endsWith(".pdf");

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
                  className="h-48 w-full"
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
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      {stageOrder.map((key, idx) => (
        <div key={key} className="flex items-center gap-1">
          <div
            className={`h-2 w-2 rounded-full ${
              idx <= activeIndex ? "bg-primary animate-pulse" : "bg-muted-foreground/40"
            }`}
          />
          <span className={idx === activeIndex ? "text-primary font-semibold" : ""}>
            {stageLabels[key]}
          </span>
          {idx < stageOrder.length - 1 && <div className="h-px w-4 bg-border opacity-70" />}
        </div>
      ))}
    </div>
  );
}
