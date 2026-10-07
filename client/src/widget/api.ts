export type WidgetDocumentType =
  | "catalog"
  | "instruction"
  | "general"
  | "certificate"
  | "passport"
  | "warranty_faq"
  | "installation"
  | "company";

export type WidgetAttachment = {
  type: "document";
  documentId: number;
  filename: string;
  title?: string | null;
  fileType: string;
  docType: WidgetDocumentType;
  previewUrl: string;
  downloadUrl: string;
};

export type WidgetTopics = {
  hasInstructions: boolean;
  hasCertificates: boolean;
  hasPassports: boolean;
  hasWarrantyFaq: boolean;
  hasInstallation: boolean;
};

export type WidgetSource = {
  documentId: number;
  filename: string;
  chunkIndex: number;
  relevance: number;
  pageNumber?: number;
  sectionPath?: string | null;
};

export type WidgetSuggestedTopic =
  | "products"
  | "instructions"
  | "certificates"
  | "passports"
  | "installation"
  | "warranty";

export type WidgetChatResponse = {
  response: string;
  attachments: WidgetAttachment[];
  sources?: WidgetSource[];
  suggestedTopics?: WidgetSuggestedTopic[];
  mode?: "company" | "scoped";
  responseTime: number;
};

function normalizeBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, "");
}

function absolutizeUrl(apiBaseUrl: string, pathOrUrl: string): string {
  const raw = (pathOrUrl || "").trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = normalizeBaseUrl(apiBaseUrl);
  if (!base) return raw;
  return raw.startsWith("/") ? `${base}${raw}` : `${base}/${raw}`;
}

function withAbsoluteAttachmentUrls(
  apiBaseUrl: string,
  attachments: WidgetAttachment[] | undefined
): WidgetAttachment[] {
  return (attachments ?? []).map((a) => ({
    ...a,
    previewUrl: absolutizeUrl(apiBaseUrl, a.previewUrl),
    downloadUrl: absolutizeUrl(apiBaseUrl, a.downloadUrl),
  }));
}

export class WidgetApiClient {
  constructor(private readonly apiBaseUrl: string) {}

  private url(path: string): string {
    return `${normalizeBaseUrl(this.apiBaseUrl)}${path}`;
  }

  async getTopics(): Promise<WidgetTopics> {
    const response = await fetch(this.url("/api/widget/topics"));
    if (!response.ok) {
      throw new Error("Failed to load chat topics");
    }
    return response.json() as Promise<WidgetTopics>;
  }

  async askAssistant(input: {
    query: string;
    sessionId: string;
    forceDocumentType?: WidgetDocumentType;
  }): Promise<WidgetChatResponse> {
    const response = await fetch(this.url("/api/widget/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: input.query,
        sessionId: input.sessionId,
        ...(input.forceDocumentType
          ? { forceDocumentType: input.forceDocumentType }
          : {}),
      }),
    });

    if (!response.ok) {
      let detail = "";
      try {
        const body = (await response.json()) as { error?: string };
        if (body?.error) detail = `: ${body.error}`;
      } catch {
        // ignore non-JSON error bodies
      }
      throw new Error(`Failed to send message (${response.status})${detail}`);
    }

    const data = (await response.json()) as WidgetChatResponse;
    return {
      ...data,
      attachments: withAbsoluteAttachmentUrls(this.apiBaseUrl, data.attachments),
    };
  }
}
