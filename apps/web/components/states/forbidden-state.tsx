import type { JSX } from 'react';
import { t } from '@/lib/i18n';

/**
 * UX §1.2 / §3.8: opening a section you lack permission for shows "Ruxsat
 * yo'q" with why and who to ask — explicitly *not* a 404. A 404 would claim
 * the screen does not exist, which sends the user hunting instead of asking
 * their manager for the permission.
 *
 * Note this is a display state only. The authorization decision itself is
 * the backend's (CLAUDE.md: "Permission check in backend only"); hiding a
 * screen here is a courtesy, never the control.
 */
export function ForbiddenState(): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border px-6 py-12 text-center">
      <p className="font-medium">{t('state.forbidden.title')}</p>
      <p className="max-w-md text-sm text-muted-foreground">{t('state.forbidden.description')}</p>
    </div>
  );
}
