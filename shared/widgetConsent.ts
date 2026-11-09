import { z } from "zod";

export const defaultConsentText = "Продолжая диалог я подтверждаю согласие [НАЗВАНИЕ КОМПАНИИ] ([АДРЕС КОМПАНИИ]) на обработку моих персональных данных предоставленных в процессе онлайн коммуникации, в целях обработки обращений и дальнейшей коммуникации, включая сбор, запись, систематизацию, хранение, использование, передачу контрагентам оператора для достижения указанных целей, поручение обработки [НАЗВАНИЕ И АДРЕС ОБРАБОТЧИКА 1] и [НАЗВАНИЕ И АДРЕС ОБРАБОТЧИКА 2], срок обработки 30 дней.";

export const widgetConsentSchema = z.object({
  enabled: z.boolean().default(false),
  text: z.string().trim().min(1, "Введите текст согласия").max(12000).default(defaultConsentText),
  policyUrl: z.string().trim().max(2000).refine(value => {
    if (!value) return true;
    try { return new URL(value).protocol === "https:"; } catch { return false; }
  }, "Укажите HTTPS-ссылку на политику обработки персональных данных").default(""),
});
export type WidgetConsentSettings = z.infer<typeof widgetConsentSchema>;
export const widgetConsentConfigSchema = widgetConsentSchema.extend({ version: z.string().regex(/^[a-f0-9]{64}$/) });
export type WidgetConsentConfig = z.infer<typeof widgetConsentConfigSchema>;
