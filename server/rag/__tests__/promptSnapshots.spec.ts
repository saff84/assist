import { describe, expect, it } from "vitest";

import { __testables } from "../../ragModule";

describe("prompt snapshots", () => {
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

