import { describe, expect, it } from "vitest";
import { createStopwordSet, tokenize } from "../textProcessing";

const stopwords = createStopwordSet();

describe("tokenize Russian stemming for catalog queries", () => {
  it("maps genitive 'теплого пола' to same stems as 'теплый пол'", () => {
    const nominative = new Set(tokenize("труба Теплый пол", stopwords));
    const genitive = new Set(tokenize("труба для теплого пола", stopwords));

    expect(nominative.has("тепл")).toBe(true);
    expect(nominative.has("пол")).toBe(true);
    expect(genitive.has("тепл")).toBe(true);
    expect(genitive.has("пол")).toBe(true);
    expect(genitive.has("для")).toBe(false);
  });

  it("stems common product phrase variants to overlapping tokens", () => {
    const a = new Set(tokenize("универсальная труба", stopwords));
    const b = new Set(tokenize("универсальной трубы", stopwords));
    expect([...a].filter((t) => b.has(t)).length).toBeGreaterThanOrEqual(2);
  });
});
