// @ts-check
const base = require('./base');
const nextPlugin = require('@next/eslint-plugin-next');

/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  ...base,
  {
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
];
