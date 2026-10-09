import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const API_DIR = path.resolve(__dirname, '../..');
const INIT_SQL = path.join(REPO_ROOT, 'docker/postgres/init.sql');

export interface WorkerTestApp {
  app: INestApplication;
  migratorUrl: string;
  appUserUrl: string;
  stop(): Promise<void>;
}

/**
 * Boots the real AppModule with APP_ROLE=worker against throwaway Postgres
 * and Redis — i.e. the process `pnpm start:worker` starts, minus the HTTP
 * server. Lifecycle hooks run (`app.init()`), so the BullMQ worker and the
 * outbox dispatcher really connect to Redis.
 *
 * As in auth-setup.ts, AppModule is imported *dynamically*: its
 * `ConfigModule.forRoot()` reads process.env while the class decorator is
 * evaluated at import time, which is before this function's body would get
 * a chance to point it at the containers.
 */
export async function startWorkerTestApp(): Promise<WorkerTestApp> {
  const postgres: StartedTestContainer = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_USER: 'educrm', POSTGRES_PASSWORD: 'educrm', POSTGRES_DB: 'educrm' })
    .withExposedPorts(5432)
    .withCopyFilesToContainer([
      { source: INIT_SQL, target: '/docker-entrypoint-initdb.d/01-init.sql' },
    ])
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

  process.env.APP_ROLE = 'worker';
  process.env.DATABASE_URL = appUserUrl;
  process.env.DATABASE_MIGRATION_URL = migratorUrl;
  process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  process.env.JWT_SECRET = 'test-only-jwt-secret-at-least-32-characters-long';
  process.env.NODE_ENV = 'test';
  // The test drives dispatcher.tick() itself; a background interval racing
  // it would make "how many events did this tick dispatch" meaningless.
  process.env.OUTBOX_POLL_INTERVAL_MS = '3600000';

  const { AppModule } = await import('../../src/app.module');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  return {
    app,
    migratorUrl,
    appUserUrl,
    stop: async () => {
      await app.close();
      await redis.stop();
      await postgres.stop();
      delete process.env.APP_ROLE;
    },
  };
}
