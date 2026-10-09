import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { uuidv7 } from '@educrm/shared';
import { startTestDatabase, type TestDatabase } from './setup';

/**
 * CLAUDE.md: "Every new tenant table must ship an RLS integration test
 * covering, at minimum, cross-tenant SELECT and cross-tenant INSERT both
 * being blocked." This is that test for the nine tables T05 adds
 * (TZ M1.1–M1.4). `rls.spec.ts` stays the deeper, branches-based proof of
 * the policy mechanics (no-context deny, FORCE, ownership, concurrency);
 * this file proves every new table actually carries the same pattern,
 * because the failure mode is a table someone forgot to add it to.
 */

let db: TestDatabase;
let tenantA: string;
let tenantB: string;
/** Per-tenant parent rows the dependent tables need. */
let fixtures: Record<string, Fixtures>;

interface Fixtures {
  branchId: string;
  userId: string;
  disciplineId: string;
  levelId: string;
  teacherProfileId: string;
}

/**
 * A row to try to insert into `table` for a given tenant. `columns` always
 * starts with id and tenant_id; the cross-tenant INSERT test swaps the
 * tenant_id value for the *other* tenant's id while keeping the session on
 * this one, which is exactly what the policy's WITH CHECK must refuse.
 */
interface TableCase {
  table: string;
  columns: string[];
  /**
   * Async because some of these tables are unique per parent row
   * (`teacher_profiles` is one per user, the two join tables are one per
   * pair), so each attempt needs a freshly created parent — otherwise the
   * insert could fail on a unique index and never reach the policy, and
   * the test would pass for the wrong reason.
   */
  values(tenantId: string, own: Fixtures): Promise<unknown[]>;
}

const CASES: TableCase[] = [
  {
    table: 'classrooms',
    columns: ['id', 'tenant_id', 'branch_id', 'name', 'capacity'],
    values: (tenantId, own) =>
      Promise.resolve([uuidv7(), tenantId, own.branchId, `Xona ${uuidv7()}`, 12]),
  },
  {
    table: 'disciplines',
    columns: ['id', 'tenant_id', 'name'],
    values: (tenantId) => Promise.resolve([uuidv7(), tenantId, `Fan ${uuidv7()}`]),
  },
  {
    table: 'levels',
    columns: ['id', 'tenant_id', 'discipline_id', 'name'],
    values: (tenantId, own) =>
      Promise.resolve([uuidv7(), tenantId, own.disciplineId, `Daraja ${uuidv7()}`]),
  },
  {
    table: 'age_categories',
    columns: ['id', 'tenant_id', 'name', 'min_age', 'max_age'],
    values: (tenantId) => Promise.resolve([uuidv7(), tenantId, `Toifa ${uuidv7()}`, 7, 10]),
  },
  {
    table: 'payment_methods',
    columns: ['id', 'tenant_id', 'name'],
    values: (tenantId) => Promise.resolve([uuidv7(), tenantId, `Usul ${uuidv7()}`]),
  },
  {
    table: 'holidays',
    columns: ['id', 'tenant_id', 'branch_id', 'name', 'date'],
    values: (tenantId, own) =>
      Promise.resolve([
        uuidv7(),
        tenantId,
        own.branchId,
        'Mustaqillik kuni',
        // A fresh date per attempt: one holiday per (branch, date), so a
        // repeat would hit the unique index instead of the policy.
        nextHolidayDate(),
      ]),
  },
  {
    table: 'teacher_profiles',
    columns: ['id', 'tenant_id', 'user_id'],
    // One profile per user, so this needs a user that has none yet.
    values: async (tenantId) => [uuidv7(), tenantId, await createUser(tenantId)],
  },
  {
    table: 'teacher_disciplines',
    columns: ['id', 'tenant_id', 'teacher_profile_id', 'discipline_id'],
    values: async (tenantId, own) => [
      uuidv7(),
      tenantId,
      await createTeacherProfile(tenantId),
      own.disciplineId,
    ],
  },
  {
    table: 'teacher_levels',
    columns: ['id', 'tenant_id', 'teacher_profile_id', 'level_id'],
    values: async (tenantId, own) => [
      uuidv7(),
      tenantId,
      await createTeacherProfile(tenantId),
      own.levelId,
    ],
  },
];

/**
 * uuidv7 is timestamp-prefixed, so two ids minted in the same millisecond
 * share their first bytes — a phone built from a slice of one collides on
 * `users_tenant_id_phone_key`. A counter is unambiguous.
 */
let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `+9989${String(phoneCounter).padStart(8, '0')}`;
}

let holidayDay = 0;
function nextHolidayDate(): Date {
  holidayDay += 1;
  return new Date(Date.UTC(2027, 0, holidayDay));
}

function placeholders(count: number): string {
  return Array.from({ length: count }, (_, i) => `$${i + 1}`).join(', ');
}

/** migrator, with a tenant in the session — FORCE applies to the owner too. */
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

/** A new employee row in `tenantId`, created as migrator. */
async function createUser(tenantId: string): Promise<string> {
  const pg = await migratorInTenant(tenantId);
  try {
    const userId = uuidv7();
    await pg.query(
      'INSERT INTO users (id, tenant_id, full_name, phone, password_hash) VALUES ($1, $2, $3, $4, $5)',
      [userId, tenantId, 'Oʻqituvchi Testov', nextPhone(), 'x'],
    );
    return userId;
  } finally {
    await pg.end();
  }
}

async function createTeacherProfile(tenantId: string): Promise<string> {
  const userId = await createUser(tenantId);
  const pg = await migratorInTenant(tenantId);
  try {
    const profileId = uuidv7();
    await pg.query('INSERT INTO teacher_profiles (id, tenant_id, user_id) VALUES ($1, $2, $3)', [
      profileId,
      tenantId,
      userId,
    ]);
    return profileId;
  } finally {
    await pg.end();
  }
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

    const userId = uuidv7();
    await pg.query(
      'INSERT INTO users (id, tenant_id, full_name, phone, password_hash) VALUES ($1, $2, $3, $4, $5)',
      [userId, tenantId, 'Oʻqituvchi Testov', nextPhone(), 'x'],
    );

    const disciplineId = uuidv7();
    await pg.query('INSERT INTO disciplines (id, tenant_id, name) VALUES ($1, $2, $3)', [
      disciplineId,
      tenantId,
      'Ingliz tili',
    ]);

    const levelId = uuidv7();
    await pg.query(
      'INSERT INTO levels (id, tenant_id, discipline_id, name) VALUES ($1, $2, $3, $4)',
      [levelId, tenantId, disciplineId, 'A1'],
    );

    const teacherProfileId = uuidv7();
    await pg.query('INSERT INTO teacher_profiles (id, tenant_id, user_id) VALUES ($1, $2, $3)', [
      teacherProfileId,
      tenantId,
      userId,
    ]);

    return { branchId, userId, disciplineId, levelId, teacherProfileId };
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
    [tenantA, 'Org Tenant A'],
    [tenantB, 'Org Tenant B'],
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
  const insertSql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders(
    columns.length,
  )})`;

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
      // Everything visible belongs to A — including rows seeded as fixtures.
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
      // Session is tenant A; the row claims tenant B. Parent ids are B's
      // too, so even the FKs describe a consistent foreign row — the only
      // thing standing in the way is the policy.
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
      // Without FORCE the policy is silently skipped for migrator.
      expect(security.rows[0]?.relforcerowsecurity).toBe(true);
      expect(security.rows[0]?.policies).toBe('1');
    } finally {
      await pg.end();
    }
  });

  it('is invisible to app_user with no tenant context at all', async () => {
    // A connection that never calls set_config — proves the policy, not the
    // application's Prisma extension, is what denies access.
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
  it('a classroom cannot point at another tenant’s branch', async () => {
    // The composite (tenant_id, branch_id) FK, not the policy, is what
    // refuses this: tenant_id is A's, so WITH CHECK is satisfied.
    const pg = await appUserInTenant(tenantA);
    try {
      await expect(
        pg.query(
          'INSERT INTO classrooms (id, tenant_id, branch_id, name) VALUES ($1, $2, $3, $4)',
          [uuidv7(), tenantA, (fixtures[tenantB] as Fixtures).branchId, 'Xona 101'],
        ),
      ).rejects.toThrow(/foreign key|violates/i);
    } finally {
      await pg.end();
    }
  });

  it('a level cannot point at another tenant’s discipline', async () => {
    const pg = await appUserInTenant(tenantA);
    try {
      await expect(
        pg.query(
          'INSERT INTO levels (id, tenant_id, discipline_id, name) VALUES ($1, $2, $3, $4)',
          [uuidv7(), tenantA, (fixtures[tenantB] as Fixtures).disciplineId, 'B2'],
        ),
      ).rejects.toThrow(/foreign key|violates/i);
    } finally {
      await pg.end();
    }
  });

  it('a teacher profile cannot point at another tenant’s user', async () => {
    const pg = await appUserInTenant(tenantA);
    try {
      await expect(
        pg.query('INSERT INTO teacher_profiles (id, tenant_id, user_id) VALUES ($1, $2, $3)', [
          uuidv7(),
          tenantA,
          (fixtures[tenantB] as Fixtures).userId,
        ]),
      ).rejects.toThrow(/foreign key|violates/i);
    } finally {
      await pg.end();
    }
  });
});
