// @ts-check
'use strict';

/**
 * TZ M6.1.5: "Barcha pul hisob-kitobi bitta Money value object orqali
 * (TypeScript bigint); number bilan pul arifmetikasi lint qoidasi bilan
 * taqiqlanadi."
 *
 * This rule is that lint rule. It bans three things:
 *
 *  1. Arithmetic (`+ - * / % **`, their compound assignments, `++`/`--`,
 *     unary `-`) where an operand is a `number` *and* its name looks like
 *     money (`amount`, `price`, `balance`, `discount`, ...). A `number`
 *     holding money is the bug itself — 53 bits of binary mantissa cannot
 *     represent 0.01, so the tiyin drift is silent and unrecoverable once
 *     it's in the ledger.
 *  2. The same operators applied to a `Money` instance. They don't do
 *     anything useful (`money1 + money2` stringifies via toString), and
 *     allowing them would hide the currency check that `.add()` performs.
 *  3. Converting a money-named value to `number` via `Number()`,
 *     `parseInt()` or `parseFloat()` — the usual way a correct `bigint`
 *     amount gets quietly downgraded on its way to a chart or a UI label.
 *     Use `Money.format()` for display.
 *
 * `bigint` arithmetic is left alone: tiyin math in `bigint` is exactly what
 * the Money value object does internally, and it's exact.
 *
 * Deliberate limitation: "is this Money?" is decided by the type's symbol
 * name being `Money`, not by identity with the class in `@educrm/shared`.
 * Checking identity would make this rule depend on resolving that package
 * from every linted project; the name match is good enough, and an
 * unrelated class called `Money` in this codebase would be a naming problem
 * of its own.
 */

/**
 * Name fragments that mark a value as money. Matched per *word* after
 * splitting camelCase / snake_case, so `rateLimit` is not caught by `rate`
 * and `consumer` is not caught by `sum`.
 */
const MONEY_WORDS = new Set([
  'amount',
  'amounts',
  'balance',
  'balances',
  'charge',
  'charges',
  'cost',
  'costs',
  'credit',
  'debit',
  'debt',
  'debts',
  'discount',
  'discounts',
  'fee',
  'fees',
  'money',
  'payment',
  'payments',
  'payroll',
  'price',
  'prices',
  'refund',
  'refunds',
  'salary',
  'som',
  'subtotal',
  'tiyin',
  'total',
  'totals',
]);

const ARITHMETIC_OPERATORS = new Set(['+', '-', '*', '/', '%', '**']);
const ARITHMETIC_ASSIGNMENTS = new Set(['+=', '-=', '*=', '/=', '%=', '**=']);
const NUMBER_CONVERTERS = new Set(['Number', 'parseInt', 'parseFloat']);

/** camelCase / snake_case / kebab -> lowercase words. */
function words(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+|\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function looksLikeMoney(name) {
  return name !== undefined && words(name).some((word) => MONEY_WORDS.has(word));
}

/** Strips the wrappers that don't change what an expression refers to. */
function unwrap(node) {
  let current = node;
  while (
    current &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'ChainExpression')
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * The name to judge an operand by: the identifier itself, the property for
 * `invoice.amount`, or the callee for `getPrice()`.
 */
function nameOf(node) {
  const target = unwrap(node);
  if (!target) {
    return undefined;
  }
  switch (target.type) {
    case 'Identifier':
      return target.name;
    case 'PrivateIdentifier':
      return target.name;
    case 'MemberExpression':
      return target.computed ? undefined : nameOf(target.property);
    case 'CallExpression':
      return nameOf(target.callee);
    default:
      return undefined;
  }
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid number arithmetic on money values and operator arithmetic on Money instances (TZ M6.1.5).',
    },
    schema: [],
    messages: {
      numberArithmetic:
        "`{{name}}` looks like a money value but is a `number`. Money is BIGINT tiyin and all of its arithmetic goes through the Money value object (TZ M6.1) — `number` loses tiyin silently.",
      moneyArithmetic:
        '`{{operator}}` is not defined for Money. Use .add(), .subtract(), .mulRatio() or .allocate() so the currency check and exact tiyin arithmetic still apply.',
      numberConversion:
        '`{{converter}}()` on money value `{{name}}` downgrades exact tiyin to a float. Use Money.format() to display it, or keep the bigint.',
    },
  },

  create(context) {
    const services = context.sourceCode.parserServices;
    const checker =
      services && services.program && services.esTreeNodeToTSNodeMap
        ? services.program.getTypeChecker()
        : undefined;

    /** Every constituent of a union, or the type itself. */
    function constituents(type) {
      return type.isUnion && type.isUnion() ? type.types : [type];
    }

    function typeOf(node) {
      if (!checker || !services) {
        return undefined;
      }
      const tsNode = services.esTreeNodeToTSNodeMap.get(node);
      return tsNode ? checker.getTypeAtLocation(tsNode) : undefined;
    }

    /**
     * Classifies an operand. With no type information available (a plain
     * JS file, or a project not configured for type-aware linting) `number`
     * is assumed, so the name-based half of the rule still works.
     */
    function classify(node) {
      const type = typeOf(unwrap(node));
      if (!type) {
        return { isNumber: true, isBigInt: false, isMoney: false, isString: false };
      }

      let isNumber = false;
      let isBigInt = false;
      let isMoney = false;
      let isString = false;

      for (const part of constituents(type)) {
        const name = part.getSymbol() ? part.getSymbol().getName() : undefined;
        if (name === 'Money') {
          isMoney = true;
          continue;
        }
        // ts.TypeFlags, inlined so this rule needs no typescript import:
        // String 4 | StringLiteral 128 | Number 8 | NumberLiteral 256 |
        // BigInt 64 | BigIntLiteral 2048 | Any 1 | Unknown 2
        const flags = part.flags;
        if ((flags & (8 | 256)) !== 0) {
          isNumber = true;
        }
        if ((flags & (64 | 2048)) !== 0) {
          isBigInt = true;
        }
        if ((flags & (4 | 128)) !== 0) {
          isString = true;
        }
        if ((flags & (1 | 2)) !== 0) {
          // `any`/`unknown` tells us nothing — fall back to the name.
          isNumber = true;
        }
      }

      return { isNumber, isBigInt, isMoney, isString };
    }

    function checkOperand(node, operator, otherKind) {
      const kind = classify(node);

      if (kind.isMoney) {
        context.report({ node, messageId: 'moneyArithmetic', data: { operator } });
        return;
      }
      // `+` between strings is concatenation, not money arithmetic.
      if (operator === '+' && (kind.isString || (otherKind && otherKind.isString))) {
        return;
      }
      if (kind.isBigInt && !kind.isNumber) {
        return;
      }
      const name = nameOf(node);
      if (kind.isNumber && looksLikeMoney(name)) {
        context.report({ node, messageId: 'numberArithmetic', data: { name } });
      }
    }

    return {
      BinaryExpression(node) {
        if (!ARITHMETIC_OPERATORS.has(node.operator) || node.left.type === 'PrivateIdentifier') {
          return;
        }
        const leftKind = classify(node.left);
        const rightKind = classify(node.right);
        checkOperand(node.left, node.operator, rightKind);
        checkOperand(node.right, node.operator, leftKind);
      },

      AssignmentExpression(node) {
        if (!ARITHMETIC_ASSIGNMENTS.has(node.operator)) {
          return;
        }
        const rightKind = classify(node.right);
        checkOperand(node.left, node.operator, rightKind);
        checkOperand(node.right, node.operator, classify(node.left));
      },

      UnaryExpression(node) {
        if (node.operator !== '-' && node.operator !== '+') {
          return;
        }
        checkOperand(node.argument, node.operator, undefined);
      },

      UpdateExpression(node) {
        checkOperand(node.argument, node.operator, undefined);
      },

      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (!callee || callee.type !== 'Identifier' || !NUMBER_CONVERTERS.has(callee.name)) {
          return;
        }
        const [argument] = node.arguments;
        if (!argument) {
          return;
        }
        const name = nameOf(argument);
        if (looksLikeMoney(name) || classify(argument).isMoney) {
          context.report({
            node,
            messageId: 'numberConversion',
            data: { converter: callee.name, name: name ?? 'money' },
          });
        }
      },
    };
  },
};
