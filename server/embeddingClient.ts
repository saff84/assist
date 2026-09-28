/**
 * Shared Ollama embedding client used by upload indexing and RAG query.
 * Does NOT invent fake vectors on failure — callers must handle null.
 */

const DEFAULT_OLLAMA =
  process.env.OLLAMA_URL ||
  process.env.OLLAMA_BASE_URL ||
  "http://ollama:11434";

export type EmbeddingResult = {
  embedding: number[] | null;
  error?: string;
};

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (!norm) return vector;
  return vector.map((v) => v / norm);
}

export async function generateEmbeddingVector(
  text: string,
  options?: {
    model?: string;
    ollamaUrl?: string;
    maxChars?: number;
    retries?: number;
  }
): Promise<EmbeddingResult> {
  const model =
    options?.model ||
    process.env.EMBEDDING_MODEL ||
    process.env.OLLAMA_EMBEDDING_MODEL ||
    "bge-m3";
  const ollamaUrl = (options?.ollamaUrl || DEFAULT_OLLAMA).replace(/\/$/, "");
  const maxChars = options?.maxChars ?? 4000;
  const retries = options?.retries ?? 1;
  const input = (text || "").substring(0, maxChars);

  if (!input.trim()) {
    return { embedding: null, error: "empty_text" };
  }

  const request = async (endpoint: string, body: Record<string, unknown>) => {
    const response = await fetch(`${ollamaUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response;
  };

  let lastError = "unknown";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let response = await request("/api/embed", { model, input });
      if (response.status === 404) {
        response = await request("/api/embeddings", { model, prompt: input });
      }
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        return { embedding: null, error: lastError };
      }

      const payload: any = await response.json();
      let vector: number[] | null = null;
      if (Array.isArray(payload?.embedding)) {
        vector = payload.embedding as number[];
      } else if (
        Array.isArray(payload?.embeddings) &&
        Array.isArray(payload.embeddings[0])
      ) {
        vector = payload.embeddings[0] as number[];
      }

      if (!vector || !vector.length) {
        lastError = "unexpected_response";
        continue;
      }
      return { embedding: normalizeVector(vector) };
    } catch (error: any) {
      lastError = error?.message || String(error);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }

  return { embedding: null, error: lastError };
}
