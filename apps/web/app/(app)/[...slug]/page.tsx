'use client';

import { notFound, usePathname } from 'next/navigation';
import type { JSX } from 'react';
import { useAuth } from '@/components/auth-provider';
import { EmptyState } from '@/components/states/empty-state';
import { ForbiddenState } from '@/components/states/forbidden-state';
import { accessFor } from '@/lib/nav';
import { t } from '@/lib/i18n';

/**
 * Catch-all for the sections the shell can navigate to but that have no
 * screen yet (T05–T11 fill them in). A real `page.tsx` added later takes
 * precedence over this route automatically.
 *
 * It exists for one thing the shell genuinely owes: UX §1.2's rule that
 * opening a section you lack permission for shows "Ruxsat yoʻq" and *not*
 * a 404. The distinction is the point — 404 says "no such screen", which
 * sends the user looking instead of asking for access.
 *
 * A path that is in no nav entry at all is still a 404, so a typo doesn't
 * get dressed up as a feature that is coming soon.
 */
export default function SectionPlaceholderPage(): JSX.Element {
  const pathname = usePathname();
  const { me } = useAuth();

  const access = accessFor(pathname, me.permissions);

  if (access === 'unknown') {
    notFound();
  }
  if (access === 'forbidden') {
    return <ForbiddenState />;
  }

  return (
    <EmptyState
      title={t('state.placeholder.title')}
      description={t('state.placeholder.description')}
    />
  );
}
