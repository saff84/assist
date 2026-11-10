import { describe, expect, it } from "vitest";
import { defaultResponseModeration, responseModerationSchema } from "../shared/responseModeration";
import { inspectResponseText } from "./responseModerationMatcher";

describe("response moderation without a model", () => {
  it.each(["*изда", "#лядь", "идио*", "ху*", "*уй", "*uck"])("checks simple masking at the first/last letter: %s", text => {
    expect(inspectResponseText(text, defaultResponseModeration).blocked).toBe(true);
  });
  it.each(["Потребление *мА", "**Труба** 16 мм", "Расчёт x * y", "Давление 10*бар"])("does not treat short unit/formatting markers as insults: %s", text => {
    expect(inspectResponseText(text, defaultResponseModeration).blocked).toBe(false);
  });
  it.each(["п\u0301изда", "п&#1080;зда", "ху&shy;й", "**пи**зда", "п*и*зда"])("checks text after simple rendered obfuscation: %s", text => {
    expect(inspectResponseText(text, defaultResponseModeration).blocked).toBe(true);
  });
  it.each(["дерьмом", "говном", "жопой", "чмом", "срёте", "насру", "обосрал", "ссут"])("blocks additional vulgar word forms: %s", text => {
    expect(inspectResponseText(text, defaultResponseModeration).blocked).toBe(true);
  });
  it.each(["Ты идиот", "Не спорьте с идиотами", "Он дебилом оказался", "Дебильными ответами", "Ты дурак", "Дураками", "СУКЕ", "мразью", "ублюдками", "мудаков", "ебёт", "ёбаный", "заебали", "долбоёбами", "Пошли на хуй", "ИДИТЕ НА ХУЙ", "Заткнитесь", "п1зда", "бл***дь", "х*й", "х у й", "п-и-з-д-а", "пи.зда", "xуй", "fuck", "FUCKING", "bitches", "п\u200bизда"])("blocks word forms/masking: %s", text => {
    expect(inspectResponseText(text, defaultResponseModeration).blocked).toBe(true);
  });
  it.each(["Подстрахуй монтажника и страхуй груз.", "Сукно и суконный материал", "Хулиган и хулиганство", "Дебиторская задолженность и дебит", "Насос класса А, артикул 5905, резьба 3/4", "Перестрахуйте соединение, затем проверьте давление", "Эбонит, ебеновое дерево, assembly, class, assessment", "Трубы из полипропилена SANEXT для горячего водоснабжения", "***", "Показатели: х = 3, у = 4"])("does not block technical/ordinary text: %s", text => {
    expect(inspectResponseText(text, defaultResponseModeration).blocked).toBe(false);
  });
  it("supports new ordinary words and their noun/adjective forms", () => {
    const settings = responseModerationSchema.parse({ terms: "хам\nгрубый" });
    expect(inspectResponseText("Разговор с хамами", settings).blocked).toBe(true);
    expect(inspectResponseText("Грубого собеседника", settings).blocked).toBe(true);
    expect(inspectResponseText("Хамелеон", settings).blocked).toBe(false);
  });
  it("supports custom phrases and inflections without crossing word boundaries", () => {
    const settings = responseModerationSchema.parse({ terms: "грубый идиот" });
    expect(inspectResponseText("Разговор с грубыми идиотами", settings).blocked).toBe(true);
    expect(inspectResponseText("Грубая поверхность, затем идиотический пример", settings).blocked).toBe(false);
  });
  it("exceptions only exempt the matching word/phrase, not the entire answer", () => {
    const settings = responseModerationSchema.parse({ terms: "идиот", exceptions: "пример идиота" });
    expect(inspectResponseText("Это пример идиота", settings).blocked).toBe(false);
    expect(inspectResponseText("Это пример идиота. Ты идиот!", settings).blocked).toBe(true);
  });
  it("exact exceptions can prevent false positives from a custom broad stem", () => {
    const settings = responseModerationSchema.parse({ terms: "хам*", exceptions: "хамелеон" });
    expect(inspectResponseText("Хамелеон", settings).blocked).toBe(false);
    expect(inspectResponseText("Хамелеон и хамство", settings).blocked).toBe(true);
  });
  it("off switch bypasses checks and an oversized enabled response is blocked", () => {
    expect(inspectResponseText("идиот", { ...defaultResponseModeration, enabled: false }).blocked).toBe(false);
    expect(inspectResponseText("а".repeat(200001), defaultResponseModeration)).toMatchObject({ blocked: true, reason: "too_long" });
  });
  it.each(["(а+)+$", "*еб*", "а*", "[а-я]", "foo|bar", "a".repeat(61)])("rejects unsafe/overbroad pattern: %s", terms => {
    expect(responseModerationSchema.safeParse({ terms }).success).toBe(false);
  });
  it("rejects too many rules, wildcard exceptions and an empty active dictionary", () => {
    expect(responseModerationSchema.safeParse({ terms: Array.from({ length: 201 }, (_, i) => `слово${i}`).join("\n") }).success).toBe(false);
    expect(responseModerationSchema.safeParse({ exceptions: "хам*" }).success).toBe(false);
    expect(responseModerationSchema.safeParse({ terms: "" }).success).toBe(false);
    expect(responseModerationSchema.safeParse({ terms: "", enabled: false }).success).toBe(true);
  });
});
