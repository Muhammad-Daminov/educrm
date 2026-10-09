import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * TZ 7.1 "KERAK — worker ajratish": one code base, two processes. `api`
   * serves HTTP; `worker` runs the BullMQ consumers and the outbox relay
   * and listens on no port, so a heavy report can't affect API latency.
   */
  APP_ROLE: z.enum(['api', 'worker']).default('api'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  /** How often the worker looks for due outbox events (APP_ROLE=worker only). */
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  /** Events claimed per tenant per poll. */
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(1_000).default(50),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return result.data;
}
