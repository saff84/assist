/** Join explicitly numbered continuations after extracting all PDF pages.
 * Page headings and footnotes stay in place; the table lives at its start. */
export function mergeContinuedTables(markdown: string): string {
  const blocks = markdown.split(/\n[ \t]*\n/);
  const caption = (text: string) =>
    /^(?:#{1,6}\s+)?Таблица\s+(\d+)\b/i.exec(text.trim());
  const continuation = (text: string) =>
    /^(?:#{1,6}\s+)?(?:Продолжение|Окончание)\s+таблицы\s+(\d+)[.\s]*$/i.exec(text.trim());
  const table = (text: string) => {
    const lines = text.trim().split("\n");
    if (!lines[0]?.startsWith("|") || !/^\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[1] ?? "")) return null;
    if (lines.length < 3 || lines.slice(2).some(line => !line.startsWith("|"))) return null;
    return lines;
  };
  const signature = (header: string) =>
    header.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("ru");
  let previous: { number: string; index: number; header: string } | undefined;
  let pending: { number: string; index: number; continued: boolean } | undefined;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index].trim();
    const start = caption(block), next = continuation(block);
    if (start || next) {
      pending = { number: (start ?? next)![1], index, continued: !!next };
      if (start) previous = undefined;
      continue;
    }
    const lines = table(block);
    if (lines) {
      if (pending?.continued && previous?.number === pending.number &&
          previous.header === signature(lines[0])) {
        blocks[previous.index] += "\n" + lines.slice(2).join("\n");
        blocks[index] = "";
        blocks[pending.index] = `> Продолжение таблицы ${pending.number} объединено с её началом выше.`;
      } else if (pending && !pending.continued) {
        previous = { number: pending.number, index, header: signature(lines[0]) };
      } else {
        if (pending?.continued) {
          blocks[pending.index] += "\n\n> Не удалось объединить продолжение: не найдено начало с тем же номером и заголовками столбцов.";
        }
        previous = pending?.continued
          ? { number: pending.number, index, header: signature(lines[0]) }
          : undefined;
      }
      pending = undefined;
      continue;
    }
    // Do not search across unrelated prose between a caption and its grid.
    if (block && !/^## Страница \d+$/.test(block)) pending = undefined;
    if (/^#{1,6}\s/.test(block) && !/^## Страница \d+$/.test(block)) previous = undefined;
  }
  return blocks.filter(block => block.trim()).join("\n\n").trimEnd() + "\n";
}
