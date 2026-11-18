import { defaultCompetitorBrands } from "../shared/queryRouting";

const replacement = /(?:^| )(?:аналог[а-я]*|замен[а-я]*|альтернатив[а-я]*|эквивалент[а-я]*|взаимозамен[а-я]*|так[а-я]* же)(?= |$)/u;
const externalManufacturer = /(?:^| )(?:конкурент[а-я]*|(?:друг[а-я]*|сторонн[а-я]*|чуж[а-я]*|ин(?:ой|ого|ому|ым|ом|ые|ых|ыми|ая|ую|ой)) (?:производител[а-я]*|бренд[а-я]*|марк[а-я]*))(?= |$)/u;
const sanextAsTarget = /(?:^| )(?:(?:из (?:каталога|ассортимента)|у) (?:sanext|санекст)|(?:sanext|санекст) (?:взамен|вместо|на замену))(?= |$)/u;
const externalFollowUp = /^(?:а )?(?:(?:есть|бывает) )?у (?:друг[а-я]* (?:производител[а-я]*|бренд[а-я]*)|конкурент[а-я]*)(?: есть)?$/u;

const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/ё/g, "е")
  .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();

export function asksForCompetitorAlternative(
  query: string,
  brands: readonly string[] = defaultCompetitorBrands
): boolean {
  const text = normalize(query);

  if (externalFollowUp.test(text)) return true;
  return replacement.test(text)
    && !sanextAsTarget.test(text)
    && (externalManufacturer.test(text) || brands.some(brand => {
      const name = normalize(brand);
      return name !== "" && ` ${text} `.includes(` ${name} `);
    }));
}

export const competitorAlternativeReply =
  "Подбор аналогов у других производителей не входит в возможности ассистента SANEXT. Могу рассказать о характеристиках вашего изделия или помочь подобрать вариант из каталога SANEXT. Для подбора укажите диаметр и условия применения.";
