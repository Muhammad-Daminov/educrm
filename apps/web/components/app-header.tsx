'use client';

import type { JSX } from 'react';
import { useAuth } from '@/components/auth-provider';
import { t } from '@/lib/i18n';

export function AppHeader(): JSX.Element {
  const { me, logout } = useAuth();

  return (
    <header className="flex items-center justify-between border-b px-6 py-4">
      <span className="font-semibold">EduCRM</span>
      <div className="flex items-center gap-4 text-sm">
        <span>{me.user.fullName}</span>
        <button
          className="rounded-md border px-3 py-1.5"
          type="button"
          onClick={() => {
            void logout();
          }}
        >
          {t('header.logout')}
        </button>
      </div>
    </header>
  );
}
