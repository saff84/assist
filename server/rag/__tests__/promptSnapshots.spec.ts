import { describe, expect, it } from "vitest";

import { __testables } from "../../ragModule";

describe("prompt snapshots", () => {
  it("does not demand an article for a named product or product-group overview",()=>{
    expect(__testables.isTooGenericCatalogQuery("описание поршневого редуктора")).toBe(false);
    expect(__testables.isTooGenericCatalogQuery("характеристики аксиальных фитингов")).toBe(false);
    expect(__testables.isTooGenericCatalogQuery("характеристики РКУ")).toBe(false);
    expect(__testables.isTooGenericCatalogQuery("технические характеристики")).toBe(true);
  });
  it("accepts installation-labelled mounting passages from a technical passport",()=>{
    const context=`[Источник #1]\nДокумент: Паспорт труба ТЕПЛЫЙ ПОЛ_08.25.pdf\nТип: installation\nТовар: 11. МОНТАЖ\nФрагмент: Размотка трубы допустима при температуре не ниже -20 °С.`;
    const message=__testables.buildUserMessage(context,"монтаж трубы теплый пол");
    expect(message).toContain("Для монтажа используй instruction и installation");
    expect(message).not.toContain("используй ТОЛЬКО источники из «Пособия по монтажу»");
    expect(message).toContain("Размотка трубы допустима при температуре не ниже -20 °С");
  });
  it("builds instruction-focused user message", () => {
    const { buildUserMessage } = __testables;
    const context = `[Источник #1]
Документ: Пособие по монтажу SANEXT.pdf
Тип: instruction
Раздел: 1.1
Страницы: 5–6
Фрагмент:
«Перед началом монтажа выполните опрессовку системы SANEXT до давления 10 бар.»`;

    const message = buildUserMessage(context, "Как опрессовать систему?");

    expect(message).toMatchSnapshot();
  });

  it("builds catalog-focused user message", () => {
    const { buildUserMessage } = __testables;
    const context = `[Источник #1]
Документ: Каталог фитингов SANEXT.xlsx
Тип: catalog
Раздел: A.2
Страница: 12
Фрагмент:
«Фитинг SANEXT 16x2 имеет рабочее давление 10 бар и комплектуется кольцом EVOH.»`;

    const message = buildUserMessage(
      context,
      "Нужны характеристики фитинга SANEXT 16x2"
    );

    expect(message).toMatchSnapshot();
  });
});

