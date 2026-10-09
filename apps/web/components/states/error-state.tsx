'use client';

import { useState, type JSX } from 'react';
import { ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';

/**
 * UX §3.8 error state: a cause in human language, what to do next, and the
 * request_id — "support uchun nusxalanadi", so it is copyable rather than
 * something the user has to transcribe from a screenshot. Every API error
 * body carries one (TZ 6.2), which is what makes a support ticket
 * traceable to a single log line.
 */
export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const apiError = error instanceof ApiError ? error : undefined;
  const requestId = apiError?.body.request_id;
  const message = apiError?.body.message ?? t('state.error.title');

  function copyRequestId(): void {
    if (requestId === undefined || requestId === '') {
      return;
    }
    void navigator.clipboard.writeText(requestId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    });
  }

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-6 py-5"
    >
      <p className="font-medium">{t('state.error.title')}</p>
      <p className="text-sm text-muted-foreground">{message}</p>

      <div className="flex flex-wrap items-center gap-3">
        {onRetry !== undefined && (
          <button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={onRetry}>
            {t('state.error.retry')}
          </button>
        )}
        {requestId !== undefined && requestId !== '' && (
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 font-mono text-xs"
            onClick={copyRequestId}
            aria-label={t('state.error.requestIdCopy')}
            title={t('state.error.support')}
          >
            {copied ? t('state.error.requestIdCopied') : `${t('state.error.requestId')}: ${requestId}`}
          </button>
        )}
      </div>
    </div>
  );
}
