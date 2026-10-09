import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { uuidv7, uzSearchKey } from '@educrm/shared';
import { startTestDatabase, type TestDatabase } from './setup';

/**
 * `uz_search_key(text)` in Postgres and `uzSearchKey` in
 * packages/shared/src/uz-text.ts must agree (TZ 8.5). They are two
 * implementations of one definition: the database indexes and orders by
 * one, the client searches and sorts by the other, and a divergence shows
 * up as a name that cannot be found or a list that reorders when it
 * round-trips.
 */

let db: TestDatabase;
let pg: PgClient;
let tenantId: string;

/** Everything a user, a keyboard or an imported spreadsheet produces. */
const INPUTS = [
  'Ingliz tili',
  'ingliz  tili',
  '  Ingliz tili  ',
  "O'quvchi",
  'O‘quvchi',
  'O’quvchi',
  'Oʻquvchi',
  'Oʼquvchi',
  'O`quvchi',
  "Boshlang'ich daraja",
  `Boshlang${'ʻ'}ich daraja`,
  "Ma'lumot",
  `Ma${'ʼ'}lumot`,
  'GʻAFUROV',
  'Xona 204',
  'A1',
  'Naqd pul',
  'Toʻlov kartasi',
  'Maktabgacha (4–6 yosh)',
  '',
  '   ',
];

beforeAll(async () => {
  db = await startTestDatabase();
  pg = new PgClient({ connectionString: db.migratorUrl });
  await pg.connect();

  tenantId = uuidv7();
  await pg.query('INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)', [
    tenantId,
    'Key Tenant',
    `key-tenant-${tenantId}`,
  ]);
  // Reference tables carry FORCE RLS, so even migrator needs a tenant.
  await pg.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
}, 120_000);

afterAll(async () => {
  await pg.end();
  await db.stop();
}, 60_000);

describe('uz_search_key(text) parity with uzSearchKey()', () => {
  it.each(INPUTS)('agrees with the TypeScript key for %j', async (input) => {
    const result = await pg.query<{ key: string }>('SELECT uz_search_key($1) AS key', [input]);
    expect(result.rows[0]?.key).toBe(uzSearchKey(input));
  });

  it('collapses every apostrophe variant of one word to one key', async () => {
    const variants = ["O'quvchi", 'O‘quvchi', 'Oʻquvchi', 'Oʼquvchi'];
    const keys = await Promise.all(
      variants.map(async (variant) => {
        const result = await pg.query<{ key: string }>('SELECT uz_search_key($1) AS key', [
          variant,
        ]);
        return result.rows[0]?.key;
      }),
    );
    expect(new Set(keys)).toEqual(new Set(['oquvchi']));
  });

  it('is declared IMMUTABLE, which is what lets the unique indexes use it', async () => {
    const result = await pg.query<{ provolatile: string; proparallel: string }>(
      `SELECT provolatile, proparallel FROM pg_proc WHERE proname = 'uz_search_key'`,
    );
    expect(result.rows[0]?.provolatile).toBe('i');
  });
});

describe('name uniqueness uses the normalized key', () => {
  it('refuses a discipline whose name differs only by apostrophe or spacing', async () => {
    await pg.query('INSERT INTO disciplines (id, tenant_id, name) VALUES ($1, $2, $3)', [
      uuidv7(),
      tenantId,
      `Boshlang${'ʻ'}ich matematika`,
    ]);

    for (const duplicate of [
      "Boshlang'ich matematika",
      'Boshlang’ich  matematika',
      `  BOSHLANG${'ʻ'}ICH MATEMATIKA `,
    ]) {
      await expect(
        pg.query('INSERT INTO disciplines (id, tenant_id, name) VALUES ($1, $2, $3)', [
          uuidv7(),
          tenantId,
          duplicate,
        ]),
      ).rejects.toThrow(/duplicate key|unique/i);
    }
  });

  it('allows the same discipline name in another tenant', async () => {
    const otherTenant = uuidv7();
    const other = new PgClient({ connectionString: db.migratorUrl });
    await other.connect();
    try {
      await other.query('INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)', [
        otherTenant,
        'Other Key Tenant',
        `other-key-tenant-${otherTenant}`,
      ]);
      await other.query("SELECT set_config('app.current_tenant', $1, false)", [otherTenant]);
      await other.query('INSERT INTO disciplines (id, tenant_id, name) VALUES ($1, $2, $3)', [
        uuidv7(),
        otherTenant,
        `Boshlang${'ʻ'}ich matematika`,
      ]);
    } finally {
      await other.end();
    }
  });

  it('scopes classroom names to the branch, not the tenant', async () => {
    const branchOne = uuidv7();
    const branchTwo = uuidv7();
    for (const [id, code] of [
      [branchOne, 'B1'],
      [branchTwo, 'B2'],
    ]) {
      await pg.query('INSERT INTO branches (id, tenant_id, name, code) VALUES ($1, $2, $3, $4)', [
        id,
        tenantId,
        `Filial ${code}`,
        `${code}-${id}`,
      ]);
    }

    // Every branch has a room 204, and that must be allowed.
    for (const branchId of [branchOne, branchTwo]) {
      await pg.query(
        'INSERT INTO classrooms (id, tenant_id, branch_id, name) VALUES ($1, $2, $3, $4)',
        [uuidv7(), tenantId, branchId, 'Xona 204'],
      );
    }

    await expect(
      pg.query('INSERT INTO classrooms (id, tenant_id, branch_id, name) VALUES ($1, $2, $3, $4)', [
        uuidv7(),
        tenantId,
        branchOne,
        'xona  204',
      ]),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('allows one organization-wide holiday per date, and one per branch per date', async () => {
    const branchId = uuidv7();
    await pg.query('INSERT INTO branches (id, tenant_id, name, code) VALUES ($1, $2, $3, $4)', [
      branchId,
      tenantId,
      'Bayram filiali',
      `HOL-${branchId}`,
    ]);

    const date = '2027-09-01';
    await pg.query('INSERT INTO holidays (id, tenant_id, name, date) VALUES ($1, $2, $3, $4)', [
      uuidv7(),
      tenantId,
      'Mustaqillik kuni',
      date,
    ]);
    // A branch-specific closure on the same date is fine.
    await pg.query(
      'INSERT INTO holidays (id, tenant_id, branch_id, name, date) VALUES ($1, $2, $3, $4, $5)',
      [uuidv7(), tenantId, branchId, 'Filial yopiq', date],
    );

    // A second org-wide entry for that date is not — and this is the case a
    // plain unique index would have let through, because branch_id IS NULL.
    await expect(
      pg.query('INSERT INTO holidays (id, tenant_id, name, date) VALUES ($1, $2, $3, $4)', [
        uuidv7(),
        tenantId,
        'Mustaqillik kuni (takror)',
        date,
      ]),
    ).rejects.toThrow(/duplicate key|unique/i);

    await expect(
      pg.query(
        'INSERT INTO holidays (id, tenant_id, branch_id, name, date) VALUES ($1, $2, $3, $4, $5)',
        [uuidv7(), tenantId, branchId, 'Filial yopiq (takror)', date],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('refuses a second organization-wide level with the same name', async () => {
    // Same NULL-parent trap as holidays, for levels with no discipline.
    await pg.query('INSERT INTO levels (id, tenant_id, name) VALUES ($1, $2, $3)', [
      uuidv7(),
      tenantId,
      'C1',
    ]);
    await expect(
      pg.query('INSERT INTO levels (id, tenant_id, name) VALUES ($1, $2, $3)', [
        uuidv7(),
        tenantId,
        'c1',
      ]),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('refuses an inverted age band and a non-positive capacity', async () => {
    await expect(
      pg.query(
        'INSERT INTO age_categories (id, tenant_id, name, min_age, max_age) VALUES ($1, $2, $3, $4, $5)',
        [uuidv7(), tenantId, 'Teskari', 12, 7],
      ),
    ).rejects.toThrow(/age_categories_band_valid/);

    const branchId = uuidv7();
    await pg.query('INSERT INTO branches (id, tenant_id, name, code) VALUES ($1, $2, $3, $4)', [
      branchId,
      tenantId,
      'Sigʻim filiali',
      `CAP-${branchId}`,
    ]);
    await expect(
      pg.query(
        'INSERT INTO classrooms (id, tenant_id, branch_id, name, capacity) VALUES ($1, $2, $3, $4, $5)',
        [uuidv7(), tenantId, branchId, 'Xona 0', 0],
      ),
    ).rejects.toThrow(/classrooms_capacity_positive/);
  });
});
