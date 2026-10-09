/**
 * Money value object — the single place any money arithmetic may happen
 * (TZ M6.1.5, TZ 7.3 pattern 6).
 *
 * Invariants taken straight from TZ M6.1, none of them negotiable:
 *  1. Amounts are integer *tiyin* held in a `bigint`. No float ever touches
 *     a money value: `number` has 53 bits of mantissa and binary fractions
 *     can't represent 0.01, so `number` arithmetic silently loses tiyin.
 *     Postgres stores these as BIGINT and Prisma hands them back as bigint,
 *     so there is no conversion step on either end.
 *  2. Currency lives on the value (ISO 4217, UZS for now). Mixed-currency
 *     arithmetic throws rather than quietly adding unrelated numbers.
 *  3. Rounding happens on *display* only. The one internal exception is
 *     `mulRatio`, where a ratio genuinely cannot divide evenly — it rounds
 *     half away from zero and says so.
 *  4. Splitting is exact: `allocate` hands the division remainder to the
 *     last part, so the parts always sum back to the original (TZ M6.1.3).
 *
 * `number` arithmetic on money is additionally banned by the
 * `educrm/no-money-number-arithmetic` lint rule (TZ M6.1.5), which also
 * rejects `+`/`-`/`*` applied to a `Money` instance — use these methods.
 */

export type CurrencyCode = 'UZS';

export const DEFAULT_CURRENCY: CurrencyCode = 'UZS';

/** Suffix shown after the amount, per UX §7 ("valyuta oxirida"). */
const CURRENCY_SUFFIX: Record<CurrencyCode, string> = {
  UZS: "so'm",
};

const TIYIN_PER_UNIT = 100n;
const GROUP_SIZE = 3;

/** UX §7: thousands separator is a space, decimal separator a comma. */
const GROUP_SEPARATOR = ' ';
const DECIMAL_SEPARATOR = ',';

function assertSameCurrency(left: Money, right: Money): void {
  // Widened to `string` on purpose: `CurrencyCode` has a single member
  // today, so comparing two of them narrows both sides to `never` inside
  // the branch and the message can't be built. Widening keeps the guard
  // (and this error text) working unchanged once a second currency exists.
  const leftCurrency: string = left.currency;
  const rightCurrency: string = right.currency;
  if (leftCurrency !== rightCurrency) {
    throw new Error(`Money: refusing to combine ${leftCurrency} with ${rightCurrency}`);
  }
}

/**
 * Groups the integer part in threes: 1250000 -> "1 250 000".
 */
function groupDigits(digits: string): string {
  let grouped = '';
  for (let i = digits.length; i > 0; i -= GROUP_SIZE) {
    const start = Math.max(0, i - GROUP_SIZE);
    const chunk = digits.slice(start, i);
    grouped = grouped === '' ? chunk : `${chunk}${GROUP_SEPARATOR}${grouped}`;
  }
  return grouped === '' ? '0' : grouped;
}

export class Money {
  private constructor(
    readonly tiyin: bigint,
    readonly currency: CurrencyCode,
  ) {}

  static zero(currency: CurrencyCode = DEFAULT_CURRENCY): Money {
    return new Money(0n, currency);
  }

  /**
   * The only constructor. `string` is accepted because that's how money
   * crosses the API boundary (TZ 6.1: `"amount": "50000000"`, tiyin as a
   * string so no JSON parser can round it). `number` is deliberately NOT
   * accepted — if a caller has a `number`, that's exactly the bug this
   * class exists to prevent.
   */
  static fromTiyin(value: bigint | string, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
    if (typeof value === 'string') {
      if (!/^-?\d+$/.test(value)) {
        throw new Error(`Money.fromTiyin: "${value}" is not an integer tiyin amount`);
      }
      return new Money(BigInt(value), currency);
    }
    return new Money(value, currency);
  }

  /** Convenience for whole-so'm literals in seeds, prices and tests. */
  static fromSom(som: bigint, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
    return new Money(som * TIYIN_PER_UNIT, currency);
  }

  static sum(values: readonly Money[], currency: CurrencyCode = DEFAULT_CURRENCY): Money {
    return values.reduce<Money>((acc, value) => acc.add(value), Money.zero(currency));
  }

  add(other: Money): Money {
    assertSameCurrency(this, other);
    return new Money(this.tiyin + other.tiyin, this.currency);
  }

  subtract(other: Money): Money {
    assertSameCurrency(this, other);
    return new Money(this.tiyin - other.tiyin, this.currency);
  }

  /**
   * Multiplies by the ratio `numerator / denominator` — the shape every
   * real money scaling takes: monthly pro-rata (attended / planned lessons,
   * TZ M6.2), a percent discount (`mulRatio(15n, 100n)`), an excused-absence
   * charge at 50% (TZ M6.6). Taking the ratio as two integers instead of a
   * `number` factor keeps the input exact: `0.15` is not representable in
   * binary, `15n/100n` is.
   *
   * Rounds half away from zero when the division isn't exact, so 50 tiyin
   * rounds up to 1 and -50 down to -1 (symmetric — no sign-dependent bias
   * in refunds). Exact divisions are never touched. When the parts must
   * sum back to a known total, use `allocate` instead: it's exact by
   * construction, this is not.
   */
  mulRatio(numerator: bigint, denominator: bigint): Money {
    if (denominator === 0n) {
      throw new Error('Money.mulRatio: denominator must not be zero');
    }
    const scaled = this.tiyin * numerator;
    // Normalize the sign onto the numerator so the half-up adjustment below
    // doesn't have to care which of the two operands was negative.
    const negative = scaled < 0n !== denominator < 0n;
    const absScaled = scaled < 0n ? -scaled : scaled;
    const absDenominator = denominator < 0n ? -denominator : denominator;

    const quotient = absScaled / absDenominator;
    const remainder = absScaled % absDenominator;
    // Half away from zero: round up when the remainder is >= half the
    // denominator. Compared doubled to stay in integers.
    const rounded = remainder * 2n >= absDenominator ? quotient + 1n : quotient;

    return new Money(negative ? -rounded : rounded, this.currency);
  }

  /**
   * Splits into parts proportional to `weights`, with the division
   * remainder added to the **last** part so `sum(parts) === this` exactly
   * (TZ M6.1.3: "qoldiq oxirgi yozuvga qo'shiladi — yig'indi har doim
   * aniq"). Used for package prices spread over lessons, and for applying
   * a payment across several charges.
   *
   * Note this is deliberately *not* largest-remainder apportionment, which
   * would spread the remainder more evenly but leaves no single row that
   * provably reconciles the total. TZ picks exactness at the last row.
   */
  allocate(weights: readonly bigint[]): Money[] {
    if (weights.length === 0) {
      throw new Error('Money.allocate: needs at least one weight');
    }
    if (weights.some((weight) => weight < 0n)) {
      throw new Error('Money.allocate: weights must not be negative');
    }
    const totalWeight = weights.reduce((acc, weight) => acc + weight, 0n);
    if (totalWeight === 0n) {
      throw new Error('Money.allocate: weights must not all be zero');
    }

    const parts: Money[] = [];
    let allocated = 0n;
    // Every part but the last is truncated toward zero; the last one is
    // whatever is left, which is what makes the sum exact.
    for (let i = 0; i < weights.length - 1; i += 1) {
      const weight = weights[i] ?? 0n;
      const part = (this.tiyin * weight) / totalWeight;
      allocated += part;
      parts.push(new Money(part, this.currency));
    }
    parts.push(new Money(this.tiyin - allocated, this.currency));

    return parts;
  }

  /** Equal split into `parts` pieces; the remainder lands on the last one. */
  allocateEvenly(parts: number): Money[] {
    if (!Number.isInteger(parts) || parts < 1) {
      throw new Error('Money.allocateEvenly: parts must be a positive integer');
    }
    return this.allocate(Array.from({ length: parts }, () => 1n));
  }

  negate(): Money {
    return new Money(-this.tiyin, this.currency);
  }

  abs(): Money {
    return this.tiyin < 0n ? this.negate() : this;
  }

  /** -1, 0 or 1 — for sorting and for `<`/`>` comparisons without operators. */
  compare(other: Money): number {
    assertSameCurrency(this, other);
    if (this.tiyin === other.tiyin) {
      return 0;
    }
    return this.tiyin < other.tiyin ? -1 : 1;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.tiyin === other.tiyin;
  }

  isZero(): boolean {
    return this.tiyin === 0n;
  }

  isNegative(): boolean {
    return this.tiyin < 0n;
  }

  isPositive(): boolean {
    return this.tiyin > 0n;
  }

  /**
   * Display form per UX §7: space-grouped thousands, currency last, tiyin
   * shown only when non-zero ("Tiyin faqat kerak bo'lsa"). Negative amounts
   * keep a plain minus sign — the "qarz" wording and the colour that UX §7
   * also asks for are the caller's job, since they're UI concerns and need
   * an i18n key.
   */
  format(): string {
    const negative = this.tiyin < 0n;
    const absTiyin = negative ? -this.tiyin : this.tiyin;
    const units = absTiyin / TIYIN_PER_UNIT;
    const fraction = absTiyin % TIYIN_PER_UNIT;

    const amount = groupDigits(units.toString());
    const withFraction =
      fraction === 0n
        ? amount
        : `${amount}${DECIMAL_SEPARATOR}${fraction.toString().padStart(2, '0')}`;

    return `${negative ? '-' : ''}${withFraction} ${CURRENCY_SUFFIX[this.currency]}`;
  }

  /**
   * Wire format (TZ 6.1): tiyin as a decimal string, never a JSON number —
   * amounts above 2^53 tiyin would lose precision in any JSON parser, and
   * the string form makes the unit unambiguous at the boundary.
   */
  toJSON(): string {
    return this.tiyin.toString();
  }

  toString(): string {
    return this.format();
  }
}
