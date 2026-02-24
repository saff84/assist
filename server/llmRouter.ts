import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { ENV } from "./_core/env";
import { getRagConfig } from "./rag/config";
import * as llmSettingsDb from "./llmSettingsDb";

async function getLocalLlmStatus(): Promise<{
  ollamaOk: boolean;
  ollamaUrl: string;
  ollamaError?: string;
  llmModel: string;
  llmReady: boolean;
  forgeConfigured: boolean;
}> {
  const ragConfig = getRagConfig();
  const ollamaUrlRaw =
    process.env.OLLAMA_URL ||
    process.env.OLLAMA_BASE_URL ||
    "http://ollama:11434";
  const ollamaUrl = ollamaUrlRaw.replace(/\/$/, "");
  const llmModel =
    process.env.LLM_MODEL_GENERATION ||
    process.env.OLLAMA_MODEL ||
    ragConfig.llm.model;
  const forgeConfigured = Boolean(
    ENV.forgeApiKey && ENV.forgeApiKey.trim().length > 0
  );
  const useOllama = Boolean(ENV.ollamaBaseUrl && ENV.ollamaBaseUrl.trim().length > 0);

  if (!useOllama) {
    return {
      ollamaOk: false,
      ollamaUrl: "",
      llmModel: llmModel || "Forge",
      llmReady: forgeConfigured,
      forgeConfigured,
    };
  }

  try {
    const response = await fetch(`${ollamaUrl}/api/tags`);
    if (!response.ok) {
      return {
        ollamaOk: false,
        ollamaUrl,
        ollamaError: `HTTP ${response.status}`,
        llmModel,
        llmReady: false,
        forgeConfigured,
      };
    }
    const data: any = await response.json();
    const presentNames = new Set<string>(
      Array.isArray(data?.models)
        ? data.models
            .map((m: any) => (typeof m?.name === "string" ? m.name : ""))
            .filter(Boolean)
        : []
    );
    const normalizeModelName = (name: string) => name.trim();
    const matchesModel = (expectedRaw: string, present: Set<string>) => {
      const expected = normalizeModelName(expectedRaw);
      if (!expected) return false;
      if (present.has(expected)) return true;
      if (expected.includes(":")) {
        const base = expected.split(":")[0] || expected;
        if (present.has(base)) return true;
      }
      for (const p of Array.from(present)) {
        if (p === expected || p.startsWith(`${expected}:`)) return true;
      }
      return false;
    };
    const llmReady = matchesModel(llmModel, presentNames);
    return {
      ollamaOk: true,
      ollamaUrl,
      llmModel,
      llmReady,
      forgeConfigured,
    };
  } catch (error: any) {
    return {
      ollamaOk: false,
      ollamaUrl,
      ollamaError: error?.message || String(error),
      llmModel,
      llmReady: false,
      forgeConfigured,
    };
  }
}

export const llmRouter = router({
  getLlmSettings: adminProcedure.query(async () => {
    return llmSettingsDb.getLlmSettingsForApi();
  }),

  updateLlmSettings: adminProcedure
    .input(
      z.object({
        provider: z.enum(["local", "external"]),
        externalApiUrl: z.string().optional(),
        externalApiKey: z.string().nullable().optional(),
        externalModel: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await llmSettingsDb.updateLlmSettings({
        provider: input.provider,
        externalApiUrl: input.externalApiUrl,
        externalApiKey: input.externalApiKey,
        externalModel: input.externalModel,
      });
      return { success: true };
    }),

  getLlmStatus: publicProcedure.query(async () => {
    const settings = await llmSettingsDb.getLlmSettingsForInvoke();
    if (settings.provider === "external") {
      return {
        provider: "external" as const,
        model: settings.externalModel,
        configured: Boolean(settings.externalApiKey),
      };
    }
    const local = await getLocalLlmStatus();
    return {
      provider: "local" as const,
      ollamaOk: local.ollamaOk,
      ollamaUrl: local.ollamaUrl,
      ollamaError: local.ollamaError,
      llmModel: local.llmModel,
      llmReady: local.llmReady,
      forgeConfigured: local.forgeConfigured,
    };
  }),
});
