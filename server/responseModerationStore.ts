import fs from "fs/promises";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { defaultResponseModeration, responseModerationSchema, type ResponseModerationSettings } from "../shared/responseModeration";
import { inspectResponseText } from "./responseModerationMatcher";

export type ModerationEvent = { id: string; at: string; channel: "website" | "bitrix24" | "test";
  reason: "term" | "too_long" | "settings_error"; rules: string[]; responseHash: string };
export function validateModerationSettings(input: unknown) {
  const settings = responseModerationSchema.parse(input);
  if (inspectResponseText(settings.fallback, { ...settings, enabled: true }).blocked) {
    throw new Error("Запасной ответ содержит запрещённое выражение. Измените его или правила фильтра.");
  }
  return settings;
}

export function createResponseModerationStore(directory: string) {
  const settingsPath = path.join(directory, "response-moderation.json");
  const eventsPath = path.join(directory, "response-moderation-events.json");
  let cached: { signature: string; settings: ResponseModerationSettings } | undefined;
  let eventsQueue: Promise<unknown> = Promise.resolve();
  async function atomic(file: string, value: unknown) {
    await fs.mkdir(directory, { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
      for (let attempt = 0; ; attempt++) {
        try { await fs.rename(temporary, file); break; }
        catch (error) {
          // Windows antivirus/indexers can briefly hold a just-read destination.
          // Keep atomic replacement: never delete the previous settings/journal.
          if (process.platform !== "win32" || attempt >= 4 || !["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
          await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
        }
      }
    } finally { await fs.rm(temporary, { force: true }); }
  }
  async function read(): Promise<ResponseModerationSettings> {
    try {
      const info = await fs.stat(settingsPath);
      if (info.size > 256000) throw new Error("Oversized settings");
      const signature = `${info.ino}:${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
      if (cached?.signature === signature) return cached.settings;
      const settings = validateModerationSettings(JSON.parse(await fs.readFile(settingsPath, "utf8")));
      cached = { signature, settings };
      return settings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultResponseModeration;
      throw new Error("Не удалось прочитать настройки модерации. Восстановите их в разделе «Модерация ответов».");
    }
  }
  async function save(input: unknown) {
    const settings = validateModerationSettings(input);
    await atomic(settingsPath, settings);
    cached = undefined;
    return settings;
  }
  async function events(): Promise<ModerationEvent[]> {
    try {
      const info = await fs.stat(eventsPath);
      if (info.size > 4 * 1024 * 1024) throw new Error("Oversized journal");
      const entries = JSON.parse(await fs.readFile(eventsPath, "utf8")) as ModerationEvent[];
      if (!Array.isArray(entries) || !entries.every(entry => typeof entry?.id === "string" && typeof entry.at === "string"
        && Number.isFinite(Date.parse(entry.at)) && ["website", "bitrix24", "test"].includes(entry.channel)
        && ["term", "too_long", "settings_error"].includes(entry.reason) && Array.isArray(entry.rules)
        && entry.rules.length <= 8 && entry.rules.every(term => typeof term === "string" && term.length <= 365)
        && typeof entry.responseHash === "string" && /^[a-f0-9]{64}$/.test(entry.responseHash))) throw new Error("Invalid journal");
      const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
      return entries.filter(entry => typeof entry?.at === "string" && Date.parse(entry.at) >= since).slice(-100);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("Не удалось прочитать журнал модерации");
    }
  }
  function record(channel: ModerationEvent["channel"], reason: ModerationEvent["reason"], rules: string[], response: string) {
    const entry: ModerationEvent = { id: randomUUID(), at: new Date().toISOString(), channel, reason,
      rules: rules.slice(0, 8), responseHash: createHash("sha256").update(response).digest("hex") };
    const operation = eventsQueue.then(async () => {
      const previous = await events();
      await atomic(eventsPath, [...previous, entry].slice(-100));
    });
    eventsQueue = operation.catch(() => undefined);
    return operation;
  }
  return { read, save, events, record };
}
export const responseModerationStore = createResponseModerationStore(path.resolve("uploads", "settings"));
