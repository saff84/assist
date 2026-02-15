const RUSSIAN_SUFFIXES = [
  "иями",
  "ями",
  "ами",
  "ией",
  "ией",
  "ием",
  "иям",
  "иях",
  "ии",
  "ий",
  "ия",
  "ие",
  "ей",
  "ой",
  "ий",
  "ый",
  "ой",
  "ем",
  "им",
  "ом",
  "ей",
  "ей",
  "ью",
  "ью",
  "ия",
  "ья",
  "ья",
  "ия",
  "ее",
  "ие",
  "ые",
  "ое",
  "ей",
  "ий",
  "ый",
  "ой",
  "ей",
  "ой",
  "ий",
  "ый",
  "ее",
  "ие",
  "ые",
  "ов",
  "ев",
  "ёв",
  "их",
  "ых",
  "ую",
  "юю",
  "ая",
  "яя",
  "яя",
  "ей",
  "ой",
  "ей",
  "ой",
  "ей",
  "ой",
  "ях",
  "ах",
  "ов",
  "ев",
];

const stemToken = (token: string): string => {
  for (const suffix of RUSSIAN_SUFFIXES) {
    if (
      token.length - suffix.length >= 3 &&
      token.endsWith(suffix)
    ) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
};

const BASE_STOPWORDS = [
  "и",
  "но",
  "а",
  "же",
  "или",
  "что",
  "это",
  "тот",
  "такой",
  "как",
  "который",
  "быть",
  "есть",
  "по",
  "на",
  "для",
  "без",
  "со",
  "при",
  "под",
  "над",
  "между",
  "из",
  "из-за",
  "у",
  "от",
  "к",
  "с",
  "в",
  "во",
  "не",
  "нет",
  "да",
  "ли",
  "же",
  "то",
  "же",
  "же",
  "чтобы",
  "если",
  "когда",
  "где",
  "куда",
  "откуда",
  "почему",
  "зачем",
  "какой",
  "какая",
  "какие",
  "которые",
  "так",
  "же",
  "уже",
  "ещё",
  "также",
  "ему",
  "ей",
  "их",
  "кто",
  "кого",
  "кому",
  "кем",
  "чем",
  "этот",
  "эта",
  "эти",
  "вам",
  "нас",
  "уже",
  "лишь",
  "только",
  "всего",
  "очень",
  "можно",
  "должен",
  "нужно",
  "нужен",
  "нужна",
  "нужны",
  "будет",
  "будут",
  "будем",
  "буду",
  "был",
  "была",
  "были",
  "быть",
  "будучи",
  "есть",
  "является",
  "являться",
  "являясь",
  "меня",
  "тебя",
  "твоё",
  "ваш",
  "наш",
  "ваша",
  "наша",
  "ваши",
  "наши",
  "его",
  "её",
  "их",
  "сам",
  "сама",
  "сами",
  "само",
  "собой",
];

export function createStopwordSet(extra: string[] = []): Set<string> {
  return new Set(
    [...BASE_STOPWORDS, ...extra]
      .map((word) => word.toLowerCase())
      .map((word) => word.replace(/ё/g, "е"))
  );
}

export function normalizeToken(token: string): string {
  return token.normalize("NFKD").toLowerCase().replace(/ё/g, "е");
}

export function tokenize(text: string, stopwords: Set<string>): string[] {
  if (!text) {
    return [];
  }

  const normalized = text.toLowerCase().replace(/ё/g, "е");

  const matches =
    normalized.match(/\p{L}[\p{L}0-9/+-]*/gu) ??
    normalized.match(/[a-z0-9/+-]+/gi) ??
    [];

  const tokens: string[] = [];

  for (const raw of matches) {
    const token = raw.trim();
    if (token.length < 2) continue;
    if (stopwords.has(token)) continue;

    const hasLetters = /\p{L}/u.test(token);
    if (!hasLetters) {
      tokens.push(token);
      continue;
    }

    tokens.push(stemToken(token));
  }

  return tokens;
}

export function buildTermFrequency(
  text: string,
  stopwords: Set<string>
): Map<string, number> {
  const terms = tokenize(text, stopwords);
  const tf = new Map<string, number>();
  terms.forEach((term) => {
    tf.set(term, (tf.get(term) ?? 0) + 1);
  });
  return tf;
}

export function extractSkuCandidates(text: string): string[] {
  if (!text) return [];
  const matches =
    text.match(/\b[а-яa-z0-9]{2,}[-–\/]?[а-яa-z0-9]{2,}\b/gi) ?? [];
  return matches.map((token) => token.replace(/[-–]/g, "").toUpperCase());
}

const INSTALLATION_KEYWORDS = [
  "монтаж",
  "монтажный",
  "смонтировать",
  "установка",
  "подключение",
  "подключать",
  "подсоединение",
  "укладка",
  "опрессовка",
  "промывка",
  "наладка",
  "регулировка",
  "коллекторная",
  "коллектор",
  "монолит",
  "насосная",
  "пусконаладка",
  "обвязка",
  "крепление",
  "изоляция",
];

const CATALOG_KEYWORDS = [
  "артикул",
  "sku",
  "каталог",
  "цена",
  "прайс",
  "стоймость",
  "стоимость",
  "диаметр",
  "фитинг",
  "труба",
  "pex",
  "pe-xa",
  "evoh",
  "серия",
  "модель",
  "комплектация",
  "характеристик",
  "характеристика",
  "описание",
  "параметр",
  "размер",
  "материал",
  "применение",
  "преимуществ",
  "преимущество",
  "свойств",
  "свойство",
];

export function hasInstallationIntent(query: string): boolean {
  const normalized = normalizeToken(query);
  return INSTALLATION_KEYWORDS.some((keyword) =>
    normalized.includes(keyword)
  );
}

export function hasCatalogIntent(query: string): boolean {
  const normalized = normalizeToken(query);
  if (CATALOG_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return true;
  }

  const skuMatches = extractSkuCandidates(normalized);
  return skuMatches.length > 0;
}

export function truncateContent(content: string, limit: number): string {
  if (!content || content.length <= limit) {
    return content;
  }
  return `${content.slice(0, limit)}…`;
}


