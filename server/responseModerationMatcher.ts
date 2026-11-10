import { moderationLines, type ResponseModerationSettings } from "../shared/responseModeration";

// Only fixed literal patterns are compiled. Admin input cannot create arbitrary regexes.
const lookalikes: Record<string, string> = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у", "0": "о", "1": "и", "3": "з", "4": "ч", "6": "б", "9": "я" };
export function normalizeModerationText(text: string) {
  const decoded = text.replace(/&#(x[0-9a-f]{1,6}|[0-9]{1,7});/gi, (entity, value: string) => {
    const code = value[0].toLowerCase() === "x" ? parseInt(value.slice(1), 16) : parseInt(value, 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  }).replace(/&(nbsp|shy|zwj|zwnj|zerowidthspace);/gi, (_, name: string) => name.toLowerCase() === "nbsp" ? " " : "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/__([^_\n]+)__/g, "$1").replace(/\*([^*\n]+)\*/g, "$1");
  return decoded.normalize("NFKC").toLowerCase().replace(/ё/g, "е").replace(/[\p{Cf}\p{M}]/gu, "")
    .replace(/[abcehkmoptxy013469]/g, letter => lookalikes[letter]).replace(/[*#?]{2,}/g, "*");
}
const irregular: Record<string, string[]> = {
  "ебать": ["ебать", "ебаться", "ебу", "ебешь", "ебет", "ебем", "ебете", "ебут", "ебал", "ебала", "ебало", "ебали", "ебался", "ебалась", "ебались", "еби", "ебите", "ебусь", "ебешься", "ебется", "ебемся", "ебетесь", "ебутся", "ебись", "ебитесь"],
  "ублюдок": ["ублюдок", "ублюдка", "ублюдку", "ублюдком", "ублюдке", "ублюдки", "ублюдков", "ублюдкам", "ублюдками", "ублюдках"],
  "мудак": ["мудак", "мудака", "мудаку", "мудаком", "мудаке", "мудаки", "мудаков", "мудакам", "мудаками", "мудаках"],
  "заткнись": ["заткнись", "заткнитесь", "заткнулся", "заткнулась", "заткнулись"],
  "заткни": ["заткни", "заткните"], "иди": ["иди", "идите"],
  "пошел": ["пошел", "пошла", "пошли", "пошло"],
  "срать": ["срать", "сру", "срешь", "срет", "срем", "срете", "срут", "срал", "срала", "срало", "срали", "сри", "срите"],
  "ссать": ["ссать", "ссу", "ссышь", "ссыт", "ссым", "ссыте", "ссут", "ссал", "ссала", "ссали"],
};

export function moderationWordForms(word: string): string[] {
  word = word.toLowerCase().replace(/ё/g, "е");
  if (irregular[word]) return irregular[word];
  if (word.endsWith("срать")) return irregular["срать"].map(form => word.slice(0, -5) + form);
  if (word.length <= 2) return [word];
  if (!/^[а-я]+$/.test(word)) return [word, word + "s", word + "es", word + "ed", word + "ing"];
  if (/(ый|ий|ой)$/.test(word)) return [...new Set([word, ...["ый", "ий", "ой", "ого", "его", "ому", "ему", "ым", "им", "ом", "ем", "ая", "яя", "ую", "юю", "ое", "ее", "ые", "ие", "ых", "их", "ыми", "ими"].map(ending => word.slice(0, -2) + ending)])];
  if (word.endsWith("а")) return ["а", "ы", "и", "е", "у", "ой", "ою", "", "ам", "ами", "ах"].map(ending => word.slice(0, -1) + ending);
  if (word.endsWith("я")) return ["я", "и", "е", "ю", "ей", "ею", "ь", "ям", "ями", "ях"].map(ending => word.slice(0, -1) + ending);
  if (word.endsWith("о")) return ["о", "а", "у", "ом", "е", "ам", "ами", "ах"].map(ending => word.slice(0, -1) + ending);
  if (word.endsWith("е")) return ["е", "я", "ю", "ем", "и", "ям", "ями", "ях"].map(ending => word.slice(0, -1) + ending);
  if (word.endsWith("ать")) return ["ать", "аю", "аешь", "ает", "аем", "аете", "ают", "ал", "ала", "ало", "али", "ай", "айте"].map(ending => word.slice(0, -3) + ending);
  if (word.endsWith("ь")) return ["ь", "и", "ью", "ей", "ям", "ями", "ях"].map(ending => word.slice(0, -1) + ending);
  return ["", "а", "у", "ом", "ем", "е", "ы", "и", "ов", "ев", "ей", "ам", "ям", "ами", "ями", "ах", "ях"].map(ending => word + ending);
}

function literalPattern(word: string) {
  // A masking character can stand for one letter; two visible letters are required below.
  return [...normalizeModerationText(word)].map(letter => /[\p{L}\p{N}]/u.test(letter) ? `[${letter}*#?]` : letter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("");
}
function wordPattern(word: string) {
  if (word.endsWith("*")) return new RegExp(`^${literalPattern(word.slice(0, -1))}[\\p{L}\\p{N}*#?]*$`, "u");
  return new RegExp(`^(?:${moderationWordForms(word).map(literalPattern).join("|")})$`, "u");
}
type Compiled = { rules: Array<{ term: string; first: string; words: RegExp[] }>; exceptions: string[][] };
const cache = new WeakMap<ResponseModerationSettings, Compiled>();
function compiled(settings: ResponseModerationSettings) {
  let value = cache.get(settings);
  if (!value) {
    value = { rules: moderationLines(settings.terms).map(term => ({ term, first: [...normalizeModerationText(term)][0], words: term.split(/\s+/).map(wordPattern) })).sort((a, b) => b.words.length - a.words.length),
      exceptions: moderationLines(settings.exceptions).map(line => normalizeModerationText(line).split(/\s+/)) };
    cache.set(settings, value);
  }
  return value;
}
export type ModerationFinding = { blocked: boolean; rules: string[]; reason?: "term" | "too_long" };
export function inspectResponseText(text: string, settings: ResponseModerationSettings): ModerationFinding {
  if (!settings.enabled) return { blocked: false, rules: [] };
  if (text.length > 200000) return { blocked: true, rules: [], reason: "too_long" };
  const normalized = normalizeModerationText(text);
  const tokens = [...normalized.matchAll(/[*#?]*[\p{L}\p{N}]+(?:[*#?]+[\p{L}\p{N}]+)*[*#?]*/gu)].map(match => ({ value: match[0], start: match.index!, end: match.index! + match[0].length }));
  const config = compiled(settings);
  const allowed = new Set<number>();
  for (const phrase of config.exceptions) {
    for (let i = 0; i <= tokens.length - phrase.length; i++) {
      if (phrase.every((word, offset) => tokens[i + offset].value === word)) phrase.forEach((_, offset) => allowed.add(i + offset));
    }
  }
  const candidates = tokens.map((token, i) => {
    const hasEnoughLetters = (value: string) => /\p{L}.*\p{L}/u.test(value)
      && (!/^[*#?]|[*#?]$/.test(value) || /\p{L}.*\p{L}.*\p{L}/u.test(value) || /^(?:[*#?]уй|ху[*#?])$/u.test(value));
    const result = [{ value: token.value, end: i, hasLetters: hasEnoughLetters(token.value) }];
    if (token.value.length <= 3) {
      let joined = token.value;
      for (let end = i + 1; end < Math.min(tokens.length, i + 8); end++) {
        if (tokens[end].value.length > 3 || !/^[\s._*#?\-]{1,3}$/.test(normalized.slice(tokens[end - 1].end, tokens[end].start))) break;
        joined += tokens[end].value;
        if (joined.length >= 3) result.push({ value: joined, end, hasLetters: hasEnoughLetters(joined) });
      }
    }
    return result;
  });
  const found: string[] = [];
  for (const rule of config.rules) {
    for (let i = 0; i < tokens.length; i++) {
      // Keep the cheap first-letter path for ordinary text, but do not skip
      // a word whose first letter is masked.
      if (!/^[*#?]/.test(tokens[i].value) && !tokens[i].value.startsWith(rule.first)) continue;
      let matched = false;
      if (rule.words.length === 1) {
        const candidate = candidates[i].find(item => item.hasLetters && rule.words[0].test(item.value)
          && !Array.from({ length: item.end - i + 1 }, (_, offset) => i + offset).every(index => allowed.has(index)));
        if (candidate) matched = true;
      } else if (i + rule.words.length <= tokens.length) {
        matched = rule.words.every((pattern, offset) => pattern.test(tokens[i + offset].value))
          && !Array.from({ length: rule.words.length }, (_, offset) => i + offset).every(index => allowed.has(index));
      }
      if (matched) { found.push(rule.term); break; }
    }
    if (found.length === 8) break;
  }
  return { blocked: found.length > 0, rules: found, ...(found.length ? { reason: "term" as const } : {}) };
}
