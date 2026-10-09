'use client';

import { useCallback, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { useAuth } from '@/components/auth-provider';
import { AppSidebar } from '@/components/app-sidebar';
import { AppTopbar } from '@/components/app-topbar';
import { BranchProvider } from '@/components/branch-provider';
import { CommandPalette } from '@/components/command-palette';
import { ToastProvider } from '@/components/toast-provider';
import { buildMenu } from '@/lib/nav';

const SIDEBAR_STORAGE_KEY = 'educrm.sidebar.collapsed';

/**
 * The app shell from UX §2.1: topbar across the top, sidebar on the left,
 * page content in the rest.
 *
 * The menu is built here, once, from the permissions `/auth/me` returned,
 * and handed to both the sidebar and the command palette — so the palette
 * can never offer a destination the sidebar hides (UX §1.2, §2.4).
 */
export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const { me } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const menu = useMemo(() => buildMenu(me.permissions), [me.permissions]);

  // UX §2.2 wants the collapsed state on the user's profile so it follows
  // them across devices; there is no settings API until T05, so this is
  // per-device for now (docs/QUESTIONS.md). Read after mount — localStorage
  // does not exist while server-rendering.
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true');
  }, []);

  const toggleSidebar = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  // Ctrl/Cmd+K lives here rather than in the palette because the topbar's
  // search button opens the same thing.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        // Both Chrome and Firefox bind Ctrl+K to the address bar.
        event.preventDefault();
        setPaletteOpen((previous) => !previous);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <BranchProvider userId={me.user.id} branches={me.branches}>
      <ToastProvider>
        <div className="flex h-screen flex-col">
          <AppTopbar
            onToggleSidebar={toggleSidebar}
            sidebarCollapsed={collapsed}
            onOpenSearch={() => setPaletteOpen(true)}
          />
          <div className="flex min-h-0 flex-1">
            <AppSidebar menu={menu} collapsed={collapsed} />
            {/* min-w-0 so a wide table scrolls inside main instead of
                stretching the whole shell. */}
            <main className="min-w-0 flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
        <CommandPalette menu={menu} open={paletteOpen} onOpenChange={setPaletteOpen} />
      </ToastProvider>
    </BranchProvider>
  );
}
