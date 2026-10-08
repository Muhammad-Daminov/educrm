import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  GenericContainer,
  Network,
  Wait,
  type StartedNetwork,
  type StartedTestContainer,
} from 'testcontainers';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const API_DIR = path.resolve(__dirname, '../..');
const INIT_SQL = path.join(REPO_ROOT, 'docker/postgres/init.sql');

const POSTGRES_ALIAS = 'postgres';
const POSTGRES_CONTAINER_PORT = 5432;
const PGBOUNCER_CONTAINER_PORT = 5432;

export interface TestDatabaseWithPgBouncer {
  /** migrator, direct to Postgres, bypassing PgBouncer — for seeding fixtures */
  migratorUrl: string;
  /** app_user, through PgBouncer, transaction pool mode — what the running API uses */
  appUserUrl: string;
  /** app_user, through PgBouncer, no pgbouncer=true param — for raw `pg` probes */
  appUserRawUrl: string;
  stop(): Promise<void>;
}

/**
 * Same as `startTestDatabase`, but puts a real PgBouncer (transaction pool
 * mode) in front of Postgres, on a shared Docker network, exactly mirroring
 * docker-compose.yml. Proves the RLS set_config pattern is actually safe
 * under connection pooling, not just under Prisma's own pool.
 */
export async function startTestDatabaseWithPgBouncer(): Promise<TestDatabaseWithPgBouncer> {
  const network: StartedNetwork = await new Network().start();

  const postgres: StartedTestContainer = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_USER: 'educrm',
      POSTGRES_PASSWORD: 'educrm',
      POSTGRES_DB: 'educrm',
    })
    .withExposedPorts(POSTGRES_CONTAINER_PORT)
    .withCopyFilesToContainer([{ source: INIT_SQL, target: '/docker-entrypoint-initdb.d/01-init.sql' }])
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withNetwork(network)
    .withNetworkAliases(POSTGRES_ALIAS)
    .start();

  const migratorUrl = `postgresql://migrator:migrator_dev_pw@${postgres.getHost()}:${postgres.getMappedPort(POSTGRES_CONTAINER_PORT)}/educrm`;

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      DATABASE_URL: migratorUrl,
      DATABASE_MIGRATION_URL: migratorUrl,
    },
    stdio: 'pipe',
  });

  const pgbouncer: StartedTestContainer = await new GenericContainer('edoburu/pgbouncer:latest')
    .withEnvironment({
      DATABASE_URL: `postgres://app_user:app_user_dev_pw@${POSTGRES_ALIAS}:${POSTGRES_CONTAINER_PORT}/educrm`,
      POOL_MODE: 'transaction',
      AUTH_TYPE: 'scram-sha-256',
      MAX_CLIENT_CONN: '100',
      DEFAULT_POOL_SIZE: '20',
    })
    .withExposedPorts(PGBOUNCER_CONTAINER_PORT)
    .withWaitStrategy(Wait.forListeningPorts())
    .withNetwork(network)
    .start();

  const host = pgbouncer.getHost();
  const port = pgbouncer.getMappedPort(PGBOUNCER_CONTAINER_PORT);
  const appUserRawUrl = `postgresql://app_user:app_user_dev_pw@${host}:${port}/educrm`;
  const appUserUrl = `${appUserRawUrl}?pgbouncer=true`;

  return {
    migratorUrl,
    appUserUrl,
    appUserRawUrl,
    stop: async () => {
      await pgbouncer.stop();
      await postgres.stop();
      await network.stop();
    },
  };
}
