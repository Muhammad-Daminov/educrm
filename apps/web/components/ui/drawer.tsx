'use client';

import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

/**
 * Right-hand drawer, UX P6: "Qisqa forma — drawer (kontekst yoʻqolmaydi)".
 * The list stays visible behind it, which is the whole point — you can see
 * what you are editing in context.
 *
 * Keyboard behaviour is part of the requirement, not polish (UX §8.6):
 * Escape closes, focus moves into the panel on open and back to the opener
 * on close, and Tab is trapped inside while it is open.
 */
export function Drawer({
  open,
  title,
  description,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    openerRef.current = document.activeElement;
    const panel = panelRef.current;
    // First focusable control, so a form is typable immediately.
    const focusable = panel?.querySelector<HTMLElement>(
      'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? panel)?.focus();

    return () => {
      if (openerRef.current instanceof HTMLElement) {
        openerRef.current.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const panel = panelRef.current;
      if (panel === null) {
        return;
      }
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Clicking the backdrop closes it the same way Escape does; the
          unsaved-changes guard lives in the form, so both paths hit it. */}
      <div
        className="absolute inset-0 bg-foreground/20"
        onClick={onClose}
        role="presentation"
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-xl flex-col border-l border-border bg-background shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {description !== undefined && (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('drawer.close')}>
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer !== undefined && (
          <div className="flex items-center justify-end gap-2 border-t px-6 py-4">{footer}</div>
        )}
      </div>
    </div>
  );
}
