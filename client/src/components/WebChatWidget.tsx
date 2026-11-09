import { ChatGreeting } from "@/components/ChatGreeting";
import { useState, useRef, useEffect, type CSSProperties } from "react";
import { Loader2, Send, X, MessageCircle, RotateCcw } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { WidgetApiClient, WidgetConsentRequiredError, type WidgetAttachment, type WidgetSource } from "@/widget/api";
import type { WidgetConsentConfig } from "@shared/widgetConsent";
import "@/widget/widget.css";
import { defaultWidgetAppearance, widgetAppearanceSchema } from "@shared/widgetAppearance";

interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  attachments?: WidgetAttachment[];
  sources?: WidgetSource[];
  suggestedTopics?: ChatTopic[];
}

type ChatTopic = "products" | "instructions" | "installation" | "certificates" | "passports" | "warranty";
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
  title,
  subtitle,
  position = "bottom-right",
  apiBaseUrl,
}: WebChatWidgetProps) {
  const resolvedApiBaseUrl = resolveApiBaseUrl(apiBaseUrl);
  const widgetApi = useRef(new WidgetApiClient(resolvedApiBaseUrl));

  const [isOpen, setIsOpen] = useState(false);
  const [appearance, setAppearance] = useState(defaultWidgetAppearance);
  const [failedLogo, setFailedLogo] = useState("");
  useEffect(() => {
    let controller: AbortController | undefined;
    const refresh = () => {
      controller?.abort();
      controller = new AbortController();
      void fetch(`${resolvedApiBaseUrl}/api/widget/appearance`, { cache: "no-store", signal: controller.signal })
        .then(response => { if (!response.ok) throw new Error("Appearance unavailable"); return response.json(); })
        .then(value => setAppearance(widgetAppearanceSchema.parse(value)))
        .catch(() => { /* Keep the last available appearance when offline. */ });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { controller?.abort(); window.removeEventListener("focus", refresh); };
  }, [resolvedApiBaseUrl, isOpen]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState(() => `session-${Date.now()}-${Math.random()}`);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>("idle");
  const [isSending, setIsSending] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [consentPrompt, setConsentPrompt] = useState<WidgetConsentConfig | null>(null);
  const [acceptedConsentVersion, setAcceptedConsentVersion] = useState<string>();
  const [acceptedConsentToken, setAcceptedConsentToken] = useState<string>();
  const [isCheckingConsent, setIsCheckingConsent] = useState(false);
  const [consentError, setConsentError] = useState("");
  const sendingLock = useRef(false);
  const stageTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  useEffect(() => {
    widgetApi.current = new WidgetApiClient(resolvedApiBaseUrl);
  }, [resolvedApiBaseUrl]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, consentPrompt, consentError]);

  useEffect(
    () => () => {
      stageTimers.current.forEach((timer) => clearTimeout(timer));
    },
    []
  );

  const appendAssistantMessage = (
    content: string,
    attachments: WidgetAttachment[] = [],
    sources: WidgetSource[] = [],
    suggestedTopics: ChatTopic[] = []
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
        suggestedTopics,
      },
    ]);
  };

  const handleSendMessage = async () => {
    if (!input.trim() || processingStage !== "idle" || sendingLock.current || pendingQuestion !== null) return;
    sendingLock.current = true;
    const query = input;
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      type: "user",
      content: query,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setPendingQuestion(query);
    await checkConsentAndSend(query);
  };

  const checkConsentAndSend = async (query: string) => {
    setIsCheckingConsent(true);
    setConsentError("");
    try {
      const consent = await widgetApi.current.getConsent();
      if (consent.enabled && consent.version !== acceptedConsentVersion) {
        setConsentPrompt(consent);
        return;
      }
      setConsentPrompt(null);
      await sendQuestion(query, acceptedConsentToken);
    } catch {
      setConsentError("Не удалось проверить настройки согласия. Вопрос ещё не отправлен. Повторите попытку.");
    } finally {
      setIsCheckingConsent(false);
      sendingLock.current = false;
    }
  };

  const sendQuestion = async (query: string, consentToken?: string) => {
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
        consentToken,
      });
      appendAssistantMessage(
        response.response,
        response.attachments ?? [],
        response.sources ?? [],
        response.suggestedTopics ?? []
      );
      setPendingQuestion(null);
    } catch (error) {
      setProcessingStage("idle");
      if (error instanceof WidgetConsentRequiredError) {
        setConsentPrompt(error.consent);
        setAcceptedConsentVersion(undefined);
        setAcceptedConsentToken(undefined);
        return;
      }
      setPendingQuestion(null);
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

  const acceptConsent = async () => {
    if (!consentPrompt || pendingQuestion === null || sendingLock.current) return;
    sendingLock.current = true;
    const version = consentPrompt.version;
    setIsCheckingConsent(true);
    setConsentError("");
    try {
      const token = await widgetApi.current.acceptConsent(sessionId, version);
      setAcceptedConsentVersion(version);
      setAcceptedConsentToken(token);
      setConsentPrompt(null);
      await sendQuestion(pendingQuestion, token);
    } catch (error) {
      if (error instanceof WidgetConsentRequiredError) setConsentPrompt(error.consent.enabled ? error.consent : null);
      setConsentError("Не удалось подтвердить согласие. Вопрос ещё не отправлен. Повторите попытку.");
    } finally { sendingLock.current = false; setIsCheckingConsent(false); }
  };

  const handleNewQuestion = () => {
    if (sendingLock.current || isSending || processingStage !== "idle") return;
    stageTimers.current.forEach((timer) => clearTimeout(timer));
    stageTimers.current = [];
    setMessages([]);
    setInput("");
    setPendingQuestion(null);
    setConsentPrompt(null);
    setConsentError("");
    setAcceptedConsentVersion(undefined);
    setAcceptedConsentToken(undefined);
    setProcessingStage("idle");
    setSessionId(`session-${Date.now()}-${Math.random()}`);
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
          <MessageCircle className="w-8 h-8" strokeWidth={2.1} />
        </button>
      </div>
    );
  }

  return (
    <div className="sanext-widget" style={{ position: "fixed", zIndex: 2147483000, ...positionStyle }}>
      <div className="sanext-widget-panel">
        <div className="sanext-widget-header">
          <div className="sanext-widget-identity">
            {appearance.logoUrl && appearance.logoUrl !== failedLogo && <img className="sanext-widget-logo" src={appearance.logoUrl} alt="Логотип ассистента" onError={() => setFailedLogo(appearance.logoUrl)} />}
            <div className="sanext-widget-brand">
              {appearance.brand && <span className="sanext-widget-brand-eyebrow">{appearance.brand}</span>}
              <h3 className="sanext-widget-brand-title">{title ?? appearance.title}</h3>
              {(subtitle ?? appearance.subtitle) && <p className="sanext-widget-brand-subtitle">{subtitle ?? appearance.subtitle}</p>}
            </div>
          </div>
          <div className="sanext-widget-header-actions">
            {(messages.length > 0) && (
              <button
                type="button"
                onClick={handleNewQuestion}
                className="sanext-widget-new-question"
                disabled={isSending || isCheckingConsent || processingStage !== "idle"}
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
            <div className="sanext-widget-bubble sanext-widget-bubble-assistant space-y-3">
              <ChatGreeting apiBaseUrl={resolvedApiBaseUrl}/>
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
          {isCheckingConsent && !isSending && <p role="status" className="sanext-widget-hint">Проверяю настройки диалога…</p>}
          {consentPrompt && <section aria-label="Согласие на обработку персональных данных" className="sanext-widget-consent">
            <div className="sanext-widget-bubble sanext-widget-bubble-assistant">
              <p className="sanext-widget-consent-text">{consentPrompt.text}</p>
              {consentPrompt.policyUrl && <a className="sanext-widget-consent-link" href={consentPrompt.policyUrl} target="_blank" rel="noopener noreferrer">{consentPrompt.policyUrl}</a>}
            </div>
            <button type="button" className="sanext-widget-consent-accept" disabled={isCheckingConsent} onClick={acceptConsent}>{isCheckingConsent ? "Сохранение…" : "ДАЮ СОГЛАСИЕ"}</button>
          </section>}
          {consentError && <div role="alert" className="sanext-widget-bubble sanext-widget-bubble-assistant">
            <p>{consentError}</p>
            <button type="button" className="sanext-widget-consent-accept" disabled={isCheckingConsent} onClick={() => {
              if (pendingQuestion !== null && !sendingLock.current) {
                sendingLock.current = true;
                void checkConsentAndSend(pendingQuestion);
              }
            }}>Повторить</button>
          </div>}
          <div ref={messagesEndRef} />
        </div>

        <div className="sanext-widget-footer">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
            placeholder="Задайте вопрос об изделии или укажите артикул…"
            disabled={isSending || pendingQuestion !== null || processingStage !== "idle"}
            className="sanext-widget-input"
          />
          <button
            type="button"
            onClick={handleSendMessage}
            disabled={!input.trim() || isSending || pendingQuestion !== null || processingStage !== "idle"}
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
            {stageLabels[key as Exclude<ProcessingStage, "idle">]}
          </span>
          {idx < stageOrder.length - 1 && (
            <div className="h-px w-4 bg-[var(--sx-border)] opacity-80" />
          )}
        </div>
      ))}
    </div>
  );
}
