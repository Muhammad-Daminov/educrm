import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Client as PgClient } from 'pg';
import { uuidv7 } from '@educrm/shared';
import {
  createTenantScopedClient,
  type TenantContextLike,
} from '../../src/database/tenant-prisma.provider';
import { AuditService } from '../../src/audit/audit.service';
import { diffOf } from '../../src/audit/audit-diff';
import type { TenantContextService } from '../../src/tenant/tenant-context.service';
import type { RequestUserService } from '../../src/auth/request-user.service';
import type { RequestMetaService } from '../../src/common/request-meta';
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

/**
 * A migrator connection that can actually see tenant rows. `audit_log` has
 * FORCE row level security, so the policy applies to the table owner as
 * well — without a tenant in the session, even migrator selects zero rows.
 * Session-scoped (`is_local = false`) because these queries don't run
 * inside an explicit transaction.
 */
async function migratorInTenant(tenantId: string): Promise<PgClient> {
  const pg = new PgClient({ connectionString: db.migratorUrl });
  await pg.connect();
  await pg.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
  return pg;
}

function entry(tenantId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: uuidv7(),
    tenantId,
    action: 'branch.update',
    entityType: 'branch',
    entityId: uuidv7(),
    diff: { name: { before: 'Asosiy', after: 'Chilonzor' } },
    ip: '127.0.0.1',
    userAgent: 'vitest',
    requestId: uuidv7(),
    ...overrides,
  };
}

beforeAll(async () => {
  db = await startTestDatabase();

  const migratorPg = new PgClient({ connectionString: db.migratorUrl });
  await migratorPg.connect();
  tenantA = await seedTenant(migratorPg, 'Audit Tenant A');
  tenantB = await seedTenant(migratorPg, 'Audit Tenant B');
  await migratorPg.end();

  appUserClient = new PrismaClient({ datasources: { db: { url: db.appUserUrl } } });
}, 60_000);

afterAll(async () => {
  await appUserClient.$disconnect();
  await db.stop();
}, 60_000);

describe('Row-Level Security — audit_log', () => {
  it('tenant A cannot SELECT tenant B audit rows', async () => {
    const rowA = await tenantScoped(tenantA).auditLog.create({ data: entry(tenantA) });
    const rowB = await tenantScoped(tenantB).auditLog.create({ data: entry(tenantB) });

    const seenByA = await tenantScoped(tenantA).auditLog.findMany();
    const seenByB = await tenantScoped(tenantB).auditLog.findMany();

    expect(seenByA.map((row) => row.id)).toContain(rowA.id);
    expect(seenByA.map((row) => row.id)).not.toContain(rowB.id);

    expect(seenByB.map((row) => row.id)).toContain(rowB.id);
    expect(seenByB.map((row) => row.id)).not.toContain(rowA.id);
  });

  it('INSERT with a foreign tenant_id fails WITH CHECK', async () => {
    const pg = new PgClient({ connectionString: db.appUserUrl });
    await pg.connect();
    try {
      await pg.query('BEGIN');
      await pg.query("SELECT set_config('app.current_tenant', $1, true)", [tenantA]);
      await expect(
        pg.query(
          'INSERT INTO audit_log (id, tenant_id, action, entity_type) VALUES ($1, $2, $3, $4)',
          [uuidv7(), tenantB, 'branch.update', 'branch'],
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await pg.query('ROLLBACK').catch(() => undefined);
      await pg.end();
    }
  });

  it('a raw query as app_user with no tenant context returns 0 rows', async () => {
    const pg = new PgClient({ connectionString: db.appUserUrl });
    await pg.connect();
    try {
      const result = await pg.query('SELECT * FROM audit_log');
      expect(result.rows).toHaveLength(0);
    } finally {
      await pg.end();
    }
  });

  it('the policy is on every partition too, not only the parent', async () => {
    // Reading a partition directly bypasses the parent's policy, so each
    // partition carries its own copy (created by
    // ensure_audit_log_partition).
    const migratorPg = new PgClient({ connectionString: db.migratorUrl });
    await migratorPg.connect();
    const partitions = await migratorPg.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; policies: string }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*)::text FROM pg_policies p
                WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation') AS policies
         FROM pg_class c
         JOIN pg_inherits i ON i.inhrelid = c.oid
         JOIN pg_class parent ON parent.oid = i.inhparent
        WHERE parent.relname = 'audit_log'`,
    );
    await migratorPg.end();

    expect(partitions.rows.length).toBeGreaterThanOrEqual(36);
    for (const partition of partitions.rows) {
      expect(partition.relrowsecurity).toBe(true);
      expect(partition.relforcerowsecurity).toBe(true);
      expect(partition.policies).toBe('1');
    }

    const pg = new PgClient({ connectionString: db.appUserUrl });
    await pg.connect();
    try {
      const direct = await pg.query('SELECT * FROM audit_log_2026_10');
      expect(direct.rows).toHaveLength(0);
    } finally {
      await pg.end();
    }
  });
});

describe('audit_log is append-only (TZ M11.3)', () => {
  it('app_user cannot UPDATE or DELETE an audit row', async () => {
    const row = await tenantScoped(tenantA).auditLog.create({ data: entry(tenantA) });

    const pg = new PgClient({ connectionString: db.appUserUrl });
    await pg.connect();
    try {
      // The REVOKE is what stops app_user, before the trigger is even
      // consulted. Each statement needs its own transaction: the first
      // failure aborts it, and a second statement in an aborted
      // transaction fails for the wrong reason.
      const attempts = [
        { sql: 'UPDATE audit_log SET action = $2 WHERE id = $1', params: [row.id, 'tampered'] },
        { sql: 'DELETE FROM audit_log WHERE id = $1', params: [row.id] },
      ];
      for (const attempt of attempts) {
        await pg.query('BEGIN');
        await pg.query("SELECT set_config('app.current_tenant', $1, true)", [tenantA]);
        await expect(pg.query(attempt.sql, attempt.params)).rejects.toThrow(/permission denied/i);
        await pg.query('ROLLBACK');
      }
    } finally {
      await pg.end();
    }

    const stillThere = await tenantScoped(tenantA).auditLog.findFirst({ where: { id: row.id } });
    expect(stillThere?.action).toBe('branch.update');
  });

  it('even the table owner cannot UPDATE or DELETE — the trigger refuses', async () => {
    const row = await tenantScoped(tenantA).auditLog.create({ data: entry(tenantA) });

    const migratorPg = await migratorInTenant(tenantA);
    try {
      await expect(
        migratorPg.query('UPDATE audit_log SET action = $1 WHERE id = $2', ['tampered', row.id]),
      ).rejects.toThrow(/append-only/i);
      await expect(
        migratorPg.query('DELETE FROM audit_log WHERE id = $1', [row.id]),
      ).rejects.toThrow(/append-only/i);
    } finally {
      await migratorPg.end();
    }
  });

  it('the trigger also guards a partition accessed directly', async () => {
    const row = await tenantScoped(tenantA).auditLog.create({
      data: entry(tenantA, { occurredAt: new Date('2026-11-15T10:00:00Z') }),
    });

    const migratorPg = await migratorInTenant(tenantA);
    try {
      await expect(
        migratorPg.query('UPDATE audit_log_2026_11 SET action = $1 WHERE id = $2', [
          'tampered',
          row.id,
        ]),
      ).rejects.toThrow(/append-only/i);
    } finally {
      await migratorPg.end();
    }
  });
});

describe('AuditService', () => {
  const ACTOR_ID = uuidv7();
  const REQUEST_ID = uuidv7();

  /**
   * The three context dependencies are plain value holders over CLS, so
   * they're stubbed rather than Nest-wired — what's worth testing here is
   * the real SQL path, which uses the real tenant-scoped Prisma client.
   */
  function auditServiceFor(tenantId: string | undefined): AuditService {
    return new AuditService(
      tenantScoped(tenantId),
      { currentTenantId: tenantId } as unknown as TenantContextService,
      {
        current: tenantId
          ? { userId: ACTOR_ID, tenantId, sessionId: uuidv7() }
          : undefined,
      } as unknown as RequestUserService,
      {
        current: { requestId: REQUEST_ID, ip: '10.0.0.7', userAgent: 'vitest-ua' },
      } as unknown as RequestMetaService,
    );
  }

  it('fills actor, ip, user agent and request id from the request context', async () => {
    const entityId = uuidv7();
    await auditServiceFor(tenantA).record({
      action: 'branch.update',
      entityType: 'branch',
      entityId,
      diff: diffOf({ name: 'Asosiy' }, { name: 'Chilonzor' }),
    });

    const written = await tenantScoped(tenantA).auditLog.findFirst({ where: { entityId } });
    expect(written).toMatchObject({
      tenantId: tenantA,
      actorId: ACTOR_ID,
      action: 'branch.update',
      entityType: 'branch',
      entityId,
      ip: '10.0.0.7',
      userAgent: 'vitest-ua',
      requestId: REQUEST_ID,
      diff: { name: { before: 'Asosiy', after: 'Chilonzor' } },
    });
  });

  it('rolls back with the operation it audits', async () => {
    // The whole reason `record` takes a `tx`: an audit row that commits
    // separately from the change it describes can survive a rolled-back
    // operation, which is a lie in the permanent record.
    const code = `AUD-${uuidv7()}`;
    const entityId = uuidv7();
    const audit = auditServiceFor(tenantA);

    await expect(
      tenantScoped(tenantA).transaction(async (tx) => {
        const branch = await tx.branch.create({
          data: { id: entityId, tenantId: tenantA, name: 'Rolled back', code },
        });
        await audit.record(
          { action: 'branch.create', entityType: 'branch', entityId: branch.id },
          tx,
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await tenantScoped(tenantA).branch.findMany({ where: { code } })).toHaveLength(0);
    expect(await tenantScoped(tenantA).auditLog.findMany({ where: { entityId } })).toHaveLength(0);
  });

  it('commits with the operation it audits', async () => {
    const code = `AUD-${uuidv7()}`;
    const entityId = uuidv7();
    const audit = auditServiceFor(tenantA);

    await tenantScoped(tenantA).transaction(async (tx) => {
      const branch = await tx.branch.create({
        data: { id: entityId, tenantId: tenantA, name: 'Kept', code },
      });
      await audit.record({ action: 'branch.create', entityType: 'branch', entityId: branch.id }, tx);
    });

    expect(await tenantScoped(tenantA).branch.findMany({ where: { code } })).toHaveLength(1);
    expect(await tenantScoped(tenantA).auditLog.findMany({ where: { entityId } })).toHaveLength(1);
  });

  it('refuses to write an unattributable row with no tenant context', async () => {
    await expect(
      auditServiceFor(undefined).record({ action: 'export.run', entityType: 'student' }),
    ).rejects.toThrow(/No tenant in request context/);
  });
});

describe('audit_log monthly partitioning (TZ M11.3)', () => {
  it('routes a row to the partition for its occurred_at month', async () => {
    const row = await tenantScoped(tenantA).auditLog.create({
      data: entry(tenantA, { occurredAt: new Date('2027-03-04T12:00:00Z') }),
    });

    const migratorPg = await migratorInTenant(tenantA);
    try {
      const inPartition = await migratorPg.query(
        'SELECT id FROM audit_log_2027_03 WHERE id = $1',
        [row.id],
      );
      expect(inPartition.rows).toHaveLength(1);
    } finally {
      await migratorPg.end();
    }
  });

  it('refuses a row outside the pre-created range instead of losing it', async () => {
    // Deliberate: there is no default partition, because removing rows from
    // one later would need a DELETE that the append-only trigger forbids.
    // Running out of partitions has to be a loud failure.
    await expect(
      tenantScoped(tenantA).auditLog.create({
        data: entry(tenantA, { occurredAt: new Date('2099-01-01T00:00:00Z') }),
      }),
    ).rejects.toThrow(/partition/i);
  });

  it('ensure_audit_log_partition is idempotent and extends the range', async () => {
    const migratorPg = new PgClient({ connectionString: db.migratorUrl });
    await migratorPg.connect();
    try {
      const first = await migratorPg.query<{ ensure_audit_log_partition: string }>(
        'SELECT ensure_audit_log_partition($1)',
        ['2030-05-17'],
      );
      expect(first.rows[0]?.ensure_audit_log_partition).toBe('audit_log_2030_05');

      // Second call must not fail — this is what a scheduled job does.
      const second = await migratorPg.query<{ ensure_audit_log_partition: string }>(
        'SELECT ensure_audit_log_partition($1)',
        ['2030-05-01'],
      );
      expect(second.rows[0]?.ensure_audit_log_partition).toBe('audit_log_2030_05');

      const grants = await migratorPg.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.table_privileges
          WHERE table_name = 'audit_log_2030_05' AND grantee = 'app_user'`,
      );
      const privileges = grants.rows.map((grant) => grant.privilege_type);
      expect(privileges).toContain('INSERT');
      expect(privileges).toContain('SELECT');
      expect(privileges).not.toContain('UPDATE');
      expect(privileges).not.toContain('DELETE');
    } finally {
      await migratorPg.end();
    }

    // And the newly created month accepts writes under RLS.
    const row = await tenantScoped(tenantA).auditLog.create({
      data: entry(tenantA, { occurredAt: new Date('2030-05-20T08:00:00Z') }),
    });
    expect(row.id).toBeTruthy();
  });
});
