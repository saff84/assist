import { useState, useRef, useEffect, type CSSProperties } from "react";
import { Loader2, Send, X, MessageCircle, RotateCcw } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { WidgetApiClient, type WidgetAttachment, type WidgetSource } from "@/widget/api";
import "@/widget/widget.css";

interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  attachments?: WidgetAttachment[];
  sources?: WidgetSource[];
}

type ChatTopic = "products" | "instructions" | "certificates" | "passports" | "warranty";
type ForcedDocType =
  | "catalog"
  | "instruction"
  | "certificate"
  | "passport"
  | "warranty_faq";

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
  title = "SANEXT Assistant",
  subtitle = "Задайте вопрос по товарам",
  position = "bottom-right",
  apiBaseUrl,
}: WebChatWidgetProps) {
  const resolvedApiBaseUrl = resolveApiBaseUrl(apiBaseUrl);
  const widgetApi = useRef(new WidgetApiClient(resolvedApiBaseUrl));

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState(() => `session-${Date.now()}-${Math.random()}`);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>("idle");
  const [isSending, setIsSending] = useState(false);
  const stageTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const [topic, setTopic] = useState<ChatTopic | null>(null);
  const [forceDocumentType, setForceDocumentType] = useState<ForcedDocType | null>(null);
  const [availableTopics, setAvailableTopics] = useState({
    hasInstructions: false,
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
          hasInstructions: false,
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

  const appendAssistantMessage = (
    content: string,
    attachments: WidgetAttachment[] = [],
    sources: WidgetSource[] = []
  ) => {
    setProcessingStage("type");
    setTimeout(() => setProcessingStage("idle"), 400);
    setMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}`,
        type: "assistant",
        content,
        attachments,
        sources,
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
      appendAssistantMessage(
        response.response,
        response.attachments ?? [],
        response.sources ?? []
      );
    } catch (error) {
      setProcessingStage("idle");
      console.error("[SANEXT Widget] chat failed:", error);
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

  const handleNewQuestion = () => {
    if (isSending || processingStage !== "idle") return;
    stageTimers.current.forEach((timer) => clearTimeout(timer));
    stageTimers.current = [];
    setMessages([]);
    setInput("");
    setTopic(null);
    setForceDocumentType(null);
    setProcessingStage("idle");
    setSessionId(`session-${Date.now()}-${Math.random()}`);
  };

  const handlePickTopic = (picked: ChatTopic) => {
    if (processingStage !== "idle") return;
    setTopic(picked);
    const forced: ForcedDocType =
      picked === "products"
        ? "catalog"
        : picked === "instructions"
          ? "instruction"
          : picked === "certificates"
            ? "certificate"
            : picked === "passports"
              ? "passport"
              : "warranty_faq";
    setForceDocumentType(forced);

    const followUp =
      picked === "products"
        ? "Уточните, пожалуйста: какой товар (артикул/наименование) и что именно нужно — характеристики, подбор/совместимость, комплектация?"
        : picked === "instructions"
          ? "Уточните, пожалуйста: по какому изделию/системе нужен монтаж или инструкция и какой этап вас интересует?"
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

  const positionStyle: CSSProperties =
    position === "bottom-left"
      ? { bottom: "1.25rem", left: "1.25rem" }
      : { bottom: "1.25rem", right: "1.25rem" };

  if (!isOpen) {
    return (
      <div className="sanext-widget" style={{ position: "fixed", zIndex: 2147483000, ...positionStyle }}>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="sanext-widget-launcher"
          aria-label="Открыть чат SANEXT"
        >
          <MessageCircle className="w-7 h-7" strokeWidth={2.1} />
        </button>
      </div>
    );
  }

  return (
    <div className="sanext-widget" style={{ position: "fixed", zIndex: 2147483000, ...positionStyle }}>
      <div className="sanext-widget-panel">
        <div className="sanext-widget-header">
          <div className="sanext-widget-brand">
            <span className="sanext-widget-brand-eyebrow">SANEXT</span>
            <h3 className="sanext-widget-brand-title">{title}</h3>
            <p className="sanext-widget-brand-subtitle">{subtitle}</p>
          </div>
          <div className="sanext-widget-header-actions">
            {(messages.length > 0 || forceDocumentType) && (
              <button
                type="button"
                onClick={handleNewQuestion}
                className="sanext-widget-new-question"
                disabled={isSending || processingStage !== "idle"}
                aria-label="Задать новый вопрос"
                title="Задать новый вопрос"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Новый вопрос</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="sanext-widget-close"
              aria-label="Закрыть чат"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {processingStage !== "idle" && (
          <div className="sanext-widget-stage">
            <ProcessingTimeline stage={processingStage} />
          </div>
        )}

        {isSending && (
          <div className="px-4 pt-3">
            <div className="sanext-widget-bubble sanext-widget-bubble-assistant">
              <div className="flex items-center gap-2 text-sm text-[var(--sx-muted)]">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--sx-blue-deep)]" />
                <span>{stageLabel(processingStage === "idle" ? "think" : processingStage)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="sanext-widget-messages space-y-3">
          {messages.length === 0 ? (
            <div className="space-y-3">
              <div className="sanext-widget-bubble sanext-widget-bubble-assistant">
                <div className="font-semibold mb-1 text-[15px]">Здравствуйте!</div>
                <div className="text-[var(--sx-muted)] text-[13px]">
                  Чтобы точнее искать по базе знаний, выберите тематику вопроса:
                </div>
                <div className="sanext-widget-topics">
                  <button
                    type="button"
                    className={`sanext-widget-topic ${topic === "products" ? "sanext-widget-topic-active" : ""}`}
                    onClick={() => handlePickTopic("products")}
                    disabled={processingStage !== "idle"}
                  >
                    Вопрос по: Товарам
                  </button>
                  {availableTopics.hasInstructions && (
                    <button
                      type="button"
                      className={`sanext-widget-topic ${topic === "instructions" ? "sanext-widget-topic-active" : ""}`}
                      onClick={() => handlePickTopic("instructions")}
                      disabled={processingStage !== "idle"}
                    >
                      Вопрос по: Инструкциям
                    </button>
                  )}
                  {availableTopics.hasCertificates && (
                    <button
                      type="button"
                      className={`sanext-widget-topic ${topic === "certificates" ? "sanext-widget-topic-active" : ""}`}
                      onClick={() => handlePickTopic("certificates")}
                      disabled={processingStage !== "idle"}
                    >
                      Вопрос по: Сертификатам
                    </button>
                  )}
                  {availableTopics.hasPassports && (
                    <button
                      type="button"
                      className={`sanext-widget-topic ${topic === "passports" ? "sanext-widget-topic-active" : ""}`}
                      onClick={() => handlePickTopic("passports")}
                      disabled={processingStage !== "idle"}
                    >
                      Вопрос по: Паспортам
                    </button>
                  )}
                  {availableTopics.hasWarrantyFaq && (
                    <button
                      type="button"
                      className={`sanext-widget-topic ${topic === "warranty" ? "sanext-widget-topic-active" : ""}`}
                      onClick={() => handlePickTopic("warranty")}
                      disabled={processingStage !== "idle"}
                    >
                      Вопрос по: По гарантии
                    </button>
                  )}
                </div>
              </div>

              <p className="sanext-widget-hint">
                {forceDocumentType
                  ? "Теперь ответьте на уточняющий вопрос выше и отправьте сообщение."
                  : "Сначала выберите тематику."}
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.type === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`sanext-widget-bubble ${
                    msg.type === "user"
                      ? "sanext-widget-bubble-user"
                      : "sanext-widget-bubble-assistant"
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
                  {msg.type === "assistant" && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2">
                      <MessageSources sources={msg.sources} />
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="sanext-widget-footer">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
            placeholder={forceDocumentType ? "Введите сообщение..." : "Выберите тематику выше..."}
            disabled={isSending || processingStage !== "idle" || !forceDocumentType}
            className="sanext-widget-input"
          />
          <button
            type="button"
            onClick={handleSendMessage}
            disabled={!input.trim() || isSending || processingStage !== "idle" || !forceDocumentType}
            className="sanext-widget-send"
            aria-label="Отправить"
          >
            {isSending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageSources({ sources }: { sources: WidgetSource[] }) {
  const unique = new Map<string, WidgetSource>();
  for (const s of sources) {
    const key = `${s.documentId}:${s.filename}`;
    if (!unique.has(key)) unique.set(key, s);
  }
  const list = Array.from(unique.values()).slice(0, 5);
  if (!list.length) return null;

  return (
    <div className="sanext-widget-sources">
      <div className="sanext-widget-sources-label">Источники</div>
      <ul>
        {list.map((s) => (
          <li key={`${s.documentId}-${s.chunkIndex}`}>
            {s.filename}
            {s.pageNumber ? `, стр. ${s.pageNumber}` : ""}
            {s.sectionPath ? ` · ${s.sectionPath}` : ""}
          </li>
        ))}
      </ul>
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
          <div key={`${doc.type}-${doc.documentId}`} className="sanext-widget-attach">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">{title}</div>
                <div className="text-[11px] text-[var(--sx-muted)] truncate">{doc.filename}</div>
              </div>
              <div className="sanext-widget-attach-actions">
                <a
                  href={doc.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="sanext-widget-attach-link"
                >
                  Открыть
                </a>
                <a href={doc.downloadUrl} className="sanext-widget-attach-link">
                  Скачать
                </a>
              </div>
            </div>
            {isPdf && (
              <div className="mt-2 overflow-hidden rounded-lg border border-[var(--sx-border)] bg-white">
                <iframe
                  title={`preview-${doc.documentId}`}
                  src={doc.previewUrl}
                  className="h-52 w-full"
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
    <div className="flex items-center gap-2 text-[11px] text-[var(--sx-muted)]">
      {stageOrder.map((key, idx) => (
        <div key={key} className="flex items-center gap-1">
          <div
            className={`sanext-widget-stage-dot ${
              idx <= activeIndex ? "sanext-widget-stage-dot-active" : ""
            }`}
          />
          <span
            className={
              idx === activeIndex ? "text-[var(--sx-blue-deep)] font-semibold" : undefined
            }
          >
            {stageLabels[key]}
          </span>
          {idx < stageOrder.length - 1 && (
            <div className="h-px w-4 bg-[var(--sx-border)] opacity-80" />
          )}
        </div>
      ))}
    </div>
  );
}
