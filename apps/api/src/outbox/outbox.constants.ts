/** BullMQ queue name shared by the dispatcher (producer) and the worker. */
export const OUTBOX_QUEUE = 'outbox';

/**
 * TZ M2: "Retry: exponential backoff, 5 urinish, keyin dead-letter + alert".
 * The fifth failure is terminal.
 */
export const MAX_ATTEMPTS = 5;

/** TZ M2 cycle protection: a chain deeper than this is cut. */
export const MAX_CAUSATION_DEPTH = 3;

const BASE_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 60 * 60_000;

/**
 * Delay before retrying an event that has already failed `attempts` times:
 * 10s, 20s, 40s, 80s... capped at an hour.
 *
 * Deliberately deterministic (no jitter). The retry delay is stored on the
 * row as `next_retry_at`, so two workers never retry the same event at the
 * same moment regardless — the claim is what serializes them, not the
 * spread of the delays. Keeping it exact also keeps it testable.
 */
export function backoffMs(attempts: number): number {
  if (attempts <= 0) {
    return 0;
  }
  const exponential = BASE_BACKOFF_MS * 2 ** (attempts - 1);
  return Math.min(exponential, MAX_BACKOFF_MS);
}
