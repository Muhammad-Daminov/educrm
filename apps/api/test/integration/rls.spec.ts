import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Client as PgClient } from 'pg';
import { uuidv7 } from '@educrm/shared';
import { createTenantScopedClient, type TenantContextLike } from '../../src/database/tenant-prisma.provider';
import { startTestDatabase, type TestDatabase } from './setup';

let db: TestDatabase;
let appUserClient: PrismaClient;
let tenantA: string;
let tenantB: string;

function tenantScoped(tenantId: string | undefined) {
  const ctx: TenantContextLike = { currentTenantId: tenantId };
  return createTenantScopedClient(appUserClient, ctx);
}

async function seedTenant(migratorPg: PgClient, name: string): Promise<string> {
  const id = uuidv7();
  await migratorPg.query('INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)', [
    id,
    name,
    `${name.toLowerCase().replace(/\s+/g, '-')}-${id}`,
  ]);
  return id;
}

beforeAll(async () => {
  db = await startTestDatabase();

  const migratorPg = new PgClient({ connectionString: db.migratorUrl });
  await migratorPg.connect();
  tenantA = await seedTenant(migratorPg, 'Tenant A');
  tenantB = await seedTenant(migratorPg, 'Tenant B');
  await migratorPg.end();

  appUserClient = new PrismaClient({ datasources: { db: { url: db.appUserUrl } } });
}, 60_000);

afterAll(async () => {
  await appUserClient.$disconnect();
  await db.stop();
}, 60_000);

describe('Row-Level Security — branches', () => {
  it('tenant A cannot SELECT tenant B branches', async () => {
    const branchA = await tenantScoped(tenantA).branch.create({
      data: { id: uuidv7(), tenantId: tenantA, name: 'A Campus', code: `A-${uuidv7()}` },
    });
    const branchB = await tenantScoped(tenantB).branch.create({
      data: { id: uuidv7(), tenantId: tenantB, name: 'B Campus', code: `B-${uuidv7()}` },
    });

    const seenByA = await tenantScoped(tenantA).branch.findMany();
    const seenByB = await tenantScoped(tenantB).branch.findMany();

    expect(seenByA.map((b) => b.id)).toContain(branchA.id);
    expect(seenByA.map((b) => b.id)).not.toContain(branchB.id);

    expect(seenByB.map((b) => b.id)).toContain(branchB.id);
    expect(seenByB.map((b) => b.id)).not.toContain(branchA.id);
  });

  it('a raw query as app_user with no tenant context set returns 0 rows', async () => {
    // Deliberately bypasses our Prisma extension entirely — a fresh
    // connection as app_user that never calls set_config at all. Proves the
    // RLS policy itself defaults to deny, independent of any app code.
    const pg = new PgClient({ connectionString: db.appUserUrl });
    await pg.connect();
    try {
      const result = await pg.query('SELECT * FROM branches');
      expect(result.rows).toHaveLength(0);
    } finally {
      await pg.end();
    }
  });

  it('refuses to run a query when the JS tenant context is unset', async () => {
    await expect(tenantScoped(undefined).branch.findMany()).rejects.toThrow(
      /No tenant in request context/,
    );
  });

  it('INSERT with a tenant_id different from the session tenant fails WITH CHECK', async () => {
    const pg = new PgClient({ connectionString: db.appUserUrl });
    await pg.connect();
    try {
      await pg.query('BEGIN');
      await pg.query("SELECT set_config('app.current_tenant', $1, true)", [tenantA]);
      await expect(
        pg.query('INSERT INTO branches (id, tenant_id, name, code) VALUES ($1, $2, $3, $4)', [
          uuidv7(),
          tenantB,
          'Smuggled Campus',
          `X-${uuidv7()}`,
        ]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await pg.query('ROLLBACK').catch(() => undefined);
      await pg.end();
    }
  });

  it('app_user cannot disable RLS and does not own the table', async () => {
    const migratorPg = new PgClient({ connectionString: db.migratorUrl });
    await migratorPg.connect();
    const ownerResult = await migratorPg.query<{ tableowner: string }>(
      "SELECT tableowner FROM pg_tables WHERE tablename = 'branches'",
    );
    await migratorPg.end();
    expect(ownerResult.rows[0]?.tableowner).toBe('migrator');

    const pg = new PgClient({ connectionString: db.appUserUrl });
    await pg.connect();
    try {
      await expect(pg.query('ALTER TABLE branches DISABLE ROW LEVEL SECURITY')).rejects.toThrow(
        /must be owner/i,
      );
      await expect(pg.query('ALTER ROLE app_user BYPASSRLS')).rejects.toThrow(/permission denied/i);
    } finally {
      await pg.end();
    }
  });

  it('two interleaved tenants never see each other\'s rows under concurrent load', async () => {
    const iterations = 15;
    const results = await Promise.all(
      Array.from({ length: iterations }, (_, i) => {
        const tenantId = i % 2 === 0 ? tenantA : tenantB;
        return tenantScoped(tenantId)
          .branch.findMany()
          .then((rows) => ({ tenantId, rows }));
      }),
    );

    for (const { tenantId, rows } of results) {
      for (const row of rows) {
        expect(row.tenantId).toBe(tenantId);
      }
    }
  });

  it('set_config(..., true) is transaction-local: gone after COMMIT on the same connection', async () => {
    const pg = new PgClient({ connectionString: db.appUserUrl });
    await pg.connect();
    try {
      await pg.query('BEGIN');
      await pg.query("SELECT set_config('app.current_tenant', $1, true)", [tenantA]);
      const inside = await pg.query<{ setting: string | null }>(
        "SELECT current_setting('app.current_tenant', true) AS setting",
      );
      expect(inside.rows[0]?.setting).toBe(tenantA);
      await pg.query('COMMIT');

      const after = await pg.query<{ setting: string | null }>(
        "SELECT current_setting('app.current_tenant', true) AS setting",
      );
      expect(after.rows[0]?.setting === null || after.rows[0]?.setting === '').toBe(true);
    } finally {
      await pg.end();
    }
  });
});
