import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const API_DIR = path.resolve(__dirname, '../..');
const INIT_SQL = path.join(REPO_ROOT, 'docker/postgres/init.sql');

export interface AuthTestApp {
  app: INestApplication;
  migratorUrl: string;
  appUserUrl: string;
  stop(): Promise<void>;
}

/**
 * Boots a real Nest application (full AppModule — guards, filters, auth
 * module, everything) against a throwaway Postgres + Redis, the same way
 * `main.ts` does (global prefix `api/v1`, `AllExceptionsFilter`). Used by
 * the auth integration tests, which need to exercise the actual HTTP
 * surface (login/refresh/logout/me, guards, CSRF) rather than unit-test
 * individual services.
 *
 * `ConfigModule.forRoot(...)` runs synchronously the moment `AppModule`'s
 * class decorator is evaluated — i.e. at module-IMPORT time, not when
 * `Test.createTestingModule` later compiles it. A static top-level
 * `import { AppModule } from '...'` would therefore read `process.env`
 * before this function ever sets the test container URLs below (import
 * statements are hoisted and evaluated before any of this function's
 * body runs). Both `AppModule` and `AllExceptionsFilter` are imported
 * dynamically, after the env vars are set, to avoid exactly that.
 */
export async function startAuthTestApp(): Promise<AuthTestApp> {
  const postgres: StartedTestContainer = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_USER: 'educrm', POSTGRES_PASSWORD: 'educrm', POSTGRES_DB: 'educrm' })
    .withExposedPorts(5432)
    .withCopyFilesToContainer([{ source: INIT_SQL, target: '/docker-entrypoint-initdb.d/01-init.sql' }])
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  const redis: StartedTestContainer = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();

  const pgHost = postgres.getHost();
  const pgPort = postgres.getMappedPort(5432);
  const migratorUrl = `postgresql://migrator:migrator_dev_pw@${pgHost}:${pgPort}/educrm`;
  const appUserUrl = `postgresql://app_user:app_user_dev_pw@${pgHost}:${pgPort}/educrm`;

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: migratorUrl, DATABASE_MIGRATION_URL: migratorUrl },
    stdio: 'pipe',
  });

  process.env.DATABASE_URL = appUserUrl;
  process.env.DATABASE_MIGRATION_URL = migratorUrl;
  process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  process.env.JWT_SECRET = 'test-only-jwt-secret-at-least-32-characters-long';
  process.env.NODE_ENV = 'test';

  const { AppModule } = await import('../../src/app.module');
  const { AllExceptionsFilter } = await import('../../src/common/filters/all-exceptions.filter');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix('api/v1');
  await app.init();

  return {
    app,
    migratorUrl,
    appUserUrl,
    stop: async () => {
      await app.close();
      await redis.stop();
      await postgres.stop();
    },
  };
}
