import { describe, expect, it } from 'vitest';
import { UZ_APOSTROPHE, UZ_TURNED_COMMA, uzSearchKey } from '@educrm/shared';
import { t, translations } from '../lib/i18n';

/**
 * Orthography guard for TZ 8.5 / UX §8: `oʻ` and `gʻ` use U+02BB, the tutuq
 * belgisi uses U+02BC, and nothing user-facing may fall back to the ASCII
 * apostrophe or a curly quote. A failure here is a language correctness
 * bug, not a style nit — which is why it is a test and not a convention.
 */
const WRONG_MARKS: Record<string, string> = {
  "'": 'U+0027 ASCII apostrophe',
  '‘': 'U+2018 left single quotation mark',
  '’': 'U+2019 right single quotation mark',
  '`': 'U+0060 grave accent',
  '´': 'U+00B4 acute accent',
};

const entries = Object.entries(translations);

describe('uz translations', () => {
  it('has strings to check', () => {
    expect(entries.length).toBeGreaterThan(50);
  });

  it.each(entries)('%s uses no stand-in for the Uzbek marks', (_key, value) => {
    for (const [character, name] of Object.entries(WRONG_MARKS)) {
      expect(value.includes(character), `${name} in "${value}"`).toBe(false);
    }
  });

  it('spells the known oʻ/gʻ words with U+02BB', () => {
    expect(t('nav.students')).toBe(`O${UZ_TURNED_COMMA}quvchilar`);
    expect(t('nav.finance.payments')).toBe(`To${UZ_TURNED_COMMA}lovlar`);
    expect(t('shell.sidebar.collapse')).toBe(`Menyuni yig${UZ_TURNED_COMMA}ish`);
    expect(t('state.forbidden.title')).toBe(`Ruxsat yo${UZ_TURNED_COMMA}q`);
    expect(t('login.error.invalid')).toContain(`noto${UZ_TURNED_COMMA}g${UZ_TURNED_COMMA}ri`);
  });

  it('spells the tutuq belgisi with U+02BC, not with U+02BB', () => {
    // "maʼlumot" is a glottal stop, not the letter oʻ — different character.
    expect(t('state.empty.title')).toBe(`Hali ma${UZ_APOSTROPHE}lumot yo${UZ_TURNED_COMMA}q`);
    expect(t('state.empty.title')).not.toContain(`ma${UZ_TURNED_COMMA}lumot`);
  });

  it('stays findable by a user who types the mark as ASCII, or not at all', () => {
    // The display text is now U+02BB; search must not require it (TZ 8.5).
    expect(uzSearchKey(t('nav.students'))).toBe('oquvchilar');
    expect(uzSearchKey("O'quvchilar")).toBe(uzSearchKey(t('nav.students')));
  });
});
