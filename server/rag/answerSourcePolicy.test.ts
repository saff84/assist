import { expect,it } from "vitest";
import { answerSourcePolicy, composeAnswerSystemPrompt, normalizeLegacySourceRestrictions } from "./answerSourcePolicy";
it("permits mounting answers from installation passports even when saved prompts still prohibit them",()=>{
  const legacy='Для вопросов о монтаже, установке используй ТОЛЬКО источники из «Пособия по монтажу» (документ типа "instruction").';
  const prompt=composeAnswerSystemPrompt(legacy,legacy+"\nСохраняй точные температуры.");
  expect(prompt).not.toContain("используй ТОЛЬКО источники из «Пособия");
  expect(prompt).toContain("Монтажные разделы паспорта с типом installation являются полноценным источником");
  expect(prompt).toContain("Сохраняй точные температуры.");
  expect(prompt.endsWith(answerSourcePolicy)).toBe(true);
});
it("keeps the source policy when no custom prompt is configured",()=>{
  expect(composeAnswerSystemPrompt("Базовый промпт","")).toContain(answerSourcePolicy);
});
it("preserves unrelated administrator instructions and does not mutate stored settings",()=>{
  const custom="Отвечай по-русски.\nПриводи точные значения и источник.";
  expect(normalizeLegacySourceRestrictions(custom)).toBe(custom);
  expect(composeAnswerSystemPrompt("Основной",custom)).toContain(custom);
});
