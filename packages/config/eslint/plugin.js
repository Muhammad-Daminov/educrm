// @ts-check
'use strict';

const noMoneyNumberArithmetic = require('./rules/no-money-number-arithmetic');

/**
 * Project-local ESLint plugin. Rules live here rather than in a published
 * package because they encode this product's non-negotiables (TZ M6.1 money
 * handling) — see eslint/rules/* for the reasoning behind each one.
 */
module.exports = {
  rules: {
    'no-money-number-arithmetic': noMoneyNumberArithmetic,
  },
};
