import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { getRagConfig } from "../rag/config";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  getModelStatus: publicProcedure.input(z.void().nullish()).query(async () => {
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
    const embeddingModel =
      process.env.EMBEDDING_MODEL ||
      process.env.OLLAMA_EMBEDDING_MODEL ||
      ragConfig.retrieval.embeddingModel;

    const rerankerEnabled =
      Boolean(ragConfig.retrieval?.reranker?.enabled) &&
      typeof process.env.RERANKER_URL === "string" &&
      process.env.RERANKER_URL.trim().length > 0;
    const rerankerModel = ragConfig.retrieval?.reranker?.model || null;

    const normalizeModelName = (name: string) => name.trim();

    const matchesModel = (expectedRaw: string, present: Set<string>) => {
      const expected = normalizeModelName(expectedRaw);
      if (!expected) return false;

      if (present.has(expected)) return true;

      const expectedHasTag = expected.includes(":");
      if (!expectedHasTag) {
        // If config uses base name (e.g. "bge-m3"), accept any tag and default :latest
        if (present.has(`${expected}:latest`)) return true;
        // Avoid iterating Set directly (ts target may be < es2015)
        for (const p of Array.from(present)) {
          if (p === expected || p.startsWith(`${expected}:`)) return true;
        }
        return false;
      }

      // If config specifies a tag (e.g. "bge-m3:latest"), accept base name too
      const base = expected.split(":")[0] || expected;
      if (present.has(base)) return true;

      return false;
    };

    try {
      const response = await fetch(`${ollamaUrl}/api/tags`);
      if (!response.ok) {
        const llmReady = false;
        const embeddingReady = false;
        return {
          ollama: {
            ok: false,
            url: ollamaUrl,
            error: `HTTP ${response.status}`,
          },
          llm: { model: llmModel, ready: llmReady },
          embeddings: { model: embeddingModel, ready: embeddingReady },
          required: {
            llmModel,
            embeddingModel,
            rerankerEnabled,
            rerankerModel,
          },
          allReady: llmReady && embeddingReady,
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

      const llmReady = matchesModel(llmModel, presentNames);
      const embeddingReady = matchesModel(embeddingModel, presentNames);

      return {
        ollama: { ok: true, url: ollamaUrl },
        llm: { model: llmModel, ready: llmReady },
        embeddings: { model: embeddingModel, ready: embeddingReady },
        required: {
          llmModel,
          embeddingModel,
          rerankerEnabled,
          rerankerModel,
        },
        allReady: llmReady && embeddingReady,
      };
    } catch (error: any) {
      const llmReady = false;
      const embeddingReady = false;
      return {
        ollama: {
          ok: false,
          url: ollamaUrl,
          error: error?.message || String(error),
        },
        llm: { model: llmModel, ready: llmReady },
        embeddings: { model: embeddingModel, ready: embeddingReady },
        required: {
          llmModel,
          embeddingModel,
          rerankerEnabled,
          rerankerModel,
        },
        allReady: llmReady && embeddingReady,
      };
    }
  }),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
