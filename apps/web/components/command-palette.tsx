'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { Search } from 'lucide-react';
import { buildCommands, filterCommands } from '@/lib/commands';
import type { NavItem } from '@/lib/nav';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * The Ctrl+K command palette, navigation only for R0 (docs/ROADMAP.md).
 *
 * Ctrl/Cmd+K is listened for globally and stays live inside text inputs —
 * UX §2.4 disables shortcuts while typing "except Ctrl combinations", and
 * this is one. The bare-key shortcuts from the same table (`/`, `N`, `G`
 * then a letter, `J`/`K`) need that typing guard and arrive with the list
 * screens they act on.
 * Commands are derived from the permission-filtered menu, which is how
 * UX §2.4's "ruxsatsiz amallar ko'rinmaydi" holds without a second
 * permission check here.
 */
export function CommandPalette({
  menu,
  open,
  onOpenChange,
}: {
  menu: readonly NavItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element | null {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo(() => buildCommands(menu), [menu]);
  const results = useMemo(() => filterCommands(query, commands), [query, commands]);

  // Reset on each open, so the palette never reopens showing the previous
  // query's results.
  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlighted(0);
      inputRef.current?.focus();
    }
  }, [open]);

  // Clamp rather than reset: narrowing the query shouldn't throw the
  // highlight away, but it must never point past the end of the list.
  useEffect(() => {
    setHighlighted((previous) => Math.min(previous, Math.max(results.length - 1, 0)));
  }, [results.length]);

  if (!open) {
    return null;
  }

  function go(href: string): void {
    onOpenChange(false);
    router.push(href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((previous) => (results.length === 0 ? 0 : (previous + 1) % results.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((previous) =>
        results.length === 0 ? 0 : (previous - 1 + results.length) % results.length,
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[highlighted];
      if (target) {
        go(target.href);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onOpenChange(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24"
      // A click on the backdrop closes; clicks inside the dialog stop here.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange(false);
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        className="w-full max-w-lg overflow-hidden rounded-lg border bg-background shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search aria-hidden className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls="command-palette-results"
            aria-label={t('palette.placeholder')}
            placeholder={t('palette.placeholder')}
            className="w-full bg-transparent py-3 text-sm outline-none"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
          />
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {t('palette.empty')}
          </p>
        ) : (
          <ul id="command-palette-results" role="listbox" className="max-h-80 overflow-y-auto py-1">
            {results.map((command, index) => (
              <li key={command.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  className={cn(
                    'flex w-full items-center gap-2 px-4 py-2 text-left text-sm',
                    index === highlighted ? 'bg-muted' : 'hover:bg-muted/60',
                  )}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => go(command.href)}
                >
                  <span className="flex-1">{command.label}</span>
                  {command.groupLabel !== undefined && (
                    <span className="text-xs text-muted-foreground">{command.groupLabel}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="border-t px-4 py-2 text-xs text-muted-foreground">{t('palette.hint')}</p>
      </div>
    </div>
  );
}
