export type WidgetDocumentType =
  | "catalog"
  | "instruction"
  | "general"
  | "certificate"
  | "passport"
  | "warranty_faq";

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
  hasCertificates: boolean;
  hasPassports: boolean;
  hasWarrantyFaq: boolean;
};

export type WidgetChatResponse = {
  response: string;
  attachments: WidgetAttachment[];
  responseTime: number;
};

function normalizeBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, "");
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
    forceDocumentType: WidgetDocumentType;
  }): Promise<WidgetChatResponse> {
    const response = await fetch(this.url("/api/widget/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: input.query,
        sessionId: input.sessionId,
        forceDocumentType: input.forceDocumentType,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to send message");
    }

    return response.json() as Promise<WidgetChatResponse>;
  }
}
