import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirrors the `@/*` path alias in tsconfig.json so modules under test
  // resolve the same way Next resolves them.
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
  test: {
    environment: 'node',
    passWithNoTests: true,
  },
});
