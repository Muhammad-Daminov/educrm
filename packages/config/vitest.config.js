import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.js'],
    // ESLint's RuleTester registers its cases through describe/it, which it
    // reads off `RuleTester.describe`/`.it` — the spec assigns vitest's.
    globals: false,
  },
});
