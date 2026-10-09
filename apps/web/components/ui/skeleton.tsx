import type { JSX } from 'react';
import { cn } from '@/lib/utils';

/**
 * UX §3.8: loading is a skeleton, not a spinner, and the layout must not
 * jump when the real content arrives — so a skeleton should occupy the same
 * box as what replaces it.
 */
export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-muted', className)} />;
}
