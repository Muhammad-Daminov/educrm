'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type JSX } from 'react';
import { ApiError } from '@/lib/api';
import { login as loginRequest } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const DEFAULT_TENANT_SLUG = process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG ?? 'demo';

function errorMessageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return t('login.error.invalid');
    }
    if (error.status === 429) {
      return t('login.error.rateLimited');
    }
  }
  return t('login.error.generic');
}

export default function LoginPage(): JSX.Element {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await loginRequest(DEFAULT_TENANT_SLUG, login, password);
      router.replace('/');
    } catch (caught) {
      setError(errorMessageFor(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('login.title')}</CardTitle>
          <CardDescription>{t('login.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              void onSubmit(event);
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('login.loginField')}</span>
              <input
                className="rounded-md border px-3 py-2"
                type="text"
                name="login"
                autoComplete="username"
                placeholder={t('login.loginField.placeholder')}
                value={login}
                onChange={(event) => setLogin(event.target.value)}
                required
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('login.password')}</span>
              <input
                className="rounded-md border px-3 py-2"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>

            {error !== null && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <button
              className="rounded-md bg-primary px-3 py-2 text-primary-foreground disabled:opacity-60"
              type="submit"
              disabled={submitting}
            >
              {submitting ? t('login.submitting') : t('login.submit')}
            </button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
