import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { uuidv7 } from '@educrm/shared';
import { startWorkerTestApp, type WorkerTestApp } from './worker-setup';
import {
  AUDIT_PARTITION_MONTHS_AHEAD,
  AuditPartitionService,
  auditPartitionName,
  monthsToEnsure,
} from '../../src/audit/audit-partition.service';
import { TENANT_PRISMA, type TenantPrismaClient } from '../../src/database/tenant-prisma.provider';
import { runInTenant } from '../../src/tenant/run-in-tenant';

let harness: WorkerTestApp;
let partitions: AuditPartitionService;
let tenantDb: TenantPrismaClient;
let tenantId: string;

/** Partition names currently attached to the audit_log parent. */
async function attachedPartitions(): Promise<string[]> {
  const pg = new PgClient({ connectionString: harness.migratorUrl });
  await pg.connect();
  try {
    const result = await pg.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_inherits i ON i.inhrelid = c.oid
         JOIN pg_class parent ON parent.oid = i.inhparent
        WHERE parent.relname = 'audit_log'`,
    );
    return result.rows.map((row) => row.relname);
  } finally {
    await pg.end();
  }
}

function auditEntry(occurredAt: Date) {
  return {
    id: uuidv7(),
    tenantId,
    action: 'branch.update',
    entityType: 'branch',
    entityId: uuidv7(),
    diff: { name: { before: 'Asosiy', after: 'Chilonzor' } },
    requestId: uuidv7(),
    occurredAt,
  };
}

beforeAll(async () => {
  harness = await startWorkerTestApp();

  const migratorPg = new PgClient({ connectionString: harness.migratorUrl });
  await migratorPg.connect();
  tenantId = uuidv7();
  await migratorPg.query('INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)', [
    tenantId,
    'Audit Partition Tenant',
    `audit-partition-${tenantId}`,
  ]);
  await migratorPg.end();

  partitions = harness.app.get(AuditPartitionService);
  tenantDb = harness.app.get<TenantPrismaClient>(TENANT_PRISMA);
}, 180_000);

afterAll(async () => {
  await harness.stop();
}, 60_000);

describe('audit_log partition maintenance job (TZ M11.3)', () => {
  it('is the worker process that owns the job', () => {
    // APP_ROLE=api gets the same provider but starts no timer, and runs no
    // pass, because onModuleInit returns early (TZ 7.1).
    expect(partitions).toBeInstanceOf(AuditPartitionService);
  });

  it('creates nothing while the migration runway still covers the window', async () => {
    // The audit_log migration pre-created 2026-10..2029-09, so "today"
    // needs no repair — the normal steady state, and the job must be a
    // no-op in it rather than churning DDL every tick.
    const created = await partitions.tick(new Date('2027-05-10T03:00:00Z'));
    expect(created).toEqual([]);
  });

  it('extends the runway past the end of the pre-created partitions', async () => {
    // The migration's last pre-created month is 2029-09, so a worker
    // running in 2029-12 finds its whole window missing — the scenario
    // docs/QUESTIONS.md flagged as "partitions run out in 2029-10".
    const now = new Date('2029-12-20T01:00:00Z');
    const expected = monthsToEnsure(now, AUDIT_PARTITION_MONTHS_AHEAD).map(auditPartitionName);

    const created = await partitions.tick(now);

    // 2029-10..2029-12 and 2030-01..2030-03 are all past the migration's
    // 2029-10 cutoff, so every month in the window is new.
    expect(created).toEqual(expected);
    const attached = await attachedPartitions();
    for (const name of expected) {
      expect(attached).toContain(name);
    }
  });

  it('keeps >= 3 months of future partitions, per the product-owner decision', async () => {
    const now = new Date('2031-02-05T00:00:00Z');
    await partitions.tick(now);

    const attached = new Set(await attachedPartitions());
    for (let offset = 1; offset <= 3; offset += 1) {
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
      expect(attached.has(auditPartitionName(month))).toBe(true);
    }
    // And the month the clock is actually in.
    expect(attached.has(auditPartitionName(now))).toBe(true);
  });

  it('is idempotent — a second pass on the same window creates nothing', async () => {
    const now = new Date('2031-06-11T12:00:00Z');
    expect((await partitions.tick(now)).length).toBeGreaterThan(0);
    expect(await partitions.tick(now)).toEqual([]);
    expect(await partitions.tick(now)).toEqual([]);
  });

  it('creates partitions that app_user can write to under RLS', async () => {
    // The whole point: the job runs as app_user (through a SECURITY DEFINER
    // function), and the partition it creates must carry the tenant policy
    // and app_user's INSERT grant — otherwise maintenance "succeeds" and
    // audit writes still fail.
    const now = new Date('2032-04-02T00:00:00Z');
    await partitions.tick(now);

    const row = await runInTenant(tenantId, () =>
      tenantDb.auditLog.create({ data: auditEntry(new Date('2032-04-17T09:30:00Z')) }),
    );
    expect(row.id).toBeTruthy();

    const pg = new PgClient({ connectionString: harness.migratorUrl });
    await pg.connect();
    try {
      await pg.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
      const inPartition = await pg.query('SELECT id FROM audit_log_2032_04 WHERE id = $1', [
        row.id,
      ]);
      expect(inPartition.rows).toHaveLength(1);

      const policies = await pg.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_policies
          WHERE tablename = 'audit_log_2032_04' AND policyname = 'tenant_isolation'`,
      );
      expect(policies.rows[0]?.count).toBe('1');

      const security = await pg.query<{ relforcerowsecurity: boolean }>(
        `SELECT relforcerowsecurity FROM pg_class WHERE relname = 'audit_log_2032_04'`,
      );
      expect(security.rows[0]?.relforcerowsecurity).toBe(true);

      const grants = await pg.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.table_privileges
          WHERE table_name = 'audit_log_2032_04' AND grantee = 'app_user'`,
      );
      const privileges = grants.rows.map((grant) => grant.privilege_type);
      expect(privileges).toContain('INSERT');
      expect(privileges).toContain('SELECT');
      // Append-only survives partition maintenance (TZ M11.3).
      expect(privileges).not.toContain('UPDATE');
      expect(privileges).not.toContain('DELETE');
    } finally {
      await pg.end();
    }
  });

  it('survives concurrent passes racing on the same month', async () => {
    // Two worker replicas, same tick. The advisory lock plus the
    // duplicate_table handler must make the loser a no-op, not a failure.
    const now = new Date('2033-08-03T00:00:00Z');
    const results = await Promise.all([
      partitions.ensureFuturePartitions(now),
      partitions.ensureFuturePartitions(now),
      partitions.ensureFuturePartitions(now),
    ]);

    const name = auditPartitionName(now);
    // None of the three rejected, and the month exists exactly once.
    expect(await attachedPartitions()).toContain(name);
    expect(results.some((created) => created.includes(name))).toBe(true);

    // More than one pass may *report* creating it — the existence check
    // that feeds the log is not inside the lock — but the DDL itself must
    // have happened once, which is what "attached once" above proves. A
    // duplicate_table error would have rejected one of the three.
    const attachedOnce = (await attachedPartitions()).filter((relname) => relname === name);
    expect(attachedOnce).toHaveLength(1);
  });
});
