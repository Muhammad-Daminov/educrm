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
    // CLAUDE.md "Resource limits": this repo is developed on a low-RAM
    // laptop, and vitest defaults to one worker per CPU core. Capping the
    // pool keeps a full run from exhausting memory.
    maxWorkers: 2,
    minWorkers: 1,
  },
});
