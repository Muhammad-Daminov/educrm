'use client';

import { useEffect, useRef, useState, type JSX } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';
import { useBranch } from '@/components/branch-provider';
import { branchColorClass } from '@/lib/branch-color';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function BranchSelector(): JSX.Element | null {
  const { branches, selectedBranchId, selectBranch } = useBranch();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Nothing to switch between: a single-branch user gets no control, and a
  // user with no branch assignment gets told so rather than shown an empty
  // dropdown.
  if (branches.length === 0) {
    return (
      <span className="text-sm text-muted-foreground" title={t('branch.none')}>
        {t('branch.none')}
      </span>
    );
  }

  const selected = branches.find((branch) => branch.id === selectedBranchId);
  const label = selected?.name ?? t('branch.all');

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('branch.select')}
        onClick={() => setOpen((previous) => !previous)}
      >
        {selected === undefined ? (
          <Building2 aria-hidden className="h-4 w-4 text-muted-foreground" />
        ) : (
          <span aria-hidden className={cn('h-2.5 w-2.5 rounded-full', branchColorClass(selected.id))} />
        )}
        <span className="max-w-40 truncate">{label}</span>
        <ChevronDown aria-hidden className="h-4 w-4 text-muted-foreground" />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={t('branch.label')}
          className="absolute left-0 z-40 mt-1 w-56 overflow-hidden rounded-md border bg-background shadow-lg"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={selectedBranchId === null}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => {
                selectBranch(null);
                setOpen(false);
              }}
            >
              <Building2 aria-hidden className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1">{t('branch.all')}</span>
              {selectedBranchId === null && <Check aria-hidden className="h-4 w-4" />}
            </button>
          </li>
          {branches.map((branch) => (
            <li key={branch.id}>
              <button
                type="button"
                role="option"
                aria-selected={selectedBranchId === branch.id}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  selectBranch(branch.id);
                  setOpen(false);
                }}
              >
                <span aria-hidden className={cn('h-2.5 w-2.5 rounded-full', branchColorClass(branch.id))} />
                <span className="flex-1 truncate">{branch.name}</span>
                {selectedBranchId === branch.id && <Check aria-hidden className="h-4 w-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
