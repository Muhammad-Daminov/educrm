import { describe, expect, it } from 'vitest';
import { diffOf, snapshotOf } from '../src/audit/audit-diff';

describe('audit diff (TZ M11.3 diff JSONB)', () => {
  it('reports only the fields that changed', () => {
    const diff = diffOf(
      { name: 'Asosiy', code: 'MAIN', isActive: true },
      { name: 'Chilonzor', code: 'MAIN' },
    );

    expect(diff).toEqual({
      name: { before: 'Asosiy', after: 'Chilonzor' },
    });
  });

  it('ignores fields absent from the update rather than treating them as nulled', () => {
    expect(diffOf({ name: 'Asosiy', phone: '+998901234567' }, { name: 'Asosiy' })).toEqual({});
  });

  it('records a field appearing or being cleared', () => {
    expect(diffOf({}, { phone: '+998901234567' })).toEqual({
      phone: { before: null, after: '+998901234567' },
    });
    expect(diffOf({ phone: '+998901234567' }, { phone: null })).toEqual({
      phone: { before: '+998901234567', after: null },
    });
  });

  it('writes money bigints as tiyin strings, not numbers', () => {
    // JSON.stringify throws outright on bigint, so without this the audit
    // write would abort the very operation it documents — and "fixing" it
    // with Number() would silently round the amount.
    const diff = diffOf({ amount: 125_000_000n }, { amount: 130_000_000n });

    expect(diff).toEqual({
      amount: { before: '125000000', after: '130000000' },
    });
    expect(() => JSON.stringify(diff)).not.toThrow();
  });

  it('does not report a bigint as changed when it did not change', () => {
    expect(diffOf({ amount: 125_000_000n }, { amount: 125_000_000n })).toEqual({});
  });

  it('serializes dates as ISO strings and compares them by value', () => {
    expect(diffOf({ at: new Date('2026-10-09T10:00:00Z') }, { at: new Date('2026-10-09T10:00:00Z') })).toEqual(
      {},
    );
    expect(
      diffOf({ at: new Date('2026-10-09T10:00:00Z') }, { at: new Date('2026-10-10T10:00:00Z') }),
    ).toEqual({
      at: { before: '2026-10-09T10:00:00.000Z', after: '2026-10-10T10:00:00.000Z' },
    });
  });

  it('handles nested objects and arrays', () => {
    const diff = diffOf(
      { scopes: { 'branch.view': 'branch' }, branchIds: ['a', 'b'] },
      { scopes: { 'branch.view': 'all' }, branchIds: ['a', 'b'] },
    );

    expect(diff).toEqual({
      scopes: { before: { 'branch.view': 'branch' }, after: { 'branch.view': 'all' } },
    });
  });

  it('records that a secret changed without recording the secret', () => {
    const diff = diffOf({ passwordHash: '$argon2id$old' }, { passwordHash: '$argon2id$new' });

    expect(diff).toEqual({
      passwordHash: { before: '[redacted]', after: '[redacted]' },
    });
    expect(JSON.stringify(diff)).not.toContain('argon2id');
  });

  it('redacts secrets nested inside a changed field too', () => {
    const diff = diffOf(
      { session: { id: '1', tokenHash: 'old-hash' } },
      { session: { id: '2', tokenHash: 'new-hash' } },
    );

    expect(JSON.stringify(diff)).not.toContain('-hash');
    expect(diff.session).toEqual({
      before: { id: '1', tokenHash: '[redacted]' },
      after: { id: '2', tokenHash: '[redacted]' },
    });
  });

  it('leaves an unchanged secret out of the diff entirely', () => {
    expect(diffOf({ passwordHash: 'same' }, { passwordHash: 'same' })).toEqual({});
  });

  describe('snapshotOf', () => {
    it('captures a whole record JSONB-safely', () => {
      expect(
        snapshotOf({
          id: '01a1-x',
          amount: 50_000_000n,
          createdAt: new Date('2026-10-09T10:00:00Z'),
          isActive: true,
          note: null,
        }),
      ).toEqual({
        id: '01a1-x',
        amount: '50000000',
        createdAt: '2026-10-09T10:00:00.000Z',
        isActive: true,
        note: null,
      });
    });

    it('redacts secrets', () => {
      expect(snapshotOf({ id: '1', password_hash: '$argon2id$x' })).toEqual({
        id: '1',
        password_hash: '[redacted]',
      });
    });
  });
});
