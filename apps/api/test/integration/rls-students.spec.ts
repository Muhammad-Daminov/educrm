import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { uuidv7 } from '@educrm/shared';
import { startTestDatabase, type TestDatabase } from './setup';

/**
 * CLAUDE.md: "Every new tenant table must ship an RLS integration test
 * covering, at minimum, cross-tenant SELECT and cross-tenant INSERT both
 * being blocked." This is that test for the five tables T06 adds (TZ M3):
 * clients, client_phones, contact_persons, students, import_batches.
 * Follows the same shape as rls-org-reference.spec.ts.
 */

let db: TestDatabase;
let tenantA: string;
let tenantB: string;
let fixtures: Record<string, Fixtures>;

interface Fixtures {
  branchId: string;
  clientId: string;
  studentId: string;
}

interface TableCase {
  table: string;
  columns: string[];
  values(tenantId: string, own: Fixtures): Promise<unknown[]>;
}

const CASES: TableCase[] = [
  {
    table: 'clients',
    columns: ['id', 'tenant_id', 'full_name'],
    values: (tenantId) => Promise.resolve([uuidv7(), tenantId, `Mijoz ${uuidv7()}`]),
  },
  {
    table: 'client_phones',
    columns: ['id', 'tenant_id', 'client_id', 'phone_e164'],
    // One client can carry several phones, so unlike client_id-unique
    // tables this needs is_primary=false to avoid the one-primary index —
    // handled by the explicit column list below (5 columns, not 4).
    values: async (tenantId) => [uuidv7(), tenantId, await createClient(tenantId), nextPhone()],
  },
  {
    table: 'students',
    columns: ['id', 'tenant_id', 'client_id', 'branch_id'],
    values: async (tenantId, own) => [uuidv7(), tenantId, await createClient(tenantId), own.branchId],
  },
  {
    table: 'contact_persons',
    columns: ['id', 'tenant_id', 'student_id', 'full_name', 'relation'],
    values: async (tenantId) => [
      uuidv7(),
      tenantId,
      await createStudent(tenantId),
      'Ota',
      'parent',
    ],
  },
  {
    table: 'import_batches',
    columns: ['id', 'tenant_id', 'entity_type', 'file_name', 'total_rows', 'imported_count', 'error_count'],
    values: (tenantId) => Promise.resolve([uuidv7(), tenantId, 'students', 'f.csv', 0, 0, 0]),
  },
];

let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `+9989${String(phoneCounter).padStart(8, '0')}`;
}

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

async function createClient(tenantId: string): Promise<string> {
  const pg = await migratorInTenant(tenantId);
  try {
    const clientId = uuidv7();
    await pg.query('INSERT INTO clients (id, tenant_id, full_name) VALUES ($1, $2, $3)', [
      clientId,
      tenantId,
      'Mijoz Testov',
    ]);
    return clientId;
  } finally {
    await pg.end();
  }
}

async function createStudent(tenantId: string): Promise<string> {
  const branchId = fixtures[tenantId]?.branchId ?? (await createBranch(tenantId));
  const clientId = await createClient(tenantId);
  const pg = await migratorInTenant(tenantId);
  try {
    const studentId = uuidv7();
    await pg.query('INSERT INTO students (id, tenant_id, client_id, branch_id) VALUES ($1, $2, $3, $4)', [
      studentId,
      tenantId,
      clientId,
      branchId,
    ]);
    return studentId;
  } finally {
    await pg.end();
  }
}

async function createBranch(tenantId: string): Promise<string> {
  const pg = await migratorInTenant(tenantId);
  try {
    const branchId = uuidv7();
    await pg.query('INSERT INTO branches (id, tenant_id, name, code) VALUES ($1, $2, $3, $4)', [
      branchId,
      tenantId,
      'Asosiy filial',
      `MAIN-${branchId}`,
    ]);
    return branchId;
  } finally {
    await pg.end();
  }
}

async function seedFixtures(tenantId: string): Promise<Fixtures> {
  const branchId = await createBranch(tenantId);
  const clientId = await createClient(tenantId);
  const pg = await migratorInTenant(tenantId);
  let studentId: string;
  try {
    studentId = uuidv7();
    await pg.query('INSERT INTO students (id, tenant_id, client_id, branch_id) VALUES ($1, $2, $3, $4)', [
      studentId,
      tenantId,
      clientId,
      branchId,
    ]);
  } finally {
    await pg.end();
  }
  return { branchId, clientId, studentId };
}

beforeAll(async () => {
  db = await startTestDatabase();

  const migratorPg = new PgClient({ connectionString: db.migratorUrl });
  await migratorPg.connect();
  tenantA = uuidv7();
  tenantB = uuidv7();
  for (const [id, name] of [
    [tenantA, 'Students Tenant A'],
    [tenantB, 'Students Tenant B'],
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

describe('cross-tenant references are structurally impossible', () => {
  it('a student cannot point at another tenant’s branch', async () => {
    const pg = await appUserInTenant(tenantA);
    try {
      const clientId = await createClient(tenantA);
      await expect(
        pg.query('INSERT INTO students (id, tenant_id, client_id, branch_id) VALUES ($1, $2, $3, $4)', [
          uuidv7(),
          tenantA,
          clientId,
          (fixtures[tenantB] as Fixtures).branchId,
        ]),
      ).rejects.toThrow(/foreign key|violates/i);
    } finally {
      await pg.end();
    }
  });

  it('a student cannot point at another tenant’s client', async () => {
    const pg = await appUserInTenant(tenantA);
    try {
      await expect(
        pg.query('INSERT INTO students (id, tenant_id, client_id, branch_id) VALUES ($1, $2, $3, $4)', [
          uuidv7(),
          tenantA,
          (fixtures[tenantB] as Fixtures).clientId,
          (fixtures[tenantA] as Fixtures).branchId,
        ]),
      ).rejects.toThrow(/foreign key|violates/i);
    } finally {
      await pg.end();
    }
  });

  it('a contact person cannot point at another tenant’s student', async () => {
    const pg = await appUserInTenant(tenantA);
    try {
      await expect(
        pg.query(
          'INSERT INTO contact_persons (id, tenant_id, student_id, full_name, relation) VALUES ($1, $2, $3, $4, $5)',
          [uuidv7(), tenantA, (fixtures[tenantB] as Fixtures).studentId, 'Ota', 'parent'],
        ),
      ).rejects.toThrow(/foreign key|violates/i);
    } finally {
      await pg.end();
    }
  });
});
