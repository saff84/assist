import fs from "fs";
import path from "path";

let cachedPrompt: string | null = null;

const PROMPT_PATH =
  process.env.RAG_SYSTEM_PROMPT_PATH ??
  path.resolve(process.cwd(), "prompts", "system.sanext.txt");

export function getSystemPromptTemplate(): string {
  if (cachedPrompt) {
    return cachedPrompt;
  }

  try {
    const content = fs.readFileSync(PROMPT_PATH, "utf-8");
    cachedPrompt = content.trim();
    return cachedPrompt;
  } catch (error) {
    console.warn(
      `[RAG:prompt] Failed to load system prompt template from ${PROMPT_PATH}:`,
      error
    );
    const fallback =
      "Ты — AI-ассистент SANEXT. Отвечай только по предоставленным фрагментам. Если сведений нет — скажи, что в документах нет информации. Ответ будь краток и структурирован. Указывай источник.";
    cachedPrompt = fallback;
    return cachedPrompt;
  }
}

export function reloadSystemPromptTemplate() {
  cachedPrompt = null;
}

