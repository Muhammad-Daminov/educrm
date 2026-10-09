import type { JSX, ReactNode } from 'react';
import { t } from '@/lib/i18n';

/**
 * UX §3.8 draws a hard line between two empty states, because they need
 * different answers:
 *
 *  - never-populated — "what is this + the button to create the first one"
 *  - filtered to nothing — "which filter is doing it + how to clear it"
 *
 * Hence `action` is part of the contract rather than optional decoration:
 * "Bo'sh holat foydasiz" (a useless empty state) is listed in UX P1 as a
 * defect to fix, and an empty state with no next step is exactly that.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <p className="font-medium">{title ?? t('state.empty.title')}</p>
      {description !== undefined && (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      )}
      {action}
    </div>
  );
}
