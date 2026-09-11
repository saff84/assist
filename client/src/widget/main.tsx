import { createRoot, type Root } from "react-dom/client";
import { WebChatWidget, type WebChatWidgetProps } from "@/components/WebChatWidget";
import "@/index.css";

export type SanextChatWidgetOptions = WebChatWidgetProps & {
  apiBaseUrl?: string;
};

declare global {
  interface Window {
    SanextChatWidget?: {
      init: (options?: SanextChatWidgetOptions) => void;
      destroy: () => void;
    };
  }
}

const ROOT_ID = "sanext-chat-widget-root";
const SCRIPT_ATTR = "data-sanext-chat-widget";
let widgetRoot: Root | null = null;
let bootstrapped = false;

function findWidgetScript(): HTMLScriptElement | null {
  const current = document.currentScript as HTMLScriptElement | null;
  if (current?.src && current.src.includes("chat-widget")) {
    return current;
  }

  const marked = document.querySelector<HTMLScriptElement>(`script[${SCRIPT_ATTR}]`);
  if (marked) return marked;

  const scripts = Array.from(document.getElementsByTagName("script"));
  return (
    scripts.find((script) => script.src && script.src.includes("chat-widget.js")) ?? null
  );
}

function ensureWidgetStyles(apiBaseUrl: string, script?: HTMLScriptElement | null) {
  if (document.getElementById("sanext-chat-widget-styles")) {
    return;
  }

  let href: string | null = null;
  if (script?.src) {
    href = script.src.replace(/\.js(\?.*)?$/, ".css$1");
  } else if (apiBaseUrl) {
    href = `${apiBaseUrl.replace(/\/+$/, "")}/chat-widget.css`;
  }

  if (!href) return;

  const link = document.createElement("link");
  link.id = "sanext-chat-widget-styles";
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function resolveApiBaseUrl(
  options?: SanextChatWidgetOptions,
  script?: HTMLScriptElement | null
): string {
  if (options?.apiBaseUrl?.trim()) {
    return options.apiBaseUrl.trim().replace(/\/+$/, "");
  }

  const fromData = script?.getAttribute("data-api-url")?.trim();
  if (fromData) {
    return fromData.replace(/\/+$/, "");
  }

  if (script?.src) {
    try {
      return new URL(script.src).origin;
    } catch {
      // ignore
    }
  }

  return window.location.origin;
}

function readScriptOptions(script?: HTMLScriptElement | null): SanextChatWidgetOptions {
  const position = script?.getAttribute("data-position");
  return {
    title: script?.getAttribute("data-title") ?? undefined,
    subtitle: script?.getAttribute("data-subtitle") ?? undefined,
    position: position === "bottom-left" ? "bottom-left" : "bottom-right",
    apiBaseUrl: script?.getAttribute("data-api-url") ?? undefined,
  };
}

function mountWidget(options?: SanextChatWidgetOptions) {
  const script = findWidgetScript();
  const merged = { ...readScriptOptions(script), ...options };
  const apiBaseUrl = resolveApiBaseUrl(merged, script);
  ensureWidgetStyles(apiBaseUrl, script);

  let container = document.getElementById(ROOT_ID);
  if (!container) {
    container = document.createElement("div");
    container.id = ROOT_ID;
    document.body.appendChild(container);
  }

  if (!widgetRoot) {
    widgetRoot = createRoot(container);
  }

  widgetRoot.render(
    <WebChatWidget
      apiBaseUrl={apiBaseUrl}
      title={merged.title}
      subtitle={merged.subtitle}
      position={merged.position}
    />
  );
}

function destroyWidget() {
  widgetRoot?.unmount();
  widgetRoot = null;
  document.getElementById(ROOT_ID)?.remove();
  bootstrapped = false;
}

function bootstrap(options?: SanextChatWidgetOptions) {
  if (bootstrapped && !options) return;
  bootstrapped = true;

  const run = () => mountWidget(options);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
}

window.SanextChatWidget = {
  init: (options) => bootstrap(options),
  destroy: () => destroyWidget(),
};

const scriptEl = findWidgetScript();
const autoInit = scriptEl?.getAttribute("data-auto-init");
if (autoInit !== "false") {
  bootstrap();
}
