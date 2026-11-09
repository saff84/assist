import { z } from "zod";

export const widgetAppearanceSchema = z.object({
  brand: z.string().trim().max(60).default("SANEXT"),
  title: z.string().trim().min(1).max(100).default("SANEXT Assistant"),
  subtitle: z.string().trim().max(200).default("Продукция, монтаж и документы SANEXT"),
  logoUrl: z.string().trim().max(700000).refine(value => {
    if (!value) return true;
    if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)) return true;
    try { return new URL(value).protocol === "https:"; } catch { return false; }
  }, "Укажите HTTPS-ссылку или загрузите PNG, JPEG, WebP").default(""),
});
export type WidgetAppearance = z.infer<typeof widgetAppearanceSchema>;
export const defaultWidgetAppearance = widgetAppearanceSchema.parse({});
