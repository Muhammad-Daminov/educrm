import type { TranslationKey } from '@/lib/i18n';

/**
 * Icon identifiers rather than components, so this module stays free of
 * React and can be unit-tested as plain data. `components/app-sidebar.tsx`
 * maps them to lucide icons.
 */
export type NavIcon =
  | 'dashboard'
  | 'students'
  | 'units'
  | 'schedule'
  | 'attendance'
  | 'finance'
  | 'org'
  | 'settings';

export interface NavItem {
  /** i18n key for the label — never a literal string (CLAUDE.md). */
  labelKey: TranslationKey;
  href: string;
  icon: NavIcon;
  /**
   * Visible when the user holds *any* of these permissions. Omitted means
   * "every authenticated user", which only applies to the dashboard.
   */
  anyOf?: readonly string[];
  children?: readonly NavItem[];
}

/**
 * The R0 slice of UX §1.1, in its order. Sales (R2), payroll (R2),
 * communications and reports are deliberately absent — docs/ROADMAP.md
 * scopes them out of R0, and a menu entry leading to nothing is worse than
 * no entry.
 *
 * Routes are our own: UX §0.3 lists "URL strukturasi" among the things
 * explicitly *not* taken from the reference system, so §1.1's paths are
 * illustrative rather than binding. The dashboard lives at `/` because
 * that is where login lands.
 *
 * Permissions come from the TZ 3.2 catalog seeded in the auth migration.
 * The menu is built from them rather than from roles (UX §1.2: "Menyu
 * ruxsatlardan kelib chiqib quriladi ... qo'lda emas"), so adding a
 * permission to a role is all it takes for the section to appear.
 */
export const NAV_SECTIONS: readonly NavItem[] = [
  { labelKey: 'nav.dashboard', href: '/', icon: 'dashboard' },
  { labelKey: 'nav.students', href: '/students', icon: 'students', anyOf: ['student.view'] },
  { labelKey: 'nav.units', href: '/units', icon: 'units', anyOf: ['study_unit.view'] },
  { labelKey: 'nav.schedule', href: '/schedule', icon: 'schedule', anyOf: ['schedule.view'] },
  {
    labelKey: 'nav.attendance',
    href: '/attendance',
    icon: 'attendance',
    anyOf: ['attendance.view'],
  },
  {
    labelKey: 'nav.finance',
    href: '/finance',
    icon: 'finance',
    anyOf: ['payment.view', 'invoice.view', 'ledger.view', 'finance.view_amounts'],
    children: [
      {
        labelKey: 'nav.finance.payments',
        href: '/finance/payments',
        icon: 'finance',
        anyOf: ['payment.view'],
      },
      {
        labelKey: 'nav.finance.debtors',
        href: '/finance/debtors',
        icon: 'finance',
        anyOf: ['payment.view', 'ledger.view'],
      },
    ],
  },
  {
    labelKey: 'nav.org',
    href: '/org',
    icon: 'org',
    anyOf: ['branch.view', 'employee.view', 'classroom.manage'],
    children: [
      { labelKey: 'nav.org.branches', href: '/org/branches', icon: 'org', anyOf: ['branch.view'] },
      {
        labelKey: 'nav.org.classrooms',
        href: '/org/classrooms',
        icon: 'org',
        anyOf: ['classroom.manage'],
      },
      {
        labelKey: 'nav.org.employees',
        href: '/org/employees',
        icon: 'org',
        anyOf: ['employee.view'],
      },
    ],
  },
  { labelKey: 'nav.settings', href: '/settings', icon: 'settings', anyOf: ['settings.manage'] },
];

/** Reachable by any authenticated user; never shown in the sidebar. */
const UNLISTED_ROUTES: readonly NavItem[] = [
  { labelKey: 'nav.profile', href: '/profile', icon: 'settings' },
];

export interface HeldPermission {
  code: string;
}

export function hasAnyPermission(
  held: readonly HeldPermission[],
  required: readonly string[] | undefined,
): boolean {
  if (required === undefined) {
    return true;
  }
  const codes = new Set(held.map((permission) => permission.code));
  return required.some((code) => codes.has(code));
}

/**
 * The sidebar for one user's permissions.
 *
 * A section survives if the user may open it *or* if any of its children
 * survive — a parent that is only a heading for reachable children still
 * has to be shown, or the children become unreachable by clicking.
 */
export function buildMenu(
  held: readonly HeldPermission[],
  sections: readonly NavItem[] = NAV_SECTIONS,
): NavItem[] {
  const menu: NavItem[] = [];

  for (const section of sections) {
    const children = section.children
      ? section.children.filter((child) => hasAnyPermission(held, child.anyOf))
      : undefined;
    const selfAllowed = hasAnyPermission(held, section.anyOf);

    if (!selfAllowed && (children === undefined || children.length === 0)) {
      continue;
    }
    menu.push(children === undefined ? section : { ...section, children });
  }

  return menu;
}

/**
 * Finds the nav entry a pathname belongs to, preferring the most specific
 * match so `/finance/payments` resolves to the child rather than to
 * `/finance`.
 */
export function findNavRoute(
  pathname: string,
  sections: readonly NavItem[] = NAV_SECTIONS,
): NavItem | undefined {
  const candidates: NavItem[] = [];
  for (const section of [...sections, ...UNLISTED_ROUTES]) {
    candidates.push(section, ...(section.children ?? []));
  }

  return candidates
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0];
}

/** Whether a nav entry should be rendered as the active one for `pathname`. */
export function isActiveRoute(pathname: string, item: NavItem): boolean {
  if (item.href === '/') {
    return pathname === '/';
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export type RouteAccess = 'allowed' | 'forbidden' | 'unknown';

/**
 * UX §1.2: a section the user lacks permission for must answer with the
 * "Ruxsat yo'q" state when opened directly by URL — not a 404, which would
 * tell them the screen does not exist. A genuinely unknown path is still
 * `unknown`, so a typo stays a 404.
 */
export function accessFor(pathname: string, held: readonly HeldPermission[]): RouteAccess {
  const route = findNavRoute(pathname);
  if (!route) {
    return 'unknown';
  }
  return hasAnyPermission(held, route.anyOf) ? 'allowed' : 'forbidden';
}
