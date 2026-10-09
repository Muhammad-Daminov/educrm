import type { JSX, ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { AuthProvider } from '@/components/auth-provider';
import { LoadingState } from '@/components/states/loading-state';

/**
 * Everything in this route group requires a session. `/login` deliberately
 * lives outside it (app/login/page.tsx) so it isn't gated by the very
 * check it exists to satisfy.
 */
export default function ProtectedLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <AuthProvider
      fallback={
        <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
          <LoadingState rows={6} />
        </main>
      }
    >
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
