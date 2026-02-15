const FOOTNOTE_MARKER_REGEX =
  /(?<=\S)[\u00B9\u00B2\u00B3\u2070-\u2079]|\((?:\d{1,2})\)/g;
const INLINE_FOOTNOTE_DIGIT_REGEX =
  /\s+\d{1,2}(?=\s+[^\d\s]+\s+[0-9])/g;

/**
 * Removes inline footnote markers (e.g., ¹, ², ³) from text fragments.
 * These markers often appear after labels in catalog tables and should not be
 * treated as part of the actual value.
 */
export function stripFootnoteMarkers(text: string | null | undefined): string {
  if (!text) {
    return text ?? "";
  }
  return text
    .replace(FOOTNOTE_MARKER_REGEX, "")
    .replace(INLINE_FOOTNOTE_DIGIT_REGEX, " ");
}

