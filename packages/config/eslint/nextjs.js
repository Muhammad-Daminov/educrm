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
      // A cast through `unknown` defeats the type checker rather than
      // fixing the underlying type mismatch — see CLAUDE.md T05 follow-up.
      // Fix the generic/type instead of widening to `unknown` and back.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "TSAsExpression[typeAnnotation.type!='TSUnknownKeyword'] > TSAsExpression[typeAnnotation.type='TSUnknownKeyword']",
          message:
            "Don't cast through `unknown` (`as unknown as T`). Fix the type instead — see CLAUDE.md.",
        },
      ],
    },
  },
];
