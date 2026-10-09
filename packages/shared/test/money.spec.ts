import { describe, expect, it } from 'vitest';
import { Money } from '../src/money';

describe('Money', () => {
  describe('construction', () => {
    it('accepts tiyin as bigint and as the TZ 6.1 wire string', () => {
      expect(Money.fromTiyin(125_000_000n).tiyin).toBe(125_000_000n);
      expect(Money.fromTiyin('125000000').tiyin).toBe(125_000_000n);
      expect(Money.fromTiyin('-450000').tiyin).toBe(-450_000n);
    });

    it('rejects a non-integer wire string instead of silently truncating', () => {
      expect(() => Money.fromTiyin('1250.50')).toThrow(/not an integer tiyin/);
      expect(() => Money.fromTiyin('1 250')).toThrow(/not an integer tiyin/);
      expect(() => Money.fromTiyin('')).toThrow(/not an integer tiyin/);
    });

    it('converts whole so\'m to tiyin', () => {
      expect(Money.fromSom(1_250_000n).tiyin).toBe(125_000_000n);
    });
  });

  describe('add / subtract', () => {
    it('is exact over amounts a float would mangle', () => {
      // 0.01 soʻm steps: the classic case where number arithmetic drifts.
      const cents = Array.from({ length: 300 }, () => Money.fromTiyin(1n));
      expect(Money.sum(cents).tiyin).toBe(300n);
    });

    it('subtracts past zero into a debt', () => {
      const balance = Money.fromSom(100_000n).subtract(Money.fromSom(550_000n));
      expect(balance.tiyin).toBe(-45_000_000n);
      expect(balance.isNegative()).toBe(true);
    });

    it('refuses to combine different currencies', () => {
      const uzs = Money.fromSom(1n);
      // Cast is the only way to build a foreign-currency value today (UZS is
      // the sole CurrencyCode) — the guard has to exist before a second
      // currency does, not after.
      const usd = Money.fromTiyin(1n, 'USD' as 'UZS');
      expect(() => uzs.add(usd)).toThrow(/refusing to combine/);
      expect(() => uzs.subtract(usd)).toThrow(/refusing to combine/);
      expect(() => uzs.compare(usd)).toThrow(/refusing to combine/);
      expect(uzs.equals(usd)).toBe(false);
    });
  });

  describe('mulRatio', () => {
    it('is exact when the ratio divides evenly', () => {
      // 15% of 1 200 000 soʻm = 180 000 soʻm, no rounding involved.
      expect(Money.fromSom(1_200_000n).mulRatio(15n, 100n).tiyin).toBe(18_000_000n);
    });

    it('scales monthly price by attended/planned lessons (TZ M6.2 pro-rata)', () => {
      // 400 000 soʻm month, student joined after 5 of 12 lessons.
      const prorated = Money.fromSom(400_000n).mulRatio(7n, 12n);
      expect(prorated.format()).toBe("233 333,33 soʻm");
    });

    it('rounds half away from zero, symmetrically for refunds', () => {
      // 5 tiyin / 2 = 2.5 -> 3; the negative mirrors it instead of
      // drifting toward zero, so a charge and its refund cancel out.
      expect(Money.fromTiyin(5n).mulRatio(1n, 2n).tiyin).toBe(3n);
      expect(Money.fromTiyin(-5n).mulRatio(1n, 2n).tiyin).toBe(-3n);
      expect(Money.fromTiyin(5n).mulRatio(-1n, 2n).tiyin).toBe(-3n);
      expect(Money.fromTiyin(5n).mulRatio(1n, -2n).tiyin).toBe(-3n);
      // Just below half stays down.
      expect(Money.fromTiyin(4n).mulRatio(1n, 3n).tiyin).toBe(1n);
    });

    it('rejects a zero denominator', () => {
      expect(() => Money.fromSom(1n).mulRatio(1n, 0n)).toThrow(/denominator/);
    });
  });

  describe('allocate', () => {
    it('gives the remainder to the last part and sums back exactly', () => {
      // 100 000 soʻm package over 3 lessons: 33 333,33 / 33 333,33 / 33 333,34
      const parts = Money.fromSom(100_000n).allocateEvenly(3);
      expect(parts.map((part) => part.tiyin)).toEqual([3_333_333n, 3_333_333n, 3_333_334n]);
      expect(Money.sum(parts).tiyin).toBe(10_000_000n);
    });

    it('splits by weights', () => {
      const parts = Money.fromTiyin(100n).allocate([1n, 1n, 2n]);
      expect(parts.map((part) => part.tiyin)).toEqual([25n, 25n, 50n]);
    });

    it('stays exact for a negative total', () => {
      const parts = Money.fromTiyin(-100n).allocateEvenly(3);
      expect(parts.map((part) => part.tiyin)).toEqual([-33n, -33n, -34n]);
      expect(Money.sum(parts).tiyin).toBe(-100n);
    });

    it('tolerates zero weights without losing tiyin', () => {
      const parts = Money.fromTiyin(10n).allocate([0n, 1n, 0n]);
      expect(parts.map((part) => part.tiyin)).toEqual([0n, 10n, 0n]);
      expect(Money.sum(parts).tiyin).toBe(10n);
    });

    it('sums back exactly for every split of every amount in a wide range', () => {
      for (let amount = -500n; amount <= 500n; amount += 1n) {
        for (let parts = 1; parts <= 9; parts += 1) {
          const allocated = Money.fromTiyin(amount).allocateEvenly(parts);
          expect(allocated).toHaveLength(parts);
          expect(Money.sum(allocated).tiyin).toBe(amount);
        }
      }
    });

    it('rejects inputs that cannot produce an exact split', () => {
      expect(() => Money.fromTiyin(10n).allocate([])).toThrow(/at least one weight/);
      expect(() => Money.fromTiyin(10n).allocate([1n, -1n])).toThrow(/not be negative/);
      expect(() => Money.fromTiyin(10n).allocate([0n, 0n])).toThrow(/not all be zero/);
      expect(() => Money.fromTiyin(10n).allocateEvenly(0)).toThrow(/positive integer/);
      expect(() => Money.fromTiyin(10n).allocateEvenly(1.5)).toThrow(/positive integer/);
    });
  });

  describe('format (UX §7)', () => {
    it('groups thousands with spaces and puts the currency last', () => {
      expect(Money.fromSom(1_250_000n).format()).toBe("1 250 000 soʻm");
      expect(Money.fromSom(1n).format()).toBe("1 soʻm");
      expect(Money.fromSom(999n).format()).toBe("999 soʻm");
      expect(Money.fromSom(1_000n).format()).toBe("1 000 soʻm");
      expect(Money.zero().format()).toBe("0 soʻm");
    });

    it('shows tiyin only when non-zero', () => {
      expect(Money.fromTiyin(125_000_050n).format()).toBe("1 250 000,50 soʻm");
      expect(Money.fromTiyin(125_000_005n).format()).toBe("1 250 000,05 soʻm");
      expect(Money.fromTiyin(125_000_000n).format()).toBe("1 250 000 soʻm");
    });

    it('prefixes a debt with a minus sign', () => {
      expect(Money.fromSom(-450_000n).format()).toBe("-450 000 soʻm");
      expect(Money.fromTiyin(-5n).format()).toBe("-0,05 soʻm");
    });

    it('is what toString() renders', () => {
      expect(String(Money.fromSom(1_250_000n))).toBe("1 250 000 soʻm");
    });
  });

  it('serializes as a tiyin string, never a JSON number (TZ 6.1)', () => {
    expect(JSON.stringify({ amount: Money.fromSom(500_000n) })).toBe('{"amount":"50000000"}');
    // Beyond Number.MAX_SAFE_INTEGER: a JSON number would round here.
    const huge = Money.fromTiyin('9007199254740993');
    expect(JSON.parse(JSON.stringify({ amount: huge })) as { amount: string }).toEqual({
      amount: '9007199254740993',
    });
  });

  describe('comparison helpers', () => {
    it('orders amounts without exposing operators', () => {
      const small = Money.fromSom(100n);
      const large = Money.fromSom(200n);
      expect(small.compare(large)).toBe(-1);
      expect(large.compare(small)).toBe(1);
      expect(small.compare(Money.fromSom(100n))).toBe(0);
      expect([large, small].sort((a, b) => a.compare(b))).toEqual([small, large]);
    });

    it('reports sign and equality', () => {
      expect(Money.zero().isZero()).toBe(true);
      expect(Money.fromSom(-1n).isNegative()).toBe(true);
      expect(Money.fromSom(1n).isPositive()).toBe(true);
      expect(Money.fromSom(-1n).abs().format()).toBe("1 soʻm");
      expect(Money.fromSom(1n).abs().format()).toBe("1 soʻm");
      expect(Money.fromSom(1n).negate().tiyin).toBe(-100n);
      expect(Money.fromSom(1n).equals(Money.fromTiyin(100n))).toBe(true);
    });
  });
});
