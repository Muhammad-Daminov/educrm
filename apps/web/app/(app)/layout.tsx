import type { JSX, ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { AuthProvider } from '@/components/auth-provider';
import { t } from '@/lib/i18n';

/**
 * Everything in this route group requires a session. `/login` deliberately
 * lives outside it (app/login/page.tsx) so it isn't gated by the very
 * check it exists to satisfy.
 */
export default function ProtectedLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <AuthProvider
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <p className="text-sm text-muted-foreground">{t('header.loading')}</p>
        </main>
      }
    >
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <div className="flex-1 p-6">{children}</div>
      </div>
    </AuthProvider>
  );
}
