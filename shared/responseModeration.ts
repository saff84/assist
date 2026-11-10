import { z } from "zod";

export const defaultModerationFallback = "Не удалось подготовить корректный ответ. Пожалуйста, уточните вопрос о продукции.";
export const defaultModerationTerms = [
  "хуй*", "хуе*", "хуя*", "хуи*", "нахуй", "похуй", "охуе*", "охуен*",
  "пизд*", "ебать", "ебан*", "ебну*", "ебуч*", "еблан*", "ебт*", "заеб*", "выеб*", "наеб*", "отъеб*", "съеб*", "уеб*", "въеб*", "разъеб*", "объеб*", "подъеб*", "перееб*", "проеб*", "доеб*", "поеб*",
  "бля", "блядь", "бляд*", "блят*", "долбоеб*", "мудак", "мудил*", "мразь", "ублюдок", "сука",
  "говн*", "жоп*", "дерьмо", "срать", "насрать", "обосрать", "ссать", "чмо",
  "дурак", "дура", "дурацкий", "идиот", "идиотка", "идиотский", "дебил", "дебилка", "дебильный", "тупица",
  "заткнись", "заткни рот", "пошел на хуй", "иди на хуй", "пошел нахуй",
  "fuck*", "bitch", "bullshit",
].join("\n");
export const defaultModerationExceptions = ["сукно", "суконный", "страхуй", "подстрахуй", "хулиган", "хулиганство", "дебитор"].join("\n");

export const moderationLines = (text: string) => [...new Set(text.split(/\r?\n/).map(line => line.trim().replace(/\s+/g, " ")).filter(Boolean))];
function validList(text: string, allowStems: boolean) {
  const lines = moderationLines(text);
  return lines.length <= 200 && lines.every(line => {
    const words = line.split(/\s+/);
    return words.length <= 6 && words.every(word => {
      const literal = allowStems && word.endsWith("*") ? word.slice(0, -1) : word;
      return literal.length >= (words.length === 1 ? 2 : 1) && literal.length <= 60 && /^[\p{L}\p{N}]+$/u.test(literal)
        && (!word.endsWith("*") || (allowStems && literal.length >= 2));
    });
  });
}

export const responseModerationSchema = z.object({
  enabled: z.boolean().default(true),
  terms: z.string().max(20000).default(defaultModerationTerms).refine(value => validList(value, true),
    "До 200 строк: слова или фразы до 6 слов. Для основы используйте * только в конце слова; регулярные выражения не допускаются."),
  exceptions: z.string().max(20000).default(defaultModerationExceptions).refine(value => validList(value, false),
    "Исключения: до 200 точных слов или фраз, без * и регулярных выражений."),
  fallback: z.string().trim().min(1).max(1000).default(defaultModerationFallback),
}).refine(value => !value.enabled || moderationLines(value.terms).length > 0, "Для включённого фильтра добавьте хотя бы одно правило");
export type ResponseModerationSettings = z.infer<typeof responseModerationSchema>;
export const defaultResponseModeration = responseModerationSchema.parse({});
