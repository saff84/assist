import fs from "fs/promises";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { widgetConsentSchema, type WidgetConsentSettings } from "../shared/widgetConsent";

export const widgetConsentPath = path.resolve("uploads", "settings", "widget-consent.json");
export function consentConfig(settings: WidgetConsentSettings) {
  const value = widgetConsentSchema.parse(settings);
  const version = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return { ...value, version };
}
export async function readWidgetConsent() {
  try { return consentConfig(JSON.parse(await fs.readFile(widgetConsentPath, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return consentConfig(widgetConsentSchema.parse({}));
    throw new Error("Не удалось прочитать настройки согласия");
  }
}
export async function saveWidgetConsent(settings: WidgetConsentSettings) {
  const value = widgetConsentSchema.parse(settings);
  await fs.mkdir(path.dirname(widgetConsentPath), { recursive: true });
  const temporary = `${widgetConsentPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(temporary, widgetConsentPath);
  } finally { await fs.rm(temporary, { force: true }); }
  return consentConfig(value);
}
