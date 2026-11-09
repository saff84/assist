import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { widgetAppearanceSchema, defaultWidgetAppearance, type WidgetAppearance } from "../shared/widgetAppearance";

export const widgetAppearancePath = path.resolve("uploads", "settings", "widget-appearance.json");
export async function readWidgetAppearance(): Promise<WidgetAppearance> {
  try { return widgetAppearanceSchema.parse(JSON.parse(await fs.readFile(widgetAppearancePath, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaultWidgetAppearance };
    throw new Error("Не удалось прочитать оформление виджета");
  }
}
export async function saveWidgetAppearance(settings: WidgetAppearance) {
  const value = widgetAppearanceSchema.parse(settings);
  await fs.mkdir(path.dirname(widgetAppearancePath), { recursive: true });
  const temporary = `${widgetAppearancePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(temporary, widgetAppearancePath);
  } finally { await fs.rm(temporary, { force: true }); }
  return value;
}
