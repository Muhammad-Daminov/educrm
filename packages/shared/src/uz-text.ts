/**
 * Uzbek Latin text helpers (TZ 8.5: "Apostrof normalizatsiyasi (oʻ, gʻ)
 * qidiruv va saralashda").
 *
 * Two different characters are involved, and they are not interchangeable:
 *
 * - `oʻ` / `gʻ` carry U+02BB MODIFIER LETTER TURNED COMMA. The mark is part
 *   of the *letter* — `oʻ` and `o` are different letters, like `ch` vs `c`.
 * - The tutuq belgisi (glottal stop: `maʼlumot`, `sanʼat`) is U+02BC
 *   MODIFIER LETTER APOSTROPHE.
 *
 * Both are routinely typed as `'`, `’`, `‘` or `` ` `` by users, keyboards
 * and imported spreadsheets, so no comparison may depend on which variant
 * made it into the database. Display text uses the correct characters
 * (`UZ_TURNED_COMMA` / `UZ_APOSTROPHE`); comparison goes through
 * `uzSearchKey` or `compareUzbek`, which make the whole family equivalent.
 */

/** U+02BB — the mark in `oʻ` and `gʻ`. Part of the letter. */
export const UZ_TURNED_COMMA = 'ʻ';

/** U+02BC — tutuq belgisi, the glottal stop in `maʼlumot`. */
export const UZ_APOSTROPHE = 'ʼ';

/**
 * Every character seen standing in for one of the two marks above: ASCII
 * apostrophe, curly quotes, both modifier letters, backtick, acute accent
 * and prime.
 */
const APOSTROPHE_VARIANTS = /['‘’ʻʼ`´′‵]/g;

/** Combining marks left behind by NFD decomposition. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Folds every apostrophe variant to the single canonical U+02BB. Use when
 * the mark must be kept but its spelling must not vary — normalizing
 * imported data, or building a stored key.
 *
 * It deliberately does *not* try to tell `oʻ`/`gʻ` apart from a tutuq
 * belgisi: that needs the word, not the character, so authored display text
 * spells both out by hand.
 */
export function normalizeApostrophes(value: string): string {
  return value.replace(APOSTROPHE_VARIANTS, UZ_TURNED_COMMA);
}

/**
 * Comparison key for search and sort: case-insensitive, diacritic-
 * insensitive, apostrophe-insensitive, with runs of whitespace collapsed.
 *
 * The marks are dropped entirely rather than folded to one character, so
 * `oquvchi` finds `Oʻquvchi` — the mark is the character users are least
 * likely to type, and TZ 8.5 asks for search not to depend on it. Dropping
 * is also a stable choice for sorting: `Oʻzbekov` and `Ozodov` compare on
 * `ozbekov` / `ozodov` instead of on whichever variant was keyed in.
 */
export function uzSearchKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(APOSTROPHE_VARIANTS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sort comparator for user-visible Uzbek text. Compares on `uzSearchKey`
 * so apostrophe spelling and case never reorder a list, then falls back to
 * the raw strings so the order is total (and therefore stable across
 * requests) for values whose keys are equal.
 */
export function compareUzbek(left: string, right: string): number {
  const leftKey = uzSearchKey(left);
  const rightKey = uzSearchKey(right);
  if (leftKey !== rightKey) {
    return leftKey < rightKey ? -1 : 1;
  }
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
