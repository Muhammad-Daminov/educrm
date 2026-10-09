import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // esbuild (vitest's default TS transform) doesn't emit TypeScript
  // decorator metadata (`emitDecoratorMetadata`), which NestJS's DI
  // container needs to resolve constructor params that rely on implicit
  // type-based injection (no explicit @Inject()). Swapping in SWC here
  // fixes that for tests that boot a real Nest app (see
  // test/integration/auth.spec.ts) — every other test is unaffected.
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    globals: false,
    // Integration tests spin up a real Postgres via Testcontainers.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
