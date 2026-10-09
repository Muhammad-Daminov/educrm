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

function tenantScoped(tenantId: string) {
  const ctx: TenantContextLike = { currentTenantId: tenantId };
  return createTenantScopedClient(appUserClient, ctx);
}

beforeAll(async () => {
  db = await startTestDatabase();

  const migratorPg = new PgClient({ connectionString: db.migratorUrl });
  await migratorPg.connect();
  tenantA = uuidv7();
  tenantB = uuidv7();
  await migratorPg.query(
    'INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)',
    [tenantA, 'Tenant A', `tenant-a-${tenantA}`, tenantB, 'Tenant B', `tenant-b-${tenantB}`],
  );
  await migratorPg.end();

  appUserClient = new PrismaClient({ datasources: { db: { url: db.appUserUrl } } });
}, 60_000);

afterAll(async () => {
  await appUserClient.$disconnect();
  await db.stop();
}, 60_000);

describe('tenantDb.transaction', () => {
  it('rolls back all writes when the callback throws', async () => {
    const codes = [`T1-${uuidv7()}`, `T2-${uuidv7()}`, `T3-${uuidv7()}`];

    await expect(
      tenantScoped(tenantA).transaction(async (tx) => {
        await tx.branch.create({
          data: { id: uuidv7(), tenantId: tenantA, name: 'First', code: codes[0] as string },
        });
        await tx.branch.create({
          data: { id: uuidv7(), tenantId: tenantA, name: 'Second', code: codes[1] as string },
        });
        await tx.branch.create({
          data: { id: uuidv7(), tenantId: tenantA, name: 'Third', code: codes[2] as string },
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const remaining = await tenantScoped(tenantA).branch.findMany({
      where: { code: { in: codes } },
    });
    expect(remaining).toHaveLength(0);
  });

  it('every statement inside the transaction sees tenant A, and the commit stays invisible to tenant B', async () => {
    const code = `TXV-${uuidv7()}`;

    const seenInsideTx = await tenantScoped(tenantA).transaction(async (tx) => {
      await tx.branch.create({ data: { id: uuidv7(), tenantId: tenantA, name: 'Inside', code } });
      return tx.branch.findMany({ where: { code } });
    });

    expect(seenInsideTx).toHaveLength(1);
    expect(seenInsideTx[0]?.tenantId).toBe(tenantA);

    const visibleToA = await tenantScoped(tenantA).branch.findMany({ where: { code } });
    const visibleToB = await tenantScoped(tenantB).branch.findMany({ where: { code } });
    expect(visibleToA).toHaveLength(1);
    expect(visibleToB).toHaveLength(0);
  });

  it('hands the callback the plain transaction client — no nested-transaction capability', async () => {
    await tenantScoped(tenantA).transaction((tx) => {
      expect((tx as unknown as { $transaction?: unknown }).$transaction).toBeUndefined();
      return Promise.resolve();
    });
  });

  it('throws before opening any transaction when the tenant context is unset', async () => {
    const ctx: TenantContextLike = { currentTenantId: undefined };
    await expect(
      createTenantScopedClient(appUserClient, ctx).transaction(async (tx) => {
        await tx.branch.findMany();
      }),
    ).rejects.toThrow(/No tenant in request context/);
  });
});
