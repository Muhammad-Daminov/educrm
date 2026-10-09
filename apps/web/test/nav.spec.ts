import { describe, expect, it } from 'vitest';
import {
  accessFor,
  buildMenu,
  findNavRoute,
  hasAnyPermission,
  isActiveRoute,
  NAV_SECTIONS,
  type NavItem,
} from '../lib/nav';

/** Shapes a permission list the way /auth/me returns it. */
function held(...codes: string[]): { code: string }[] {
  return codes.map((code) => ({ code }));
}

function hrefs(menu: readonly NavItem[]): string[] {
  return menu.map((item) => item.href);
}

describe('buildMenu (UX §1.2 — menu from permissions, not roles)', () => {
  it('shows a user with no permissions only the dashboard', () => {
    // Everything else is permission-gated, so a brand-new employee with no
    // role assigned yet sees a shell they can log into and nothing more.
    expect(hrefs(buildMenu([]))).toEqual(['/']);
  });

  it('shows an owner-like user every section', () => {
    const everything = held(...NAV_SECTIONS.flatMap((section) => section.anyOf ?? []));
    expect(hrefs(buildMenu(everything))).toEqual(hrefs(NAV_SECTIONS));
  });

  it('builds the administrator menu from their TZ 3.2 permissions', () => {
    // Exactly the administrator role template in apps/api/src/auth/
    // role-templates.ts.
    const administrator = held(
      'branch.view',
      'schedule.view',
      'schedule.create',
      'schedule.update',
      'attendance.view',
      'attendance.mark',
      'payment.view',
      'payment.create',
      'invoice.view',
      'student.view',
    );

    expect(hrefs(buildMenu(administrator))).toEqual([
      '/',
      '/students',
      '/schedule',
      '/attendance',
      '/finance',
      '/org',
    ]);
    // No study_unit.view, so Guruhlar stays hidden; no settings.manage either.
    expect(hrefs(buildMenu(administrator))).not.toContain('/units');
    expect(hrefs(buildMenu(administrator))).not.toContain('/settings');
  });

  it('builds the teacher menu from own-scope permissions only', () => {
    const teacher = held(
      'schedule.view',
      'attendance.view',
      'attendance.mark',
      'lesson.complete',
      'payroll.view_own',
    );

    expect(hrefs(buildMenu(teacher))).toEqual(['/', '/schedule', '/attendance']);
  });

  it('hides money from a user without any finance permission', () => {
    // The decision recorded in docs/ROADMAP.md is that administrator and
    // teacher do NOT get finance.view_amounts — but an administrator still
    // takes payments, so the test that matters is the negative one.
    expect(hrefs(buildMenu(held('student.view')))).not.toContain('/finance');
  });

  it('filters children independently of the parent', () => {
    const menu = buildMenu(held('branch.view'));
    const org = menu.find((section) => section.href === '/org');

    expect(hrefs(org?.children ?? [])).toEqual(['/org/branches']);
  });

  it('keeps a parent whose own permission is missing but which has a visible child', () => {
    // Otherwise the child would be rendered under nothing — or worse,
    // dropped with its parent and made unreachable by clicking.
    const sections: NavItem[] = [
      {
        labelKey: 'nav.org',
        href: '/org',
        icon: 'org',
        anyOf: ['settings.manage'],
        children: [
          { labelKey: 'nav.org.branches', href: '/org/branches', icon: 'org', anyOf: ['branch.view'] },
        ],
      },
    ];

    const menu = buildMenu(held('branch.view'), sections);
    expect(hrefs(menu)).toEqual(['/org']);
    expect(hrefs(menu[0]?.children ?? [])).toEqual(['/org/branches']);
  });

  it('does not mutate the shared NAV_SECTIONS model', () => {
    const before = JSON.stringify(NAV_SECTIONS);
    buildMenu(held('branch.view'));
    expect(JSON.stringify(NAV_SECTIONS)).toBe(before);
  });
});

describe('hasAnyPermission', () => {
  it('treats an absent requirement as public to authenticated users', () => {
    expect(hasAnyPermission([], undefined)).toBe(true);
  });

  it('needs only one of several codes', () => {
    expect(hasAnyPermission(held('ledger.view'), ['payment.view', 'ledger.view'])).toBe(true);
    expect(hasAnyPermission(held('student.view'), ['payment.view', 'ledger.view'])).toBe(false);
  });

  it('is false for an empty requirement list', () => {
    // An explicitly empty list means "nobody", unlike undefined.
    expect(hasAnyPermission(held('payment.view'), [])).toBe(false);
  });
});

describe('findNavRoute', () => {
  it('prefers the most specific match', () => {
    expect(findNavRoute('/finance/payments')?.href).toBe('/finance/payments');
    expect(findNavRoute('/finance')?.href).toBe('/finance');
  });

  it('matches a nested path to its section', () => {
    // A student detail page belongs to the Students section.
    expect(findNavRoute('/students/01a1-abc')?.href).toBe('/students');
  });

  it('resolves routes that are reachable but not in the sidebar', () => {
    expect(findNavRoute('/profile')?.href).toBe('/profile');
  });

  it('does not match an unrelated path that merely shares a prefix', () => {
    expect(findNavRoute('/studentsomething')).toBeUndefined();
  });

  it('returns nothing for an unknown path', () => {
    expect(findNavRoute('/nope')).toBeUndefined();
  });
});

describe('isActiveRoute', () => {
  const dashboard = NAV_SECTIONS[0] as NavItem;
  const students = NAV_SECTIONS[1] as NavItem;

  it('marks the dashboard active only on the exact root path', () => {
    // `/` is a prefix of everything, so the generic rule would light it up
    // on every page.
    expect(isActiveRoute('/', dashboard)).toBe(true);
    expect(isActiveRoute('/students', dashboard)).toBe(false);
  });

  it('marks a section active for its sub-paths', () => {
    expect(isActiveRoute('/students', students)).toBe(true);
    expect(isActiveRoute('/students/01a1-abc', students)).toBe(true);
    expect(isActiveRoute('/units', students)).toBe(false);
  });
});

describe('accessFor (UX §1.2 — forbidden is not 404)', () => {
  it('allows a section the user holds a permission for', () => {
    expect(accessFor('/students', held('student.view'))).toBe('allowed');
  });

  it('forbids — rather than hides — a section the user lacks', () => {
    expect(accessFor('/finance', held('student.view'))).toBe('forbidden');
    expect(accessFor('/finance/payments', held('student.view'))).toBe('forbidden');
  });

  it('still reports an unknown path as unknown, so a typo stays a 404', () => {
    expect(accessFor('/does-not-exist', held('student.view'))).toBe('unknown');
  });

  it('allows the dashboard and profile to any authenticated user', () => {
    expect(accessFor('/', [])).toBe('allowed');
    expect(accessFor('/profile', [])).toBe('allowed');
  });
});
