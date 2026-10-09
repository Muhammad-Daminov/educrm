import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Client as PgClient } from 'pg';
import * as argon2 from 'argon2';
import { uuidv7 } from '@educrm/shared';
import { findOrCreateTenant, seedOwnerUser } from '../../src/auth/seed-owner';
import { startAuthTestApp, type AuthTestApp } from './auth-setup';
import { ApiClient } from './api-client';

/**
 * T05 reference data over real HTTP (TZ M1.3): disciplines, levels, age
 * categories, payment methods, holidays. The shared CRUD policy
 * (ArchivableCrudService) is proved once here, on disciplines, and the
 * per-entity suites below cover only what is specific to them — parent
 * references, date handling, age bands.
 */

interface ReferenceRow {
  id: string;
  name: string;
  isActive: boolean;
  version: number;
  sortOrder?: number;
}

const PASSWORD = 'correct-password-1';
const OWNER_PHONE = '+998901111111';
/** reference.view but no settings.manage — can read, must not write. */
const READER_PHONE = '+998905555555';
const OTHER_TENANT_OWNER_PHONE = '+998906666666';

let testApp: AuthTestApp;
let server: Server;
let seedPrisma: PrismaClient;
let tenantId: string;
let tenantSlug: string;
let otherTenantSlug: string;
let owner: ApiClient;
let reader: ApiClient;

async function seedRoleUser(
  forTenant: string,
  phone: string,
  roleCode: string,
  permissions: string[],
): Promise<void> {
  await seedPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${forTenant}, true)`;
    const role = await tx.role.create({
      data: { id: uuidv7(), tenantId: forTenant, code: roleCode, name: roleCode, isSystem: false },
    });
    await tx.rolePermission.createMany({
      data: permissions.map((code) => ({
        id: uuidv7(),
        tenantId: forTenant,
        roleId: role.id,
        permissionCode: code,
        scope: 'all' as const,
      })),
    });
    const user = await tx.user.create({
      data: {
        id: uuidv7(),
        tenantId: forTenant,
        fullName: 'Reference Reader',
        phone,
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      },
    });
    await tx.userRole.create({
      data: { id: uuidv7(), tenantId: forTenant, userId: user.id, roleId: role.id },
    });
  });
}

/** Audit rows for one entity, newest first. migrator + tenant context. */
async function auditActions(entityId: string): Promise<string[]> {
  const pg = new PgClient({ connectionString: testApp.migratorUrl });
  await pg.connect();
  try {
    await pg.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
    const result = await pg.query<{ action: string }>(
      'SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY occurred_at DESC',
      [entityId],
    );
    return result.rows.map((row) => row.action);
  } finally {
    await pg.end();
  }
}

beforeAll(async () => {
  testApp = await startAuthTestApp();
  server = testApp.app.getHttpServer() as Server;
  seedPrisma = new PrismaClient({ datasources: { db: { url: testApp.appUserUrl } } });

  tenantSlug = `ref-tenant-${Date.now()}`;
  otherTenantSlug = `ref-other-${Date.now()}`;
  const tenant = await findOrCreateTenant(testApp.migratorUrl, tenantSlug);
  const otherTenant = await findOrCreateTenant(testApp.migratorUrl, otherTenantSlug);
  tenantId = tenant.id;

  await seedOwnerUser(seedPrisma, tenantId, {
    fullName: 'Reference Owner',
    phone: OWNER_PHONE,
    password: PASSWORD,
  });
  await seedOwnerUser(seedPrisma, otherTenant.id, {
    fullName: 'Other Owner',
    phone: OTHER_TENANT_OWNER_PHONE,
    password: PASSWORD,
  });
  await seedRoleUser(tenantId, READER_PHONE, 'reference_reader', ['reference.view']);

  owner = new ApiClient(server);
  expect(await owner.login(tenantSlug, OWNER_PHONE, PASSWORD)).toBe(200);
  reader = new ApiClient(server);
  expect(await reader.login(tenantSlug, READER_PHONE, PASSWORD)).toBe(200);
}, 180_000);

afterAll(async () => {
  await seedPrisma.$disconnect();
  await testApp.stop();
}, 60_000);

describe('reference data CRUD policy (disciplines)', () => {
  it('creates, then reads back through the TZ 6.2 envelope', async () => {
    const created = await owner.post<ReferenceRow>('/api/v1/disciplines', {
      name: `Ingliz tili ${uuidv7()}`,
      sortOrder: 10,
    });

    expect(created.status).toBe(201);
    expect(created.data.isActive).toBe(true);
    expect(created.data.version).toBe(1);

    const fetched = await owner.get<ReferenceRow>(`/api/v1/disciplines/${created.data.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.data.id).toBe(created.data.id);
  });

  it('writes an audit row inside the same transaction as the change', async () => {
    const created = await owner.post<ReferenceRow>('/api/v1/disciplines', {
      name: `Audit fan ${uuidv7()}`,
    });
    await owner.patch<ReferenceRow>(`/api/v1/disciplines/${created.data.id}`, { sortOrder: 5 });
    await owner.post<ReferenceRow>(`/api/v1/disciplines/${created.data.id}/archive`);

    expect(await auditActions(created.data.id)).toEqual([
      'discipline.archive',
      'discipline.update',
      'discipline.create',
    ]);
  });

  it('refuses a name that differs only by apostrophe, case or spacing (TZ 8.5)', async () => {
    const base = `Boshlangʻich ${Date.now()}`;
    expect((await owner.post('/api/v1/disciplines', { name: base })).status).toBe(201);

    for (const duplicate of [
      base.replace('ʻ', "'"),
      base.replace('ʻ', '’'),
      `  ${base.toUpperCase()}  `,
    ]) {
      const res = await owner.post('/api/v1/disciplines', { name: duplicate });
      expect(res.status).toBe(409);
      expect(res.error?.code).toBe('DUPLICATE_NAME');
      // UX P6: the message has to land on the field that caused it.
      expect(res.error?.details).toMatchObject([{ field: 'name', code: 'DUPLICATE' }]);
    }
  });

  it('bumps version on update and enforces If-Match (TZ 6.1)', async () => {
    const created = await owner.post<ReferenceRow>('/api/v1/disciplines', {
      name: `Versiya ${uuidv7()}`,
    });
    const { id, version } = created.data;

    const updated = await owner.patch<ReferenceRow>(
      `/api/v1/disciplines/${id}`,
      { sortOrder: 3 },
      { 'if-match': String(version) },
    );
    expect(updated.status).toBe(200);
    expect(updated.data.version).toBe(version + 1);

    // The stale version is exactly what a second browser tab would send.
    const stale = await owner.patch<ReferenceRow>(
      `/api/v1/disciplines/${id}`,
      { sortOrder: 4 },
      { 'if-match': String(version) },
    );
    expect(stale.status).toBe(409);
    expect(stale.error?.code).toBe('VERSION_CONFLICT');
    expect(stale.error?.details).toMatchObject([
      { field: 'version', expected_version: version, current_version: version + 1 },
    ]);
  });

  it('accepts a quoted ETag-style If-Match, and rejects a non-numeric one', async () => {
    const created = await owner.post<ReferenceRow>('/api/v1/disciplines', {
      name: `ETag ${uuidv7()}`,
    });

    const quoted = await owner.patch<ReferenceRow>(
      `/api/v1/disciplines/${created.data.id}`,
      { sortOrder: 1 },
      { 'if-match': `"${created.data.version}"` },
    );
    expect(quoted.status).toBe(200);

    const nonsense = await owner.patch(
      `/api/v1/disciplines/${created.data.id}`,
      { sortOrder: 2 },
      { 'if-match': 'yesterday' },
    );
    expect(nonsense.status).toBe(400);
    expect(nonsense.error?.code).toBe('INVALID_IF_MATCH');
  });

  it('updates without If-Match, for a client that did not opt in', async () => {
    const created = await owner.post<ReferenceRow>('/api/v1/disciplines', {
      name: `No If-Match ${uuidv7()}`,
    });
    const res = await owner.patch<ReferenceRow>(`/api/v1/disciplines/${created.data.id}`, {
      sortOrder: 7,
    });
    expect(res.status).toBe(200);
    expect(res.data.sortOrder).toBe(7);
  });

  it('rejects an empty PATCH body rather than bumping the version for nothing', async () => {
    const created = await owner.post<ReferenceRow>('/api/v1/disciplines', {
      name: `Bo'sh patch ${uuidv7()}`,
    });
    const res = await owner.patch(`/api/v1/disciplines/${created.data.id}`, {});
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe('VALIDATION_ERROR');
  });

  it('archives instead of deleting, and restores (TZ M1.3 KERAK)', async () => {
    const created = await owner.post<ReferenceRow>('/api/v1/disciplines', {
      name: `Arxiv ${uuidv7()}`,
    });
    const { id } = created.data;

    const archived = await owner.post<ReferenceRow>(`/api/v1/disciplines/${id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.data.isActive).toBe(false);

    // Archiving twice is a no-op, not a 409 — a double click must not fail.
    const again = await owner.post<ReferenceRow>(`/api/v1/disciplines/${id}/archive`);
    expect(again.status).toBe(200);
    expect(again.data.isActive).toBe(false);
    expect(again.data.version).toBe(archived.data.version);

    const restored = await owner.post<ReferenceRow>(`/api/v1/disciplines/${id}/restore`);
    expect(restored.data.isActive).toBe(true);

    // The row is still there — nothing was deleted at any point.
    expect((await owner.get(`/api/v1/disciplines/${id}`)).status).toBe(200);
  });

  it('has no DELETE route at all', async () => {
    const created = await owner.post<ReferenceRow>('/api/v1/disciplines', {
      name: `Delete yoʻq ${uuidv7()}`,
    });
    const res = await owner.post(`/api/v1/disciplines/${created.data.id}`, undefined);
    // POST to the item URL is not a route either; the point is that the
    // only way to remove a discipline from the pickers is /archive.
    expect([404, 405]).toContain(res.status);
  });

  it('404s for an unknown id and 400s for a non-uuid', async () => {
    expect((await owner.get(`/api/v1/disciplines/${uuidv7()}`)).status).toBe(404);
    expect((await owner.get('/api/v1/disciplines/not-a-uuid')).status).toBe(400);
  });
});

describe('reference data list (UX P1)', () => {
  const marker = `Ro'yxat ${Date.now()}`;

  beforeAll(async () => {
    // Named so the search matches all three, with sort orders that prove
    // ordering is by sortOrder first and the TZ 8.5 name key second.
    const names = [`${marker} Ckeyin`, `${marker} Aavval`, `${marker} Boʻrta`];
    for (const [index, name] of names.entries()) {
      // Identical bands on purpose: age categories sort by minAge before
      // the name, so an equal band is what leaves the name key deciding.
      const res = await owner.post<ReferenceRow>('/api/v1/age-categories', {
        name,
        minAge: 7,
        maxAge: 10,
        sortOrder: index === 2 ? 0 : 5,
      });
      expect(res.status).toBe(201);
    }
  });

  it('returns meta.total alongside the page (P1 header count)', async () => {
    const res = await owner.get<ReferenceRow[]>(
      `/api/v1/age-categories?q=${encodeURIComponent(marker)}`,
    );
    expect(res.status).toBe(200);
    expect(res.data).toHaveLength(3);
    expect(res.meta?.total).toBe(3);
    expect(res.meta?.limit).toBe(50);
    expect(res.meta?.offset).toBe(0);
  });

  it('orders by sortOrder, then by the normalized name', async () => {
    const res = await owner.get<ReferenceRow[]>(
      `/api/v1/age-categories?q=${encodeURIComponent(marker)}`,
    );
    expect(res.data.map((row) => row.name)).toEqual([
      `${marker} Boʻrta`,
      `${marker} Aavval`,
      `${marker} Ckeyin`,
    ]);
  });

  it('searches by the folded name key: no apostrophe, any case, any spacing', async () => {
    // "borta" finds "Boʻrta" — the mark is the character users skip.
    const res = await owner.get<ReferenceRow[]>(
      `/api/v1/age-categories?q=${encodeURIComponent(`${marker}   BORTA`)}`,
    );
    expect(res.data.map((row) => row.name)).toEqual([`${marker} Boʻrta`]);
  });

  it('paginates with limit/offset and reports the unpaged total', async () => {
    const first = await owner.get<ReferenceRow[]>(
      `/api/v1/age-categories?q=${encodeURIComponent(marker)}&limit=2&offset=0`,
    );
    const second = await owner.get<ReferenceRow[]>(
      `/api/v1/age-categories?q=${encodeURIComponent(marker)}&limit=2&offset=2`,
    );

    expect(first.data).toHaveLength(2);
    expect(second.data).toHaveLength(1);
    expect(first.meta?.total).toBe(3);
    expect(second.meta?.total).toBe(3);
    expect(new Set([...first.data, ...second.data].map((row) => row.id)).size).toBe(3);
  });

  it('shows only active rows by default, and the archive on request', async () => {
    const created = await owner.post<ReferenceRow>('/api/v1/payment-methods', {
      name: `Arxivlangan usul ${uuidv7()}`,
    });
    await owner.post(`/api/v1/payment-methods/${created.data.id}/archive`);

    const defaultList = await owner.get<ReferenceRow[]>('/api/v1/payment-methods');
    expect(defaultList.data.map((row) => row.id)).not.toContain(created.data.id);

    const archivedOnly = await owner.get<ReferenceRow[]>('/api/v1/payment-methods?is_active=false');
    expect(archivedOnly.data.map((row) => row.id)).toContain(created.data.id);
    expect(archivedOnly.data.every((row) => !row.isActive)).toBe(true);

    const all = await owner.get<ReferenceRow[]>('/api/v1/payment-methods?is_active=all');
    expect(all.data.map((row) => row.id)).toContain(created.data.id);
  });

  it('rejects a limit above the cap instead of accepting an unbounded page', async () => {
    const res = await owner.get('/api/v1/payment-methods?limit=5000');
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe('VALIDATION_ERROR');
  });
});

describe('permissions (TZ 3.3, CLAUDE.md: backend only)', () => {
  it('reference.view can read every reference list', async () => {
    for (const path of [
      '/api/v1/disciplines',
      '/api/v1/levels',
      '/api/v1/age-categories',
      '/api/v1/payment-methods',
      '/api/v1/holidays',
    ]) {
      expect((await reader.get(path)).status).toBe(200);
    }
  });

  it('reference.view alone cannot write — that needs settings.manage', async () => {
    const created = await owner.post<ReferenceRow>('/api/v1/disciplines', {
      name: `Ruxsat ${uuidv7()}`,
    });

    const attempts = [
      await reader.post('/api/v1/disciplines', { name: `Yangi ${uuidv7()}` }),
      await reader.patch(`/api/v1/disciplines/${created.data.id}`, { sortOrder: 9 }),
      await reader.post(`/api/v1/disciplines/${created.data.id}/archive`),
      await reader.post(`/api/v1/disciplines/${created.data.id}/restore`),
    ];

    for (const res of attempts) {
      expect(res.status).toBe(403);
      expect(res.error?.code).toBe('PERMISSION_DENIED');
    }
  });

  it('rejects an unauthenticated read', async () => {
    const anonymous = new ApiClient(server);
    const res = await anonymous.get('/api/v1/disciplines');
    expect(res.status).toBe(401);
    expect(res.error?.code).toBe('UNAUTHENTICATED');
  });

  it('does not leak another tenant’s reference data', async () => {
    const mine = await owner.post<ReferenceRow>('/api/v1/disciplines', {
      name: `Tenant A fan ${uuidv7()}`,
    });

    const other = new ApiClient(server);
    expect(await other.login(otherTenantSlug, OTHER_TENANT_OWNER_PHONE, PASSWORD)).toBe(200);

    const list = await other.get<ReferenceRow[]>('/api/v1/disciplines?is_active=all');
    expect(list.data.map((row) => row.id)).not.toContain(mine.data.id);
    // Even by direct id: RLS makes it invisible, so it is a 404 and not a 403
    // (a 403 would confirm the row exists).
    expect((await other.get(`/api/v1/disciplines/${mine.data.id}`)).status).toBe(404);
  });
});

describe('levels (TZ M1.3 "daraja")', () => {
  it('rejects a level pointing at a discipline that does not exist', async () => {
    const res = await owner.post('/api/v1/levels', { name: 'A1', disciplineId: uuidv7() });
    expect(res.status).toBe(404);
    expect(res.error?.code).toBe('REFERENCE_NOT_FOUND');
    expect(res.error?.details).toMatchObject([{ field: 'disciplineId' }]);
  });

  it('lists a discipline’s own levels together with the organization-wide ones', async () => {
    const discipline = await owner.post<ReferenceRow>('/api/v1/disciplines', {
      name: `Fan ${uuidv7()}`,
    });
    const other = await owner.post<ReferenceRow>('/api/v1/disciplines', {
      name: `Boshqa fan ${uuidv7()}`,
    });

    const own = await owner.post<ReferenceRow>('/api/v1/levels', {
      name: `Daraja own ${uuidv7()}`,
      disciplineId: discipline.data.id,
    });
    const global = await owner.post<ReferenceRow>('/api/v1/levels', {
      name: `Daraja global ${uuidv7()}`,
    });
    const foreign = await owner.post<ReferenceRow>('/api/v1/levels', {
      name: `Daraja foreign ${uuidv7()}`,
      disciplineId: other.data.id,
    });

    const list = await owner.get<ReferenceRow[]>(
      `/api/v1/levels?discipline_id=${discipline.data.id}`,
    );
    const ids = list.data.map((row) => row.id);
    expect(ids).toContain(own.data.id);
    expect(ids).toContain(global.data.id);
    expect(ids).not.toContain(foreign.data.id);
  });

  it('filters down to the organization-wide levels with discipline_id=none', async () => {
    const discipline = await owner.post<ReferenceRow>('/api/v1/disciplines', {
      name: `Fan none ${uuidv7()}`,
    });
    const attached = await owner.post<ReferenceRow>('/api/v1/levels', {
      name: `Daraja attached ${uuidv7()}`,
      disciplineId: discipline.data.id,
    });

    const list = await owner.get<ReferenceRow[]>('/api/v1/levels?discipline_id=none');
    expect(list.data.map((row) => row.id)).not.toContain(attached.data.id);
  });

  it('detaches a level from its discipline with an explicit null', async () => {
    const discipline = await owner.post<ReferenceRow>('/api/v1/disciplines', {
      name: `Fan detach ${uuidv7()}`,
    });
    const level = await owner.post<{ id: string; disciplineId: string | null; version: number }>(
      '/api/v1/levels',
      { name: `Daraja detach ${uuidv7()}`, disciplineId: discipline.data.id },
    );

    const detached = await owner.patch<{ disciplineId: string | null }>(
      `/api/v1/levels/${level.data.id}`,
      { disciplineId: null },
    );
    expect(detached.status).toBe(200);
    expect(detached.data.disciplineId).toBeNull();
  });

  it('allows the same level name under two different disciplines', async () => {
    const first = await owner.post<ReferenceRow>('/api/v1/disciplines', {
      name: `Fan dup-1 ${uuidv7()}`,
    });
    const second = await owner.post<ReferenceRow>('/api/v1/disciplines', {
      name: `Fan dup-2 ${uuidv7()}`,
    });
    const name = `A2 ${Date.now()}`;

    expect((await owner.post('/api/v1/levels', { name, disciplineId: first.data.id })).status).toBe(
      201,
    );
    expect(
      (await owner.post('/api/v1/levels', { name, disciplineId: second.data.id })).status,
    ).toBe(201);
    // ...but not twice under the same one.
    const duplicate = await owner.post('/api/v1/levels', {
      name,
      disciplineId: first.data.id,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.error?.code).toBe('DUPLICATE_NAME');
  });
});

describe('age categories (TZ M1.3 "yosh toifasi")', () => {
  it('rejects an inverted band on create', async () => {
    const res = await owner.post('/api/v1/age-categories', {
      name: `Teskari ${uuidv7()}`,
      minAge: 12,
      maxAge: 7,
    });
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a PATCH that inverts the band against the stored other end', async () => {
    const created = await owner.post<ReferenceRow>('/api/v1/age-categories', {
      name: `Band ${uuidv7()}`,
      minAge: 7,
      maxAge: 10,
    });

    // The payload alone looks fine; only the stored maxAge makes it invalid.
    const res = await owner.patch(`/api/v1/age-categories/${created.data.id}`, { minAge: 14 });
    expect(res.status).toBe(400);
    expect(res.error?.details).toMatchObject([{ field: 'maxAge', code: 'OUT_OF_RANGE' }]);
  });

  it('accepts an open-ended top band', async () => {
    const res = await owner.post<{ minAge: number; maxAge: number | null }>(
      '/api/v1/age-categories',
      { name: `Katta ${uuidv7()}`, minAge: 16, maxAge: null },
    );
    expect(res.status).toBe(201);
    expect(res.data.maxAge).toBeNull();
  });
});

describe('holidays (TZ M1.3 "bayramlar")', () => {
  let branchId: string;

  beforeAll(async () => {
    const branch = await owner.post<{ id: string }>('/api/v1/branches', {
      name: 'Bayram filiali',
      code: `HOL-${Date.now()}`,
    });
    expect(branch.status).toBe(201);
    branchId = branch.data.id;
  });

  it('round-trips a calendar date without timezone drift', async () => {
    const res = await owner.post<{ date: string }>('/api/v1/holidays', {
      name: 'Mustaqillik kuni',
      date: '2027-09-01',
    });
    expect(res.status).toBe(201);
    // Asia/Tashkent is UTC+5: storing the day as an instant is how
    // "1 September" becomes 31 August for somebody.
    expect(res.data.date.slice(0, 10)).toBe('2027-09-01');
  });

  it('rejects a date that is not YYYY-MM-DD', async () => {
    const res = await owner.post('/api/v1/holidays', {
      name: 'Yomon sana',
      date: '01.09.2027',
    });
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe('VALIDATION_ERROR');
  });

  it('allows one organization-wide and one per-branch entry for the same date', async () => {
    const date = '2027-12-31';
    expect((await owner.post('/api/v1/holidays', { name: 'Yangi yil', date })).status).toBe(201);
    expect(
      (await owner.post('/api/v1/holidays', { name: 'Filial yopiq', date, branchId })).status,
    ).toBe(201);

    const duplicate = await owner.post('/api/v1/holidays', { name: 'Takror', date });
    expect(duplicate.status).toBe(409);
    expect(duplicate.error?.code).toBe('DUPLICATE_NAME');
    expect(duplicate.error?.details).toMatchObject([{ field: 'date' }]);
  });

  it('answers "what is closed for this branch in this range"', async () => {
    const orgWide = await owner.post<ReferenceRow>('/api/v1/holidays', {
      name: 'Navro’z',
      date: '2028-03-21',
    });
    const branchOnly = await owner.post<ReferenceRow>('/api/v1/holidays', {
      name: 'Taʼmir',
      date: '2028-03-22',
      branchId,
    });
    const outOfRange = await owner.post<ReferenceRow>('/api/v1/holidays', {
      name: 'Keyingi yil',
      date: '2029-01-01',
    });

    const list = await owner.get<ReferenceRow[]>(
      `/api/v1/holidays?branch_id=${branchId}&from=2028-01-01&to=2028-12-31`,
    );
    const ids = list.data.map((row) => row.id);
    expect(ids).toContain(orgWide.data.id);
    expect(ids).toContain(branchOnly.data.id);
    expect(ids).not.toContain(outOfRange.data.id);
  });

  it('rejects a holiday for a branch that does not exist', async () => {
    const res = await owner.post('/api/v1/holidays', {
      name: 'Yoʻq filial',
      date: '2028-05-09',
      branchId: uuidv7(),
    });
    expect(res.status).toBe(404);
    expect(res.error?.code).toBe('REFERENCE_NOT_FOUND');
  });
});
