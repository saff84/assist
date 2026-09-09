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
let widgetRoot: Root | null = null;

function ensureWidgetStyles() {
  if (document.getElementById("sanext-chat-widget-styles")) {
    return;
  }

  const script = document.currentScript as HTMLScriptElement | null;
  if (!script?.src) {
    return;
  }

  const link = document.createElement("link");
  link.id = "sanext-chat-widget-styles";
  link.rel = "stylesheet";
  link.href = script.src.replace(/\.js(\?.*)?$/, ".css$1");
  document.head.appendChild(link);
}

function resolveApiBaseUrl(options?: SanextChatWidgetOptions): string {
  if (options?.apiBaseUrl?.trim()) {
    return options.apiBaseUrl.trim().replace(/\/+$/, "");
  }

  const script = document.currentScript as HTMLScriptElement | null;
  const fromData = script?.getAttribute("data-api-url")?.trim();
  if (fromData) {
    return fromData.replace(/\/+$/, "");
  }

  if (script?.src) {
    try {
      const scriptUrl = new URL(script.src);
      return scriptUrl.origin;
    } catch {
      // ignore invalid script URL
    }
  }

  return window.location.origin;
}

function readScriptOptions(): SanextChatWidgetOptions {
  const script = document.currentScript as HTMLScriptElement | null;
  const position = script?.getAttribute("data-position");
  return {
    title: script?.getAttribute("data-title") ?? undefined,
    subtitle: script?.getAttribute("data-subtitle") ?? undefined,
    position: position === "bottom-left" ? "bottom-left" : "bottom-right",
    apiBaseUrl: script?.getAttribute("data-api-url") ?? undefined,
  };
}

function mountWidget(options?: SanextChatWidgetOptions) {
  ensureWidgetStyles();
  const apiBaseUrl = resolveApiBaseUrl(options);
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
      title={options?.title}
      subtitle={options?.subtitle}
      position={options?.position}
    />
  );
}

function destroyWidget() {
  widgetRoot?.unmount();
  widgetRoot = null;
  document.getElementById(ROOT_ID)?.remove();
}

window.SanextChatWidget = {
  init: (options) => mountWidget(options),
  destroy: () => destroyWidget(),
};

const autoInit = document.currentScript?.getAttribute("data-auto-init");
if (autoInit !== "false") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => mountWidget(readScriptOptions()));
  } else {
    mountWidget(readScriptOptions());
  }
}
