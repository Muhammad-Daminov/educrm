import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const API_DIR = path.resolve(__dirname, '../..');
const INIT_SQL = path.join(REPO_ROOT, 'docker/postgres/init.sql');

export interface TestDatabase {
  host: string;
  port: number;
  /** migrator role, direct connection — owns the schema, ran the migrations */
  migratorUrl: string;
  /** app_user role, direct connection — what the running API connects as (minus PgBouncer, irrelevant to RLS correctness) */
  appUserUrl: string;
  stop(): Promise<void>;
}

/**
 * Spins up a throwaway Postgres 16 container seeded with the exact same
 * `docker/postgres/init.sql` used in docker-compose (so `migrator`/`app_user`
 * roles and grants match production exactly), then applies our real Prisma
 * migrations against it as `migrator` via the real `prisma migrate deploy`
 * CLI path — not a hand-rolled SQL runner — so these tests prove the actual
 * migration files work, not just a copy of their intent.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedTestContainer = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_USER: 'educrm',
      POSTGRES_PASSWORD: 'educrm',
      POSTGRES_DB: 'educrm',
    })
    .withExposedPorts(5432)
    .withCopyFilesToContainer([{ source: INIT_SQL, target: '/docker-entrypoint-initdb.d/01-init.sql' }])
    // Postgres restarts once after running init scripts, so the "ready" line appears twice.
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const migratorUrl = `postgresql://migrator:migrator_dev_pw@${host}:${port}/educrm`;
  const appUserUrl = `postgresql://app_user:app_user_dev_pw@${host}:${port}/educrm`;

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      DATABASE_URL: migratorUrl,
      DATABASE_MIGRATION_URL: migratorUrl,
    },
    stdio: 'pipe',
  });

  return {
    host,
    port,
    migratorUrl,
    appUserUrl,
    stop: async () => {
      await container.stop();
    },
  };
}
