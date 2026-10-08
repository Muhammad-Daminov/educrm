import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Client as PgClient } from 'pg';
import { uuidv7 } from '@educrm/shared';
import { createTenantScopedClient, type TenantContextLike } from '../../src/database/tenant-prisma.provider';
import { startTestDatabaseWithPgBouncer, type TestDatabaseWithPgBouncer } from './pgbouncer-setup';

let db: TestDatabaseWithPgBouncer;
let appUserClient: PrismaClient;
let tenantA: string;
let tenantB: string;

function tenantScoped(tenantId: string) {
  const ctx: TenantContextLike = { currentTenantId: tenantId };
  return createTenantScopedClient(appUserClient, ctx);
}

beforeAll(async () => {
  db = await startTestDatabaseWithPgBouncer();

  const migratorPg = new PgClient({ connectionString: db.migratorUrl });
  await migratorPg.connect();
  tenantA = uuidv7();
  tenantB = uuidv7();
  await migratorPg.query('INSERT INTO tenants (id, name) VALUES ($1, $2), ($3, $4)', [
    tenantA,
    'Tenant A',
    tenantB,
    'Tenant B',
  ]);
  await migratorPg.end();

  // Connects as app_user, through PgBouncer, pool_mode=transaction — exactly
  // what the running API does in docker-compose.
  appUserClient = new PrismaClient({ datasources: { db: { url: db.appUserUrl } } });
}, 120_000);

afterAll(async () => {
  await appUserClient.$disconnect();
  await db.stop();
}, 60_000);

describe('RLS through PgBouncer (transaction pool mode)', () => {
  it('30 concurrent requests alternating tenant A/B produce zero cross-tenant rows', async () => {
    const runId = uuidv7();
    const concurrency = 30;

    const creates = await Promise.all(
      Array.from({ length: concurrency }, (_, i) => {
        const tenantId = i % 2 === 0 ? tenantA : tenantB;
        return tenantScoped(tenantId).branch.create({
          data: {
            id: uuidv7(),
            tenantId,
            name: `Concurrent ${i}`,
            code: `PB-${runId}-${i}`,
          },
        });
      }),
    );
    expect(creates).toHaveLength(concurrency);

    const [seenByA, seenByB] = await Promise.all([
      tenantScoped(tenantA).branch.findMany({ where: { code: { startsWith: `PB-${runId}-` } } }),
      tenantScoped(tenantB).branch.findMany({ where: { code: { startsWith: `PB-${runId}-` } } }),
    ]);

    expect(seenByA).toHaveLength(concurrency / 2);
    expect(seenByB).toHaveLength(concurrency / 2);
    expect(seenByA.every((b) => b.tenantId === tenantA)).toBe(true);
    expect(seenByB.every((b) => b.tenantId === tenantB)).toBe(true);

    // Re-run the same read concurrently, interleaved, many times — this is
    // the actual pool-leak shape: many clients hitting the same pooled
    // backend connections at once.
    const reads = await Promise.all(
      Array.from({ length: concurrency }, (_, i) => {
        const tenantId = i % 2 === 0 ? tenantA : tenantB;
        return tenantScoped(tenantId)
          .branch.findMany({ where: { code: { startsWith: `PB-${runId}-` } } })
          .then((rows) => ({ tenantId, rows }));
      }),
    );
    for (const { tenantId, rows } of reads) {
      expect(rows.every((r) => r.tenantId === tenantId)).toBe(true);
    }
  });

  it('after a tenant-scoped transaction, a fresh pooled connection sees no leaked setting and 0 rows', async () => {
    const code = `PB-LEAK-${uuidv7()}`;

    await tenantScoped(tenantA).transaction(async (tx) => {
      await tx.branch.create({ data: { id: uuidv7(), tenantId: tenantA, name: 'Leak check', code } });
    });

    // A brand new connection through PgBouncer, as app_user, that never
    // calls set_config itself.
    const fresh = new PgClient({ connectionString: db.appUserRawUrl });
    await fresh.connect();
    try {
      const setting = await fresh.query<{ setting: string | null }>(
        "SELECT current_setting('app.current_tenant', true) AS setting",
      );
      expect(setting.rows[0]?.setting === null || setting.rows[0]?.setting === '').toBe(true);

      const rows = await fresh.query('SELECT * FROM branches WHERE code = $1', [code]);
      expect(rows.rows).toHaveLength(0);
    } finally {
      await fresh.end();
    }
  });
});
