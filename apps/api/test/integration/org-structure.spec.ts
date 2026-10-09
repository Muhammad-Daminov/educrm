import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { uuidv7 } from '@educrm/shared';
import { findOrCreateTenant, seedOwnerUser } from '../../src/auth/seed-owner';
import { startAuthTestApp, type AuthTestApp } from './auth-setup';
import { ApiClient } from './api-client';

/**
 * T05 organization structure over real HTTP: branches (TZ M1.1) and
 * classrooms (TZ M1.2). The shared CRUD policy — archive-never-delete,
 * If-Match, audit, list envelope — is covered in reference-data.spec.ts;
 * this file covers what is specific to these two: branch codes, timezones,
 * room naming per branch, and the branch filter.
 */

interface BranchRow {
  id: string;
  name: string;
  code: string;
  timezone: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  version: number;
}

interface ClassroomRow {
  id: string;
  branchId: string;
  name: string;
  capacity: number | null;
  equipment: string | null;
  isActive: boolean;
  version: number;
}

const PASSWORD = 'correct-password-1';
const OWNER_PHONE = '+998901111111';
/** Can read reference data and branches, but manages neither. */
const VIEWER_PHONE = '+998907777777';

let testApp: AuthTestApp;
let server: Server;
let seedPrisma: PrismaClient;
let tenantId: string;
let owner: ApiClient;
let viewer: ApiClient;

beforeAll(async () => {
  testApp = await startAuthTestApp();
  server = testApp.app.getHttpServer() as Server;
  seedPrisma = new PrismaClient({ datasources: { db: { url: testApp.appUserUrl } } });

  const slug = `org-tenant-${Date.now()}`;
  const tenant = await findOrCreateTenant(testApp.migratorUrl, slug);
  tenantId = tenant.id;

  await seedOwnerUser(seedPrisma, tenantId, {
    fullName: 'Org Owner',
    phone: OWNER_PHONE,
    password: PASSWORD,
  });

  await seedPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
    const role = await tx.role.create({
      data: { id: uuidv7(), tenantId, code: 'viewer', name: 'Viewer', isSystem: false },
    });
    await tx.rolePermission.createMany({
      data: ['branch.view', 'reference.view'].map((code) => ({
        id: uuidv7(),
        tenantId,
        roleId: role.id,
        permissionCode: code,
        scope: 'all' as const,
      })),
    });
    const user = await tx.user.create({
      data: {
        id: uuidv7(),
        tenantId,
        fullName: 'Org Viewer',
        phone: VIEWER_PHONE,
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      },
    });
    await tx.userRole.create({
      data: { id: uuidv7(), tenantId, userId: user.id, roleId: role.id },
    });
  });

  owner = new ApiClient(server);
  expect(await owner.login(slug, OWNER_PHONE, PASSWORD)).toBe(200);
  viewer = new ApiClient(server);
  expect(await viewer.login(slug, VIEWER_PHONE, PASSWORD)).toBe(200);
}, 180_000);

afterAll(async () => {
  await seedPrisma.$disconnect();
  await testApp.stop();
}, 60_000);

/**
 * uuidv7 is timestamp-prefixed, so ids minted in the same millisecond share
 * a prefix — a code sliced from one collides on (tenant_id, code). A
 * counter is what makes each branch distinct.
 */
let branchCounter = 0;
function newBranch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  branchCounter += 1;
  return {
    name: `Filial ${branchCounter} ${uuidv7()}`,
    code: `B-${branchCounter}-${Date.now()}`,
    ...overrides,
  };
}

describe('branches (TZ M1.1)', () => {
  it('defaults the timezone to Asia/Tashkent', async () => {
    const res = await owner.post<BranchRow>('/api/v1/branches', newBranch());
    expect(res.status).toBe(201);
    expect(res.data.timezone).toBe('Asia/Tashkent');
    expect(res.data.isActive).toBe(true);
  });

  it('rejects a timezone that is not a real IANA zone', async () => {
    // Every lesson time in TZ M4 is read in the branch's zone, so a typo
    // here would shift a whole branch's schedule silently.
    const res = await owner.post('/api/v1/branches', newBranch({ timezone: 'Asia/Tashkient' }));
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe('VALIDATION_ERROR');

    const ok = await owner.post<BranchRow>(
      '/api/v1/branches',
      newBranch({ timezone: 'Europe/Moscow' }),
    );
    expect(ok.status).toBe(201);
    expect(ok.data.timezone).toBe('Europe/Moscow');
  });

  it('refuses a duplicate code, and says which field', async () => {
    const code = `DUP-${Date.now()}`;
    expect((await owner.post('/api/v1/branches', newBranch({ code }))).status).toBe(201);

    const res = await owner.post('/api/v1/branches', newBranch({ code }));
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('DUPLICATE_NAME');
    expect(res.error?.details).toMatchObject([{ field: 'code', code: 'DUPLICATE' }]);
  });

  it('lets a branch keep its own code through a PATCH', async () => {
    const created = await owner.post<BranchRow>('/api/v1/branches', newBranch());
    const res = await owner.patch<BranchRow>(`/api/v1/branches/${created.data.id}`, {
      name: 'Qayta nomlangan filial',
      code: created.data.code,
    });
    expect(res.status).toBe(200);
    expect(res.data.name).toBe('Qayta nomlangan filial');
  });

  it('clears an optional field with an explicit null', async () => {
    const created = await owner.post<BranchRow>(
      '/api/v1/branches',
      newBranch({ address: 'Chilonzor 5', phone: '+998711234567' }),
    );
    const res = await owner.patch<BranchRow>(`/api/v1/branches/${created.data.id}`, {
      address: null,
    });
    expect(res.data.address).toBeNull();
    // Untouched fields stay untouched — a PATCH is not a PUT.
    expect(res.data.phone).toBe('+998711234567');
  });

  it('archives a branch instead of deleting it (TZ M1.1 SHART)', async () => {
    const created = await owner.post<BranchRow>('/api/v1/branches', newBranch());
    const archived = await owner.post<BranchRow>(
      `/api/v1/branches/${created.data.id}/archive`,
      undefined,
      { 'if-match': String(created.data.version) },
    );
    expect(archived.status).toBe(200);
    expect(archived.data.isActive).toBe(false);

    const defaultList = await owner.get<BranchRow[]>('/api/v1/branches');
    expect(defaultList.data.map((row) => row.id)).not.toContain(created.data.id);

    // Still fetchable by id: historical financial records point at it.
    expect((await owner.get(`/api/v1/branches/${created.data.id}`)).status).toBe(200);
    expect(
      (await owner.post<BranchRow>(`/api/v1/branches/${created.data.id}/restore`)).data.isActive,
    ).toBe(true);
  });

  it('separates view from manage permissions', async () => {
    const created = await owner.post<BranchRow>('/api/v1/branches', newBranch());

    expect((await viewer.get('/api/v1/branches')).status).toBe(200);
    expect((await viewer.post('/api/v1/branches', newBranch())).status).toBe(403);
    expect((await viewer.patch(`/api/v1/branches/${created.data.id}`, { name: 'X' })).status).toBe(
      403,
    );
    expect((await viewer.post(`/api/v1/branches/${created.data.id}/archive`)).status).toBe(403);
  });
});

describe('classrooms (TZ M1.2)', () => {
  let branchOne: string;
  let branchTwo: string;

  beforeAll(async () => {
    const first = await owner.post<BranchRow>(
      '/api/v1/branches',
      newBranch({ name: 'Xona test 1' }),
    );
    const second = await owner.post<BranchRow>(
      '/api/v1/branches',
      newBranch({ name: 'Xona test 2' }),
    );
    branchOne = first.data.id;
    branchTwo = second.data.id;
  });

  it('creates a room with capacity and equipment', async () => {
    const res = await owner.post<ClassroomRow>('/api/v1/classrooms', {
      branchId: branchOne,
      name: `Xona ${uuidv7()}`,
      capacity: 12,
      equipment: 'Proyektor, doska',
    });
    expect(res.status).toBe(201);
    expect(res.data.capacity).toBe(12);
    expect(res.data.branchId).toBe(branchOne);
  });

  it('rejects a non-positive capacity', async () => {
    const res = await owner.post('/api/v1/classrooms', {
      branchId: branchOne,
      name: 'Xona 0',
      capacity: 0,
    });
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a room in a branch that does not exist', async () => {
    const res = await owner.post('/api/v1/classrooms', {
      branchId: uuidv7(),
      name: 'Xona 404',
    });
    expect(res.status).toBe(404);
    expect(res.error?.code).toBe('REFERENCE_NOT_FOUND');
    expect(res.error?.details).toMatchObject([{ field: 'branchId' }]);
  });

  it('scopes the room name to its branch: every branch has a 204', async () => {
    expect(
      (await owner.post('/api/v1/classrooms', { branchId: branchOne, name: 'Xona 204' })).status,
    ).toBe(201);
    expect(
      (await owner.post('/api/v1/classrooms', { branchId: branchTwo, name: 'Xona 204' })).status,
    ).toBe(201);

    // ...but not twice in the same branch, not even spelled differently.
    const duplicate = await owner.post('/api/v1/classrooms', {
      branchId: branchOne,
      name: '  xona   204 ',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.error?.code).toBe('DUPLICATE_NAME');
  });

  it('filters by branch', async () => {
    const inOne = await owner.post<ClassroomRow>('/api/v1/classrooms', {
      branchId: branchOne,
      name: `Filtr bir ${uuidv7()}`,
    });
    const inTwo = await owner.post<ClassroomRow>('/api/v1/classrooms', {
      branchId: branchTwo,
      name: `Filtr ikki ${uuidv7()}`,
    });

    const list = await owner.get<ClassroomRow[]>(`/api/v1/classrooms?branch_id=${branchOne}`);
    const ids = list.data.map((row) => row.id);
    expect(ids).toContain(inOne.data.id);
    expect(ids).not.toContain(inTwo.data.id);
    expect(list.data.every((row) => row.branchId === branchOne)).toBe(true);
  });

  it('does not accept a branch change through PATCH', async () => {
    // Moving a room between branches would relocate every lesson ever
    // taught in it; the DTO has no branchId on purpose.
    const created = await owner.post<ClassroomRow>('/api/v1/classrooms', {
      branchId: branchOne,
      name: `Koʻchmas ${uuidv7()}`,
    });
    const res = await owner.patch<ClassroomRow>(`/api/v1/classrooms/${created.data.id}`, {
      branchId: branchTwo,
    });
    // Unknown key with nothing else to apply: the body has no updatable
    // field, so it is a validation error rather than a silent no-op.
    expect(res.status).toBe(400);

    const unchanged = await owner.get<ClassroomRow>(`/api/v1/classrooms/${created.data.id}`);
    expect(unchanged.data.branchId).toBe(branchOne);
  });

  it('clears capacity and equipment with an explicit null', async () => {
    const created = await owner.post<ClassroomRow>('/api/v1/classrooms', {
      branchId: branchOne,
      name: `Tozalash ${uuidv7()}`,
      capacity: 10,
      equipment: 'Doska',
    });
    const res = await owner.patch<ClassroomRow>(`/api/v1/classrooms/${created.data.id}`, {
      capacity: null,
      equipment: null,
    });
    expect(res.data.capacity).toBeNull();
    expect(res.data.equipment).toBeNull();
  });

  it('needs classroom.manage to write and reference.view to read', async () => {
    const created = await owner.post<ClassroomRow>('/api/v1/classrooms', {
      branchId: branchOne,
      name: `Ruxsat ${uuidv7()}`,
    });

    expect((await viewer.get('/api/v1/classrooms')).status).toBe(200);
    expect(
      (await viewer.post('/api/v1/classrooms', { branchId: branchOne, name: 'Yangi xona' })).status,
    ).toBe(403);
    expect(
      (await viewer.patch(`/api/v1/classrooms/${created.data.id}`, { capacity: 5 })).status,
    ).toBe(403);
  });
});
