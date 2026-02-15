import type { RetrievalConfig, ScoredChunk } from "./types";

export interface RerankResult {
  chunks: ScoredChunk[];
  applied: boolean;
  model?: string;
}

export async function rerankChunks(
  query: string,
  candidates: ScoredChunk[],
  config: RetrievalConfig
): Promise<RerankResult> {
  const rerankerUrl = process.env.RERANKER_URL;

  if (
    !config.reranker.enabled ||
    !rerankerUrl ||
    !candidates.length ||
    !config.reranker.model
  ) {
    return {
      chunks: candidates,
      applied: false,
      model: config.reranker.model,
    };
  }

  try {
    const payload = {
      model: config.reranker.model,
      query,
      documents: candidates.map((chunk) => ({
        id: chunk.id,
        text: chunk.content.slice(0, 2048),
      })),
    };

    const response = await fetch(rerankerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Reranker request failed: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    const scores = new Map<number, number>();

    if (Array.isArray(data.results)) {
      data.results.forEach((item: any) => {
        if (typeof item?.id === "number" && typeof item?.score === "number") {
          scores.set(item.id, item.score);
        }
      });
    } else if (Array.isArray(data.scores)) {
      data.scores.forEach((score: number, index: number) => {
        const candidate = candidates[index];
        if (candidate) {
          scores.set(candidate.id, Number(score));
        }
      });
    } else {
      throw new Error("Unsupported reranker response format");
    }

    const sorted = [...candidates].sort((a, b) => {
      const scoreB = scores.get(b.id) ?? b.relevance;
      const scoreA = scores.get(a.id) ?? a.relevance;
      return scoreB - scoreA;
    });

    return {
      chunks: sorted,
      applied: true,
      model: config.reranker.model,
    };
  } catch (error) {
    console.warn("[RAG] Reranker unavailable, falling back:", error);
    return {
      chunks: candidates,
      applied: false,
      model: config.reranker.model,
    };
  }
}

