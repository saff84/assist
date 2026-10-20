import { z } from "zod";

export const routeLabels = {
  installation: "Монтаж и совместимость (MD паспортов + инструкции)",
  instruction: "Инструкции",
  certificate: "Сертификаты",
  passport: "Паспорта (поиск PDF для скачивания)",
  catalog: "Товары / каталоги",
  warranty_faq: "Гарантия / FAQ",
  company: "О компании",
} as const;
export const routeTargetSchema = z.enum(["installation", "instruction", "certificate", "passport", "catalog", "warranty_faq", "company"]);
export const routingRuleSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  target: routeTargetSchema,
  terms: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
});
export const queryRoutingSchema = z.object({
  enabled: z.boolean(),
  rules: z.array(routingRuleSchema).max(50),
}).refine(value => new Set(value.rules.map(rule => rule.id)).size === value.rules.length,
  {message: "Идентификаторы правил должны быть уникальными"});
export type QueryRoutingConfig = z.infer<typeof queryRoutingSchema>;
export type RouteTarget = z.infer<typeof routeTargetSchema>;
export const defaultQueryRouting: QueryRoutingConfig = {
  enabled: true,
  rules: [
    {id:"installation", name:"Вопросы о монтаже", enabled:true, target:"installation", terms:["монтаж*", "установк*", "подключени*"]},
    {id:"certificates", name:"Поиск сертификатов", enabled:true, target:"certificate", terms:["сертификат*", "сертификаци*"]},
    {id:"passports", name:"Поиск паспортов", enabled:true, target:"passport", terms:["паспорт*", "техпаспорт*"]},
  ],
};
const tokens = (value: string) => value.normalize("NFKC").toLowerCase().replace(/ё/g,"е").match(/[а-яa-z0-9]+/g) ?? [];
export function matchRouteTerm(query: string, term: string): boolean {
  const words = tokens(query), parts = tokens(term);
  if (!parts.length) return false;
  const prefix = term.trim().endsWith("*");
  return words.some((_, start) => parts.every((part, offset) => {
    const word = words[start + offset];
    return word !== undefined && (prefix && offset === parts.length - 1 ? word.startsWith(part) : word === part);
  }));
}
export function resolveQueryRoute(query: string, config: QueryRoutingConfig) {
  if (!config.enabled) return null;
  for (const rule of config.rules) {
    if (!rule.enabled) continue;
    const term = rule.terms.find(term => matchRouteTerm(query, term));
    if (term) return {ruleId:rule.id, ruleName:rule.name, target:rule.target, term};
  }
  return null;
}
export function routeDocumentTypes(target: RouteTarget): RouteTarget[] {
  return target === "installation" ? ["installation", "instruction"] : [target];
}
