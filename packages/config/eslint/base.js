// @ts-check
const tseslint = require('typescript-eslint');
const eslint = require('@eslint/js');
const educrm = require('./plugin');

/** @type {import("eslint").Linter.Config[]} */
module.exports = tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      educrm,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // TZ M6.1.5 — money arithmetic in `number` is banned outright.
      'educrm/no-money-number-arithmetic': 'error',
    },
  },
  {
    ignores: [
      'dist/**',
      '.next/**',
      'node_modules/**',
      '*.config.js',
      '*.config.cjs',
      '*.config.mjs',
      'next-env.d.ts',
    ],
  },
);
