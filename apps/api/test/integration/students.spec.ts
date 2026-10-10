import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { findOrCreateTenant, seedOwnerUser } from '../../src/auth/seed-owner';
import { startAuthTestApp, type AuthTestApp } from './auth-setup';
import { ApiClient } from './api-client';

/**
 * TZ M3 students over real HTTP: creation (client + phone + student in one
 * go), duplicate-phone detection, contact persons, and the archive/restore
 * BR-S2/BR-S3 carve out.
 */

interface StudentView {
  id: string;
  clientId: string;
  branchId: string;
  fullName: string;
  status: string;
  isActive: boolean;
  version: number;
  cachedBalance: string;
  phones?: { id: string; phone: string; isPrimary: boolean }[];
  contactPersons?: { id: string; fullName: string; relation: string }[];
}

const PASSWORD = 'correct-password-1';
const EMPLOYEE_PASSWORD = 'employee-password-1';
const OWNER_PHONE = '+998902222222';

let testApp: AuthTestApp;
let server: Server;
let seedPrisma: PrismaClient;
let tenantId: string;
let tenantSlug: string;
let owner: ApiClient;
let branchId: string;

let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `+99891${String(1000000 + phoneCounter).slice(0, 7)}`;
}

function newStudent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fullName: `Oʻquvchi ${uuidv7()}`,
    phone: nextPhone(),
    branchId,
    ...overrides,
  };
}

beforeAll(async () => {
  testApp = await startAuthTestApp();
  server = testApp.app.getHttpServer() as Server;
  seedPrisma = new PrismaClient({ datasources: { db: { url: testApp.appUserUrl } } });

  tenantSlug = `student-tenant-${Date.now()}`;
  const tenant = await findOrCreateTenant(testApp.migratorUrl, tenantSlug);
  tenantId = tenant.id;
  await seedOwnerUser(seedPrisma, tenantId, {
    fullName: 'Student Owner',
    phone: OWNER_PHONE,
    password: PASSWORD,
  });

  owner = new ApiClient(server);
  expect(await owner.login(tenantSlug, OWNER_PHONE, PASSWORD)).toBe(200);

  const branch = await owner.post<{ id: string }>('/api/v1/branches', {
    name: 'Oʻquvchilar filiali',
    code: `STU-${Date.now()}`,
  });
  branchId = branch.data.id;
}, 180_000);

afterAll(async () => {
  await seedPrisma.$disconnect();
  await testApp.stop();
}, 60_000);

describe('student creation (TZ M3)', () => {
  it('creates the client, phone and student together', async () => {
    const res = await owner.post<StudentView>('/api/v1/students', newStudent());
    expect(res.status).toBe(201);
    expect(res.data.status).toBe('no_enrollment');
    expect(res.data.isActive).toBe(true);
    expect(res.data.cachedBalance).toBe('0');
    expect(res.data.phones).toHaveLength(1);
    expect(res.data.phones?.[0]?.isPrimary).toBe(true);
  });

  it('normalizes the phone to +998XXXXXXXXX', async () => {
    const res = await owner.post<StudentView>(
      '/api/v1/students',
      newStudent({ phone: '91 234-56-78' }),
    );
    expect(res.status).toBe(201);
    expect(res.data.phones?.[0]?.phone).toBe('+998912345678');
  });

  it('rejects an invalid phone', async () => {
    const res = await owner.post('/api/v1/students', newStudent({ phone: '+1234567890123' }));
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('INVALID_PHONE');
  });

  it('rejects a branch that does not exist', async () => {
    const res = await owner.post('/api/v1/students', newStudent({ branchId: uuidv7() }));
    expect(res.status).toBe(404);
    expect(res.error?.details).toMatchObject([{ field: 'branchId' }]);
  });

  describe('duplicate phone detection (TZ M3.2 SHART)', () => {
    it('warns with the existing client/student on a repeat phone', async () => {
      const phone = nextPhone();
      const first = await owner.post<StudentView>('/api/v1/students', newStudent({ phone }));
      expect(first.status).toBe(201);

      const second = await owner.post('/api/v1/students', newStudent({ phone }));
      expect(second.status).toBe(409);
      expect(second.error?.code).toBe('DUPLICATE_PHONE');
      expect(second.error?.details).toMatchObject([
        { field: 'phone', student_id: first.data.id },
      ]);
    });

    it('the check-phone endpoint answers the same question without creating anything', async () => {
      const phone = nextPhone();
      const miss = await owner.get<unknown>(`/api/v1/students/check-phone?phone=${encodeURIComponent(phone)}`);
      expect(miss.data).toBeNull();

      const created = await owner.post<StudentView>('/api/v1/students', newStudent({ phone }));
      const hit = await owner.get<{ studentId: string | null }>(
        `/api/v1/students/check-phone?phone=${encodeURIComponent(phone)}`,
      );
      expect(hit.data.studentId).toBe(created.data.id);
    });

    it('force:true creates a second student with the same phone anyway', async () => {
      const phone = nextPhone();
      await owner.post<StudentView>('/api/v1/students', newStudent({ phone }));
      const forced = await owner.post<StudentView>(
        '/api/v1/students',
        newStudent({ phone, force: true }),
      );
      expect(forced.status).toBe(201);
    });
  });
});

describe('listing and filters', () => {
  it('filters by branch and searches by name', async () => {
    const created = await owner.post<StudentView>(
      '/api/v1/students',
      newStudent({ fullName: `Gʻaniyev Aziz ${Date.now()}` }),
    );

    const byBranch = await owner.get<StudentView[]>(`/api/v1/students?branch_id=${branchId}`);
    expect(byBranch.data.map((row) => row.id)).toContain(created.data.id);

    const found = await owner.get<StudentView[]>('/api/v1/students?q=ganiyev');
    expect(found.data.map((row) => row.id)).toContain(created.data.id);
  });

  it('searches by phone', async () => {
    const phone = nextPhone();
    const created = await owner.post<StudentView>('/api/v1/students', newStudent({ phone }));
    const found = await owner.get<StudentView[]>(
      `/api/v1/students?q=${encodeURIComponent(phone.slice(0, 8))}`,
    );
    expect(found.data.map((row) => row.id)).toContain(created.data.id);
  });
});

describe('archive / restore (BR-S2, BR-S3)', () => {
  it('archives instead of deleting, and hides it from the default list', async () => {
    const created = await owner.post<StudentView>('/api/v1/students', newStudent());
    const archived = await owner.post<StudentView>(`/api/v1/students/${created.data.id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.data.status).toBe('archived');
    expect(archived.data.isActive).toBe(false);

    const active = await owner.get<StudentView[]>('/api/v1/students');
    expect(active.data.map((row) => row.id)).not.toContain(created.data.id);

    const all = await owner.get<StudentView[]>('/api/v1/students?is_active=false');
    expect(all.data.map((row) => row.id)).toContain(created.data.id);
  });

  it('restores to no_enrollment', async () => {
    const created = await owner.post<StudentView>('/api/v1/students', newStudent());
    await owner.post(`/api/v1/students/${created.data.id}/archive`);
    const restored = await owner.post<StudentView>(`/api/v1/students/${created.data.id}/restore`);
    expect(restored.data.status).toBe('no_enrollment');
    expect(restored.data.isActive).toBe(true);
  });
});

describe('contact persons', () => {
  it('creates, updates and deletes a contact person', async () => {
    const created = await owner.post<StudentView>('/api/v1/students', newStudent());

    const contact = await owner.post<{ id: string; version: number }>(
      `/api/v1/students/${created.data.id}/contact-persons`,
      { fullName: 'Ona Fatima', relation: 'ona', phone: nextPhone() },
    );
    expect(contact.status).toBe(201);

    const updated = await owner.patch<{ fullName: string }>(
      `/api/v1/students/${created.data.id}/contact-persons/${contact.data.id}`,
      { fullName: 'Fatima Karimova' },
      { 'if-match': String(contact.data.version) },
    );
    expect(updated.data.fullName).toBe('Fatima Karimova');

    const withContacts = await owner.get<StudentView>(`/api/v1/students/${created.data.id}`);
    expect(withContacts.data.contactPersons).toHaveLength(1);

    const deleted = await owner.delete(
      `/api/v1/students/${created.data.id}/contact-persons/${contact.data.id}`,
    );
    expect(deleted.status).toBe(200);

    const after = await owner.get<StudentView>(`/api/v1/students/${created.data.id}`);
    expect(after.data.contactPersons).toHaveLength(0);
  });
});

describe('contact field visibility (TZ M11.2)', () => {
  it('hides phones and contact persons from a caller without student.view_contacts', async () => {
    // sales_manager holds student.view but not student.view_contacts.
    const phone = nextPhone();
    const created = await owner.post<StudentView>(
      '/api/v1/employees',
      { fullName: 'Sotuv Menejeri', phone, password: EMPLOYEE_PASSWORD, roleCodes: ['sales_manager'] },
    );
    expect(created.status).toBe(201);

    const salesManager = new ApiClient(server);
    expect(await salesManager.login(tenantSlug, phone, EMPLOYEE_PASSWORD)).toBe(200);

    const student = await owner.post<StudentView>('/api/v1/students', newStudent());
    const seenBySales = await salesManager.get<StudentView>(`/api/v1/students/${student.data.id}`);
    expect(seenBySales.status).toBe(200);
    expect(seenBySales.data.phones).toBeUndefined();
    expect(seenBySales.data.contactPersons).toBeUndefined();

    const seenByOwner = await owner.get<StudentView>(`/api/v1/students/${student.data.id}`);
    expect(seenByOwner.data.phones).toBeDefined();
  });
});

describe('optimistic locking', () => {
  it('enforces If-Match like every other endpoint', async () => {
    const created = await owner.post<StudentView>('/api/v1/students', newStudent());
    const { id, version } = created.data;

    const ok = await owner.patch<StudentView>(
      `/api/v1/students/${id}`,
      { fullName: 'Yangi ism' },
      { 'if-match': String(version) },
    );
    expect(ok.data.version).toBe(version + 1);

    const stale = await owner.patch(
      `/api/v1/students/${id}`,
      { fullName: 'Ikkinchi ism' },
      { 'if-match': String(version) },
    );
    expect(stale.status).toBe(409);
    expect(stale.error?.code).toBe('VERSION_CONFLICT');
  });
});

describe('permissions', () => {
  it('teacher cannot create or view students', async () => {
    const phone = nextPhone();
    const created = await owner.post(
      '/api/v1/employees',
      { fullName: 'Oqituvchi', phone, password: EMPLOYEE_PASSWORD, roleCodes: ['teacher'] },
    );
    expect(created.status).toBe(201);

    const teacher = new ApiClient(server);
    expect(await teacher.login(tenantSlug, phone, EMPLOYEE_PASSWORD)).toBe(200);
    expect((await teacher.get('/api/v1/students')).status).toBe(403);
    expect((await teacher.post('/api/v1/students', newStudent())).status).toBe(403);
  });
});
