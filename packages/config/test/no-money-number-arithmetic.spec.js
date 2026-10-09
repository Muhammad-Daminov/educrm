import path from 'node:path';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';
import rule from '../eslint/rules/no-money-number-arithmetic.js';

// ESLint's RuleTester drives the test runner itself; point it at vitest's.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.afterAll = afterAll;

/**
 * The rule is type-aware, so the fixture file has to be a real file inside
 * a real tsconfig — RuleTester swaps in each case's `code` as its contents.
 */
const FIXTURE = path.join(import.meta.dirname, 'fixtures/file.ts');

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      project: './tsconfig.fixtures.json',
      tsconfigRootDir: import.meta.dirname,
    },
  },
});

/** Stand-in for @educrm/shared's Money: the rule matches the type by name. */
const MONEY_DECL = `
declare class Money {
  readonly tiyin: bigint;
  add(other: Money): Money;
  format(): string;
}
declare const left: Money;
declare const right: Money;
`;

ruleTester.run('no-money-number-arithmetic', rule, {
  valid: [
    {
      name: 'bigint tiyin arithmetic — exactly what Money does internally',
      filename: FIXTURE,
      code: `
        declare const amount: bigint;
        declare const price: bigint;
        export const total = amount + price * 3n;
      `,
    },
    {
      name: 'Money methods instead of operators',
      filename: FIXTURE,
      code: `${MONEY_DECL}
        export const combined = left.add(right);
      `,
    },
    {
      name: 'arithmetic on numbers that are not money',
      filename: FIXTURE,
      code: `
        declare const attempts: number;
        declare const lessonCount: number;
        declare const rateLimit: number;
        export const next = attempts + 1;
        export const perLesson = lessonCount * 2;
        export const window = rateLimit - 1;
      `,
    },
    {
      name: 'counting money-named things is not money arithmetic',
      filename: FIXTURE,
      code: `
        declare const payments: { length: number }[];
        export const count = payments.length + 1;
      `,
    },
    {
      name: 'string concatenation for display',
      filename: FIXTURE,
      code: `
        declare const amount: string;
        export const label = 'Jami: ' + amount;
      `,
    },
    {
      name: 'formatting money for display',
      filename: FIXTURE,
      code: `${MONEY_DECL}
        export const label = left.format();
      `,
    },
    {
      name: 'comparisons are not arithmetic',
      filename: FIXTURE,
      code: `
        declare const balance: number;
        export const isDebt = balance < 0;
      `,
    },
  ],

  invalid: [
    {
      name: 'adding two money numbers',
      filename: FIXTURE,
      code: `
        declare const amount: number;
        declare const discount: number;
        export const total = amount - discount;
      `,
      errors: [
        { messageId: 'numberArithmetic', data: { name: 'amount' } },
        { messageId: 'numberArithmetic', data: { name: 'discount' } },
      ],
    },
    {
      name: 'scaling a price by a float factor',
      filename: FIXTURE,
      code: `
        declare const price: number;
        export const discounted = price * 0.85;
      `,
      errors: [{ messageId: 'numberArithmetic', data: { name: 'price' } }],
    },
    {
      name: 'money on a property',
      filename: FIXTURE,
      code: `
        declare const invoice: { amount: number; paid: number };
        export const remaining = invoice.amount - invoice.paid;
      `,
      errors: [{ messageId: 'numberArithmetic', data: { name: 'amount' } }],
    },
    {
      name: 'money returned from a call',
      filename: FIXTURE,
      code: `
        declare function getPrice(): number;
        export const doubled = getPrice() * 2;
      `,
      errors: [{ messageId: 'numberArithmetic', data: { name: 'getPrice' } }],
    },
    {
      name: 'snake_case money field',
      filename: FIXTURE,
      code: `
        declare const row: { total_amount: number };
        export const withTax = row.total_amount / 100;
      `,
      errors: [{ messageId: 'numberArithmetic', data: { name: 'total_amount' } }],
    },
    {
      name: 'compound assignment accumulating a balance',
      filename: FIXTURE,
      code: `
        declare let balance: number;
        declare const payment: number;
        export function apply(): number {
          balance += payment;
          return balance;
        }
      `,
      errors: [
        { messageId: 'numberArithmetic', data: { name: 'balance' } },
        { messageId: 'numberArithmetic', data: { name: 'payment' } },
      ],
    },
    {
      name: 'incrementing a money number',
      filename: FIXTURE,
      code: `
        declare let salary: number;
        export function raise(): void {
          salary++;
        }
      `,
      errors: [{ messageId: 'numberArithmetic', data: { name: 'salary' } }],
    },
    {
      name: 'negating a money number',
      filename: FIXTURE,
      code: `
        declare const refund: number;
        export const reversed = -refund;
      `,
      errors: [{ messageId: 'numberArithmetic', data: { name: 'refund' } }],
    },
    {
      name: 'operators on Money instances',
      filename: FIXTURE,
      code: `${MONEY_DECL}
        export const broken = left + right;
      `,
      errors: [
        { messageId: 'moneyArithmetic', data: { operator: '+' } },
        { messageId: 'moneyArithmetic', data: { operator: '+' } },
      ],
    },
    {
      name: 'subtracting Money objects',
      filename: FIXTURE,
      code: `${MONEY_DECL}
        export const broken = left.tiyin - (right as unknown as number);
      `,
      errors: [{ messageId: 'moneyArithmetic', data: { operator: '-' } }],
    },
    {
      name: 'converting tiyin to a float for display',
      filename: FIXTURE,
      code: `
        declare const amountTiyin: bigint;
        export const asNumber = Number(amountTiyin);
      `,
      errors: [
        { messageId: 'numberConversion', data: { converter: 'Number', name: 'amountTiyin' } },
      ],
    },
    {
      name: 'parseFloat on a money string',
      filename: FIXTURE,
      code: `
        declare const price: string;
        export const parsed = parseFloat(price);
      `,
      errors: [{ messageId: 'numberConversion', data: { converter: 'parseFloat', name: 'price' } }],
    },
    {
      name: 'Number() on a Money instance',
      filename: FIXTURE,
      code: `${MONEY_DECL}
        export const asNumber = Number(left);
      `,
      errors: [{ messageId: 'numberConversion' }],
    },
  ],
});

/**
 * Without a typed project the rule has no type information at all. It must
 * degrade to the name-based half rather than going silent — a file that
 * slips out of the type-aware config is exactly where a money bug would
 * hide.
 */
const untypedRuleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser },
});

untypedRuleTester.run('no-money-number-arithmetic (no type information)', rule, {
  valid: [
    {
      name: 'non-money names are still left alone',
      code: `const attempts = 1; const next = attempts + 1;`,
    },
  ],
  invalid: [
    {
      name: 'money names are still caught',
      code: `const balance = 1; const payment = 2; const left = balance - payment;`,
      errors: [
        { messageId: 'numberArithmetic', data: { name: 'balance' } },
        { messageId: 'numberArithmetic', data: { name: 'payment' } },
      ],
    },
  ],
});
