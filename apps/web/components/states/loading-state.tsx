'use client';

import { useEffect, useState, type JSX } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/lib/i18n';

/**
 * UX §3.8: "300 ms dan tez bo'lsa skeleton ko'rsatilmaydi" — a skeleton
 * that flashes for 80ms reads as a glitch, so nothing is rendered until the
 * load has lasted long enough to be worth acknowledging.
 */
const SKELETON_DELAY_MS = 300;

export function LoadingState({
  rows = 5,
  delayMs = SKELETON_DELAY_MS,
}: {
  rows?: number;
  delayMs?: number;
}): JSX.Element | null {
  const [visible, setVisible] = useState(delayMs === 0);

  useEffect(() => {
    if (delayMs === 0) {
      return;
    }
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  if (!visible) {
    return null;
  }

  return (
    <div role="status" aria-busy="true" aria-label={t('state.loading')} className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}
