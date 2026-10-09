'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type JSX } from 'react';
import { ChevronDown, Menu, Search } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { BranchSelector } from '@/components/branch-selector';
import { t } from '@/lib/i18n';

/**
 * UX §2.2, 56px: brand (to the dashboard), the sidebar collapse toggle, the
 * branch selector, the global search entry point, and the avatar menu.
 *
 * Chat and notification bells from the same table are absent on purpose:
 * messaging is out of R0 scope (docs/ROADMAP.md), and a bell that can never
 * have unread items is worse than none.
 *
 * The search control opens the command palette rather than doing anything
 * itself — global search across students, groups and phone numbers (UX §2.2)
 * needs the search endpoint and the entities, which arrive in T06/T07. It is
 * a button, not a disabled input, so it never looks like a text field that
 * ignores typing.
 */
export function AppTopbar({
  onToggleSidebar,
  sidebarCollapsed,
  onOpenSearch,
}: {
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
  onOpenSearch: () => void;
}): JSX.Element {
  const { me, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function onPointerDown(event: MouseEvent): void {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <button
        type="button"
        className="rounded-md p-2 hover:bg-muted"
        aria-label={sidebarCollapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')}
        aria-expanded={!sidebarCollapsed}
        onClick={onToggleSidebar}
      >
        <Menu aria-hidden className="h-4 w-4" />
      </button>

      <Link href="/" className="font-semibold">
        {t('shell.brand')}
      </Link>

      <BranchSelector />

      <button
        type="button"
        className="ml-auto flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-muted-foreground"
        onClick={onOpenSearch}
      >
        <Search aria-hidden className="h-4 w-4" />
        <span>{t('shell.search.placeholder')}</span>
        <kbd className="rounded border px-1.5 py-0.5 text-xs">{t('shell.search.shortcut')}</kbd>
      </button>

      <div ref={menuRef} className="relative">
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t('shell.userMenu.open')}
          onClick={() => setMenuOpen((previous) => !previous)}
        >
          <span className="max-w-40 truncate">{me.user.fullName}</span>
          <ChevronDown aria-hidden className="h-4 w-4 text-muted-foreground" />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 z-40 mt-1 w-48 overflow-hidden rounded-md border bg-background shadow-lg"
          >
            <Link
              role="menuitem"
              href="/profile"
              className="block px-3 py-2 text-sm hover:bg-muted"
              onClick={() => setMenuOpen(false)}
            >
              {t('shell.userMenu.profile')}
            </Link>
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => {
                setMenuOpen(false);
                void logout();
              }}
            >
              {t('shell.userMenu.logout')}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
