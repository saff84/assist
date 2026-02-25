import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { llmSettings } from "../drizzle/schema";

export type LlmProvider = "local" | "external";

export interface LlmSettingsRow {
  id: number;
  provider: LlmProvider;
  externalApiUrl: string | null;
  externalApiKey: string | null;
  externalModel: string | null;
  useQuickResponses: boolean | null;
}

export interface LlmSettingsForApi {
  provider: LlmProvider;
  externalApiUrl: string;
  externalApiKeyMasked: string | null;
  externalModel: string;
  useQuickResponses: boolean;
}

const MASK = "••••••••";

function maskApiKey(key: string | null): string | null {
  if (!key || key.length < 8) return key ? MASK : null;
  return key.slice(0, 6) + MASK + key.slice(-4);
}

export async function getLlmSettings(): Promise<LlmSettingsRow | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(llmSettings).limit(1);
  return (rows[0] as LlmSettingsRow) ?? null;
}

/** Returns full settings for server-side LLM invocation (includes real API key). */
export async function getLlmSettingsForInvoke(): Promise<{
  provider: LlmProvider;
  externalApiUrl: string;
  externalApiKey: string | null;
  externalModel: string;
  useQuickResponses: boolean;
}> {
  const row = await getLlmSettings();
  if (!row || row.provider !== "external") {
    return {
      provider: "local",
      externalApiUrl: "https://openrouter.ai/api/v1",
      externalApiKey: null,
      externalModel: "anthropic/claude-sonnet-4",
      useQuickResponses: row?.useQuickResponses ?? true,
    };
  }
  return {
    provider: "external",
    externalApiUrl: row.externalApiUrl?.trim() || "https://openrouter.ai/api/v1",
    externalApiKey: row.externalApiKey?.trim() || null,
    externalModel: row.externalModel?.trim() || "anthropic/claude-sonnet-4",
    useQuickResponses: row.useQuickResponses ?? true,
  };
}

export async function getLlmSettingsForApi(): Promise<LlmSettingsForApi> {
  const row = await getLlmSettings();
  if (!row) {
    return {
      provider: "local",
      externalApiUrl: "https://openrouter.ai/api/v1",
      externalApiKeyMasked: null,
      externalModel: "anthropic/claude-sonnet-4",
      useQuickResponses: true,
    };
  }
  return {
    provider: row.provider as LlmProvider,
    externalApiUrl: row.externalApiUrl?.trim() || "https://openrouter.ai/api/v1",
    externalApiKeyMasked: row.externalApiKey ? maskApiKey(row.externalApiKey) : null,
    externalModel: row.externalModel?.trim() || "anthropic/claude-sonnet-4",
    useQuickResponses: row.useQuickResponses ?? true,
  };
}

export async function updateLlmSettings(
  data: {
    provider?: LlmProvider;
    externalApiUrl?: string;
    externalApiKey?: string | null;
    externalModel?: string;
    useQuickResponses?: boolean;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await getLlmSettings();
  if (!existing) {
    await db.insert(llmSettings).values({
      provider: data.provider ?? "local",
      externalApiUrl: data.externalApiUrl ?? "https://openrouter.ai/api/v1",
      externalApiKey: data.externalApiKey ?? null,
      externalModel: data.externalModel ?? "anthropic/claude-sonnet-4",
      useQuickResponses: data.useQuickResponses ?? true,
    });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (data.provider !== undefined) updates.provider = data.provider;
  if (data.externalApiUrl !== undefined) updates.externalApiUrl = data.externalApiUrl;
  if (data.externalApiKey !== undefined) updates.externalApiKey = data.externalApiKey ?? null;
  if (data.externalModel !== undefined) updates.externalModel = data.externalModel;
  if (data.useQuickResponses !== undefined) updates.useQuickResponses = data.useQuickResponses;

  if (Object.keys(updates).length === 0) return;
  await db.update(llmSettings).set(updates).where(eq(llmSettings.id, existing.id));
}
