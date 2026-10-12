import { describe, expect, it } from 'vitest';
import { isRetryableTransactionError } from '../../src/database/transaction-retry';

describe('isRetryableTransactionError', () => {
  it('recognizes the exclusion-constraint deadlock Prisma reports as an unknown error', () => {
    // The real text, abridged: two concurrent POST /lessons for one slot.
    const error = new Error(
      'Invalid `tx.lesson.create()` invocation: ConnectorError(ConnectorError { ' +
        'kind: QueryError(PostgresError { code: "40P01", message: "deadlock detected" }) })',
    );
    expect(isRetryableTransactionError(error)).toBe(true);
  });

  it('recognizes the engine’s own P2034 classification of the same failure', () => {
    const error = Object.assign(
      new Error('Transaction failed due to a write conflict or a deadlock'),
      { code: 'P2034' },
    );
    expect(isRetryableTransactionError(error)).toBe(true);
  });

  it('recognizes a serialization failure', () => {
    expect(
      isRetryableTransactionError(new Error('code: "40001", could not serialize access')),
    ).toBe(true);
  });

  it('does not retry a conflict that is a real answer rather than a transient failure', () => {
    // 23P01 is the constraint doing its job: the slot *is* taken, and a
    // retry would only produce the same violation while the caller waits.
    const error = new Error(
      'PostgresError { code: "23P01", message: "conflicting key value violates ' +
        'exclusion constraint \\"lessons_classroom_no_overlap\\"" }',
    );
    expect(isRetryableTransactionError(error)).toBe(false);
  });

  it('does not retry anything else, including non-errors', () => {
    expect(isRetryableTransactionError(new Error('relation does not exist'))).toBe(false);
    expect(isRetryableTransactionError(null)).toBe(false);
    expect(isRetryableTransactionError(undefined)).toBe(false);
    expect(isRetryableTransactionError({ code: 'P2002' })).toBe(false);
  });
});
