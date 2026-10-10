import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { uuidv7 } from '@educrm/shared';
import { startTestDatabase, type TestDatabase } from './setup';

/**
 * CLAUDE.md: "Every new tenant table must ship an RLS integration test
 * covering, at minimum, cross-tenant SELECT and cross-tenant INSERT both
 * being blocked." This is that test for the two tables T07 adds (TZ M4.1 /
 * M4.2): study_units, enrollments. Follows the same shape as
 * rls-students.spec.ts.
 */

let db: TestDatabase;
let tenantA: string;
let tenantB: string;
let fixtures: Record<string, Fixtures>;

interface Fixtures {
  branchId: string;
  disciplineId: string;
  studyUnitId: string;
  studentId: string;
}

interface TableCase {
  table: string;
  columns: string[];
  values(tenantId: string, own: Fixtures): Promise<unknown[]>;
}

const CASES: TableCase[] = [
  {
    table: 'study_units',
    columns: ['id', 'tenant_id', 'branch_id', 'discipline_id', 'type', 'name', 'capacity', 'min_size'],
    values: (tenantId, own) =>
      Promise.resolve([
        uuidv7(),
        tenantId,
        own.branchId,
        own.disciplineId,
        'group',
        `Guruh ${uuidv7()}`,
        12,
        6,
      ]),
  },
  {
    table: 'enrollments',
    columns: ['id', 'tenant_id', 'student_id', 'study_unit_id', 'start_date'],
    values: (tenantId, own) =>
      Promise.resolve([uuidv7(), tenantId, own.studentId, own.studyUnitId, '2026-01-01']),
  },
];

function placeholders(count: number): string {
  return Array.from({ length: count }, (_, i) => `$${i + 1}`).join(', ');
}

async function migratorInTenant(tenantId: string): Promise<PgClient> {
  const pg = new PgClient({ connectionString: db.migratorUrl });
  await pg.connect();
  await pg.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
  return pg;
}

async function appUserInTenant(tenantId: string): Promise<PgClient> {
  const pg = new PgClient({ connectionString: db.appUserUrl });
  await pg.connect();
  await pg.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
  return pg;
}

async function seedFixtures(tenantId: string): Promise<Fixtures> {
  const pg = await migratorInTenant(tenantId);
  try {
    const branchId = uuidv7();
    await pg.query('INSERT INTO branches (id, tenant_id, name, code) VALUES ($1, $2, $3, $4)', [
      branchId,
      tenantId,
      'Asosiy filial',
      `MAIN-${branchId}`,
    ]);
    const disciplineId = uuidv7();
    await pg.query('INSERT INTO disciplines (id, tenant_id, name) VALUES ($1, $2, $3)', [
      disciplineId,
      tenantId,
      `Fan ${disciplineId}`,
    ]);
    const studyUnitId = uuidv7();
    await pg.query(
      'INSERT INTO study_units (id, tenant_id, branch_id, discipline_id, type, name, capacity, min_size) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [studyUnitId, tenantId, branchId, disciplineId, 'group', `Guruh ${studyUnitId}`, 12, 6],
    );
    const clientId = uuidv7();
    await pg.query('INSERT INTO clients (id, tenant_id, full_name) VALUES ($1, $2, $3)', [
      clientId,
      tenantId,
      'Mijoz Testov',
    ]);
    const studentId = uuidv7();
    await pg.query('INSERT INTO students (id, tenant_id, client_id, branch_id) VALUES ($1, $2, $3, $4)', [
      studentId,
      tenantId,
      clientId,
      branchId,
    ]);
    return { branchId, disciplineId, studyUnitId, studentId };
  } finally {
    await pg.end();
  }
}

beforeAll(async () => {
  db = await startTestDatabase();

  const migratorPg = new PgClient({ connectionString: db.migratorUrl });
  await migratorPg.connect();
  tenantA = uuidv7();
  tenantB = uuidv7();
  for (const [id, name] of [
    [tenantA, 'Units Tenant A'],
    [tenantB, 'Units Tenant B'],
  ]) {
    await migratorPg.query('INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)', [
      id,
      name,
      `${String(name).toLowerCase().replace(/\s+/g, '-')}-${String(id)}`,
    ]);
  }
  await migratorPg.end();

  fixtures = {
    [tenantA]: await seedFixtures(tenantA),
    [tenantB]: await seedFixtures(tenantB),
  };
}, 120_000);

afterAll(async () => {
  await db.stop();
}, 60_000);

describe.each(CASES)('Row-Level Security — $table', (testCase) => {
  const { table, columns } = testCase;
  const insertSql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders(columns.length)})`;

  it('tenant A cannot SELECT tenant B rows', async () => {
    const seededB = await testCase.values(tenantB, fixtures[tenantB] as Fixtures);
    const bRowId = seededB[0] as string;
    const migratorB = await migratorInTenant(tenantB);
    try {
      await migratorB.query(insertSql, seededB);
    } finally {
      await migratorB.end();
    }

    const appUserA = await appUserInTenant(tenantA);
    try {
      const visible = await appUserA.query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id FROM ${table}`,
      );
      expect(visible.rows.map((row) => row.id)).not.toContain(bRowId);
      for (const row of visible.rows) {
        expect(row.tenant_id).toBe(tenantA);
      }
    } finally {
      await appUserA.end();
    }
  });

  it('INSERT of another tenant’s row is refused by WITH CHECK', async () => {
    const appUserA = await appUserInTenant(tenantA);
    try {
      const smuggled = await testCase.values(tenantB, fixtures[tenantB] as Fixtures);
      await expect(appUserA.query(insertSql, smuggled)).rejects.toThrow(/row-level security/i);
    } finally {
      await appUserA.end();
    }
  });

  it('carries ENABLE + FORCE row level security and exactly one tenant_isolation policy', async () => {
    const pg = new PgClient({ connectionString: db.migratorUrl });
    await pg.connect();
    try {
      const security = await pg.query<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        policies: string;
      }>(
        `SELECT c.relrowsecurity, c.relforcerowsecurity,
                (SELECT count(*)::text FROM pg_policies p
                  WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation') AS policies
           FROM pg_class c WHERE c.relname = $1`,
        [table],
      );
      expect(security.rows[0]?.relrowsecurity).toBe(true);
      expect(security.rows[0]?.relforcerowsecurity).toBe(true);
      expect(security.rows[0]?.policies).toBe('1');
    } finally {
      await pg.end();
    }
  });

  it('is invisible to app_user with no tenant context at all', async () => {
    const pg = new PgClient({ connectionString: db.appUserUrl });
    await pg.connect();
    try {
      const result = await pg.query(`SELECT * FROM ${table}`);
      expect(result.rows).toHaveLength(0);
    } finally {
      await pg.end();
    }
  });
});

describe('BR-E1: overlapping enrollments for the same (student, study_unit) are rejected', () => {
  it('a second enrollment covering an overlapping date range fails the EXCLUDE constraint', async () => {
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorInTenant(tenantA);
    try {
      await pg.query(
        'INSERT INTO enrollments (id, tenant_id, student_id, study_unit_id, start_date, end_date) VALUES ($1, $2, $3, $4, $5, $6)',
        [uuidv7(), tenantA, own.studentId, own.studyUnitId, '2026-02-01', '2026-06-30'],
      );
      await expect(
        pg.query(
          'INSERT INTO enrollments (id, tenant_id, student_id, study_unit_id, start_date, end_date) VALUES ($1, $2, $3, $4, $5, $6)',
          [uuidv7(), tenantA, own.studentId, own.studyUnitId, '2026-05-01', null],
        ),
      ).rejects.toThrow(/exclusion/i);
    } finally {
      await pg.end();
    }
  });
});

describe('cross-tenant references are structurally impossible', () => {
  it('a study_unit cannot point at another tenant’s branch', async () => {
    const pg = await appUserInTenant(tenantA);
    try {
      await expect(
        pg.query(
          'INSERT INTO study_units (id, tenant_id, branch_id, discipline_id, type, name, capacity, min_size) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [
            uuidv7(),
            tenantA,
            (fixtures[tenantB] as Fixtures).branchId,
            (fixtures[tenantA] as Fixtures).disciplineId,
            'group',
            'Smuggled',
            10,
            5,
          ],
        ),
      ).rejects.toThrow(/foreign key|violates/i);
    } finally {
      await pg.end();
    }
  });

  it('an enrollment cannot point at another tenant’s study_unit', async () => {
    const pg = await appUserInTenant(tenantA);
    try {
      await expect(
        pg.query(
          'INSERT INTO enrollments (id, tenant_id, student_id, study_unit_id, start_date) VALUES ($1, $2, $3, $4, $5)',
          [
            uuidv7(),
            tenantA,
            (fixtures[tenantA] as Fixtures).studentId,
            (fixtures[tenantB] as Fixtures).studyUnitId,
            '2026-01-01',
          ],
        ),
      ).rejects.toThrow(/foreign key|violates/i);
    } finally {
      await pg.end();
    }
  });
});
