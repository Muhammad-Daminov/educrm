/**
 * Two concurrent transactions that both insert a row checked by the same
 * exclusion constraint can deadlock each other, and Postgres will abort one
 * of them with SQLSTATE 40P01.
 *
 * This is not a bug in the constraint; it is how exclusion-constraint
 * insertion works. The tuple goes into the index *first* and the overlap scan
 * runs *after*, so when the two inserts interleave closely enough each
 * transaction's scan finds the other's uncommitted tuple and waits for it —
 * a cycle. (A unique index avoids this by ordering waits on the key itself;
 * an exclusion constraint has no single key to order on.)
 *
 * The victim's transaction is rolled back whole, so nothing it wrote
 * persisted and re-running it is safe. On the second attempt the other
 * writer has committed, so the ordinary path applies: the application's own
 * pre-check sees the committed lesson and answers with a 409
 * SCHEDULE_CONFLICT carrying alternatives (UX P4) instead of a 500.
 *
 * 40001 (serialization failure) is included for the same reason: a
 * transaction aborted for a transient concurrency reason, retryable by
 * definition.
 */

/** How many times a transaction body may run in total, retries included. */
export const MAX_TRANSACTION_ATTEMPTS = 3;

/** Small, growing pause so the retry does not re-collide immediately. */
export const RETRY_BACKOFF_MS = 10;

/**
 * Prisma does not type these: an exclusion-constraint deadlock arrives as a
 * `PrismaClientUnknownRequestError` whose message embeds the raw Postgres
 * error, and the engine sometimes classifies it as `P2034` instead. Both
 * shapes are matched, since which one you get depends on the engine's view
 * of the failure rather than on anything we control.
 */
export function isRetryableTransactionError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if ((error as { code?: unknown }).code === 'P2034') {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return /\b40P01\b|\b40001\b|deadlock detected|could not serialize access/i.test(message);
}

export function retryDelay(attempt: number): number {
  return RETRY_BACKOFF_MS * attempt;
}
