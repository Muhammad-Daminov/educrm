'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';
import {
  Building2,
  CalendarDays,
  ClipboardCheck,
  LayoutDashboard,
  Settings,
  Users,
  UsersRound,
  Wallet,
} from 'lucide-react';
import { isActiveRoute, type NavIcon, type NavItem } from '@/lib/nav';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const ICONS: Record<NavIcon, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  students: Users,
  units: UsersRound,
  schedule: CalendarDays,
  attendance: ClipboardCheck,
  finance: Wallet,
  org: Building2,
  settings: Settings,
};

/**
 * UX §2.3: two levels, the active item marked at both, icon + tooltip when
 * collapsed. The item list is whatever `buildMenu` produced for this user's
 * permissions — this component never decides visibility itself.
 */
export function AppSidebar({
  menu,
  collapsed,
}: {
  menu: readonly NavItem[];
  collapsed: boolean;
}): JSX.Element {
  const pathname = usePathname();

  return (
    <nav
      aria-label={t('shell.sidebar.label')}
      className={cn(
        'shrink-0 border-r bg-background transition-[width] duration-150',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <ul className="flex flex-col gap-1 p-2">
        {menu.map((section) => {
          const Icon = ICONS[section.icon];
          const active = isActiveRoute(pathname, section);
          const label = t(section.labelKey);

          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? 'page' : undefined}
                // The tooltip is the only label when collapsed, so it is
                // always present rather than only in the collapsed state.
                title={label}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm',
                  collapsed && 'justify-center px-0',
                  active ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60',
                )}
              >
                <Icon aria-hidden className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>

              {/*
                Children are hidden while collapsed: at 64px there is no
                room for a second level, and UX §2.3 puts the collapsed
                state at icon + tooltip only.
              */}
              {!collapsed && section.children !== undefined && section.children.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1 border-l pl-4">
                  {section.children.map((child) => {
                    const childActive = isActiveRoute(pathname, child);
                    return (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          aria-current={childActive ? 'page' : undefined}
                          className={cn(
                            'block rounded-md px-3 py-1.5 text-sm',
                            childActive
                              ? 'bg-muted font-medium'
                              : 'text-muted-foreground hover:bg-muted/60',
                          )}
                        >
                          {t(child.labelKey)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
