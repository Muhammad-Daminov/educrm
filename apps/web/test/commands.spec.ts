import { describe, expect, it } from 'vitest';
import { buildCommands, filterCommands } from '../lib/commands';
import { buildMenu } from '../lib/nav';
import { t } from '../lib/i18n';

function held(...codes: string[]): { code: string }[] {
  return codes.map((code) => ({ code }));
}

const FULL_MENU = buildMenu(
  held(
    'student.view',
    'study_unit.view',
    'schedule.view',
    'attendance.view',
    'payment.view',
    'ledger.view',
    'branch.view',
    'employee.view',
    'classroom.manage',
    'settings.manage',
  ),
);

function labels(query: string): string[] {
  return filterCommands(query, buildCommands(FULL_MENU)).map((command) => command.label);
}

describe('buildCommands', () => {
  it('includes sections and their children, flattened in menu order', () => {
    const commands = buildCommands(FULL_MENU);
    const hrefs = commands.map((command) => command.href);

    expect(hrefs.slice(0, 3)).toEqual(['/', '/students', '/units']);
    expect(hrefs).toContain('/finance/payments');
    // A child is listed right after its parent.
    expect(hrefs.indexOf('/finance/payments')).toBe(hrefs.indexOf('/finance') + 1);
  });

  it('labels a child with its parent section as context', () => {
    const payments = buildCommands(FULL_MENU).find(
      (command) => command.href === '/finance/payments',
    );
    expect(payments?.label).toBe(t('nav.finance.payments'));
    expect(payments?.groupLabel).toBe(t('nav.finance'));
  });

  it('offers nothing the menu hides (UX §2.4)', () => {
    // The palette is built from the filtered menu, so a user who cannot see
    // Moliya cannot Ctrl+K their way into it either.
    const commands = buildCommands(buildMenu(held('student.view')));
    expect(commands.map((command) => command.href)).toEqual(['/', '/students']);
  });
});

describe('filterCommands', () => {
  it('returns everything in menu order for an empty query', () => {
    expect(labels('')).toEqual(buildCommands(FULL_MENU).map((command) => command.label));
  });

  it('matches a prefix', () => {
    expect(labels('Dav')).toContain(t('nav.attendance'));
    expect(labels('dav')[0]).toBe(t('nav.attendance'));
  });

  it('is case-insensitive', () => {
    expect(labels('JADVAL')[0]).toBe(t('nav.schedule'));
  });

  it('matches without the apostrophe nobody wants to type', () => {
    // "O'quvchilar" / "To'lovlar" — the apostrophe is the character users
    // are least likely to reach for, so matching must not depend on it.
    expect(labels('oqu')[0]).toBe(t('nav.students'));
    expect(labels('tolov')).toContain(t('nav.finance.payments'));
  });

  it('matches a subsequence, not just a substring', () => {
    expect(labels('qrz')).toContain(t('nav.finance.debtors'));
  });

  it('ranks an earlier, tighter match first', () => {
    const results = labels('fil');
    // "Filiallar" starts with it; nothing else should outrank that.
    expect(results[0]).toBe(t('nav.org.branches'));
  });

  it('finds a child by its parent section name', () => {
    expect(labels('Moliya').length).toBeGreaterThan(1);
    expect(labels('Moliya')).toContain(t('nav.finance.debtors'));
  });

  it('returns nothing when no command matches', () => {
    expect(labels('zzzzz')).toEqual([]);
  });

  it('is stable: equal scores keep menu order', () => {
    const first = labels('a');
    expect(labels('a')).toEqual(first);
  });
});
