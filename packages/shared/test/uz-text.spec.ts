import { describe, expect, it } from 'vitest';
import {
  UZ_APOSTROPHE,
  UZ_TURNED_COMMA,
  compareUzbek,
  normalizeApostrophes,
  uzSearchKey,
} from '../src/uz-text';

/** The variants a user, keyboard or imported spreadsheet actually produces. */
const VARIANTS = [
  "O'quvchi", // U+0027 ASCII apostrophe
  'O\u2018quvchi', // left single quote
  'O\u2019quvchi', // right single quote
  'O\u02BBquvchi', // the correct oʻ
  'O\u02BCquvchi', // tutuq belgisi, used in the wrong place
  'O\u0060quvchi', // backtick
];

describe('the two Uzbek marks', () => {
  it('are the code points the product owner picked', () => {
    expect(UZ_TURNED_COMMA).toBe('ʻ');
    expect(UZ_APOSTROPHE).toBe('ʼ');
    // They are distinct characters: oʻ/gʻ is not the tutuq belgisi.
    expect(UZ_TURNED_COMMA).not.toBe(UZ_APOSTROPHE);
  });
});

describe('normalizeApostrophes', () => {
  it('folds every variant to U+02BB', () => {
    for (const variant of VARIANTS) {
      expect(normalizeApostrophes(variant)).toBe(`O${UZ_TURNED_COMMA}quvchi`);
    }
  });

  it('keeps the mark rather than dropping it', () => {
    expect(normalizeApostrophes("to'lov")).toBe(`to${UZ_TURNED_COMMA}lov`);
  });

  it('leaves text without any variant untouched', () => {
    expect(normalizeApostrophes('Jadval')).toBe('Jadval');
  });

  it('folds a tutuq belgisi too — the character cannot tell the two apart', () => {
    // Intentional: picking between oʻ/gʻ and the tutuq belgisi needs the
    // word, so authored display text spells both out by hand.
    expect(normalizeApostrophes(`ma${UZ_APOSTROPHE}lumot`)).toBe(`ma${UZ_TURNED_COMMA}lumot`);
  });
});

describe('uzSearchKey', () => {
  it('makes every apostrophe variant the same key', () => {
    const keys = new Set(VARIANTS.map(uzSearchKey));
    expect(keys).toEqual(new Set(['oquvchi']));
  });

  it('drops the mark so it does not have to be typed', () => {
    expect(uzSearchKey("To'lovlar")).toBe('tolovlar');
    expect(uzSearchKey(`Yig${UZ_TURNED_COMMA}ish`)).toBe('yigish');
    expect(uzSearchKey(`ma${UZ_APOSTROPHE}lumot`)).toBe('malumot');
  });

  it('is case-insensitive', () => {
    expect(uzSearchKey('JADVAL')).toBe(uzSearchKey('jadval'));
  });

  it('strips diacritics, including precomposed ones', () => {
    expect(uzSearchKey('Shaykhov')).toBe('shaykhov');
    expect(uzSearchKey('Müller')).toBe('muller');
    // Precomposed é and e + combining acute must land on the same key.
    expect(uzSearchKey('José')).toBe('jose');
    expect(uzSearchKey('José')).toBe('jose');
  });

  it('collapses and trims whitespace', () => {
    expect(uzSearchKey("  Boshlang'ich   daraja ")).toBe('boshlangich daraja');
  });

  it('is idempotent', () => {
    const once = uzSearchKey("O'quvchilar ro\u2019yxati");
    expect(uzSearchKey(once)).toBe(once);
  });
});

describe('compareUzbek', () => {
  it('ignores apostrophe spelling when ordering', () => {
    const names = [`O${UZ_TURNED_COMMA}zodov`, 'Abdullayev', "O'tkirov", 'Ozodov'];
    // Keys: ozodov, abdullayev, otkirov, ozodov.
    expect([...names].sort(compareUzbek)).toEqual([
      'Abdullayev',
      "O'tkirov",
      // Equal keys: the raw string breaks the tie, U+02BB after ASCII 'z'.
      'Ozodov',
      `O${UZ_TURNED_COMMA}zodov`,
    ]);
  });

  it('sorts a mark-bearing letter by its base letter, not by the mark', () => {
    // A naive code-point sort puts anything containing U+02BB after every
    // plain-ASCII name; "Gʻafurov" belongs between Fozilov and Hasanov.
    const sorted = ['Hasanov', `G${UZ_TURNED_COMMA}afurov`, 'Fozilov'].sort(compareUzbek);
    expect(sorted).toEqual(['Fozilov', `G${UZ_TURNED_COMMA}afurov`, 'Hasanov']);
  });

  it('is case-insensitive', () => {
    expect(compareUzbek('abdullayev', 'ABDULLAYEV')).not.toBe(0);
    expect(['bobur', 'Abdulla'].sort(compareUzbek)).toEqual(['Abdulla', 'bobur']);
  });

  it('returns 0 only for identical strings', () => {
    expect(compareUzbek('Jadval', 'Jadval')).toBe(0);
    expect(compareUzbek("O'quvchi", `O${UZ_TURNED_COMMA}quvchi`)).not.toBe(0);
  });

  it('is antisymmetric, so the order is total and therefore stable', () => {
    const values = ['Ozodov', `O${UZ_TURNED_COMMA}zodov`, "O'zodov", 'Abdullayev', 'jadval'];
    for (const left of values) {
      for (const right of values) {
        const forward = Math.sign(compareUzbek(left, right));
        const backward = Math.sign(compareUzbek(right, left));
        expect(forward + backward, `${left} vs ${right}`).toBe(0);
      }
    }
  });
});
