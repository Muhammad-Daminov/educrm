'use client';

import type { JSX } from 'react';
import { useAuth } from '@/components/auth-provider';
import { EmptyState } from '@/components/states/empty-state';
import { t } from '@/lib/i18n';

/**
 * Ish stoli (UX §4.0). The role-specific widgets it describes — money at
 * risk, today's lessons, unmarked attendance — each need a screen that does
 * not exist yet, so the dashboard says so instead of showing empty cards
 * that look broken. The first real widget lands with T11.
 */
export default function DashboardPage(): JSX.Element {
  const { me } = useAuth();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <h1 className="text-xl font-semibold">
        {t('dashboard.greeting')}, {me.user.fullName}
      </h1>
      <EmptyState
        title={t('dashboard.widgetsPending')}
        description={t('state.placeholder.description')}
      />
    </div>
  );
}
