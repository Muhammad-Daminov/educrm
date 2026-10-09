import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Client as PgClient } from 'pg';
import { uuidv7 } from '@educrm/shared';
import { findOrCreateTenant, seedOwnerUser } from '../../src/auth/seed-owner';
import { startAuthTestApp, type AuthTestApp } from './auth-setup';
import { ApiClient } from './api-client';

/**
 * TZ M1.4 employees over real HTTP: creation with roles and branches, the
 * teacher profile, and the deactivation that must also end every session.
 */

interface EmployeeView {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  version: number;
  roles: { code: string; name: string }[];
  branches: { id: string; name: string }[];
  teacherProfile: {
    id: string;
    notes: string | null;
    disciplineIds: string[];
    levelIds: string[];
  } | null;
}

interface RoleView {
  id: string;
  code: string;
  name: string;
}

const PASSWORD = 'correct-password-1';
const EMPLOYEE_PASSWORD = 'employee-password-1';
const OWNER_PHONE = '+998901111111';

let testApp: AuthTestApp;
let server: Server;
let seedPrisma: PrismaClient;
let tenantId: string;
let tenantSlug: string;
let owner: ApiClient;
let branchId: string;
let disciplineId: string;
let levelId: string;

let phoneCounter = 0;
/**
 * A distinct Uzbek mobile number per employee. Not derived from a uuid:
 * uuidv7 is timestamp-prefixed, so two minted in the same millisecond
 * collide on (tenant_id, phone).
 */
function nextPhone(): string {
  phoneCounter += 1;
  return `+99890${String(1000000 + phoneCounter).slice(0, 7)}`;
}

function newEmployee(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fullName: `Xodim ${uuidv7()}`,
    phone: nextPhone(),
    password: EMPLOYEE_PASSWORD,
    ...overrides,
  };
}

async function sessionCount(userId: string): Promise<{ total: number; live: number }> {
  const pg = new PgClient({ connectionString: testApp.migratorUrl });
  await pg.connect();
  try {
    await pg.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
    const result = await pg.query<{ total: string; live: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE revoked_at IS NULL)::text AS live
         FROM sessions WHERE user_id = $1`,
      [userId],
    );
    return {
      total: Number(result.rows[0]?.total ?? '0'),
      live: Number(result.rows[0]?.live ?? '0'),
    };
  } finally {
    await pg.end();
  }
}

async function auditActions(entityId: string): Promise<string[]> {
  const pg = new PgClient({ connectionString: testApp.migratorUrl });
  await pg.connect();
  try {
    await pg.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
    const result = await pg.query<{ action: string }>(
      'SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY occurred_at',
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

  tenantSlug = `emp-tenant-${Date.now()}`;
  const tenant = await findOrCreateTenant(testApp.migratorUrl, tenantSlug);
  tenantId = tenant.id;
  await seedOwnerUser(seedPrisma, tenantId, {
    fullName: 'Employee Owner',
    phone: OWNER_PHONE,
    password: PASSWORD,
  });

  owner = new ApiClient(server);
  expect(await owner.login(tenantSlug, OWNER_PHONE, PASSWORD)).toBe(200);

  const branch = await owner.post<{ id: string }>('/api/v1/branches', {
    name: 'Xodimlar filiali',
    code: `EMP-${Date.now()}`,
  });
  branchId = branch.data.id;
  const discipline = await owner.post<{ id: string }>('/api/v1/disciplines', {
    name: `Ingliz tili ${uuidv7()}`,
  });
  disciplineId = discipline.data.id;
  const level = await owner.post<{ id: string }>('/api/v1/levels', {
    name: `A1 ${uuidv7()}`,
    disciplineId,
  });
  levelId = level.data.id;
}, 180_000);

afterAll(async () => {
  await seedPrisma.$disconnect();
  await testApp.stop();
}, 60_000);

describe('employee creation (TZ M1.4)', () => {
  it('creates an account with roles and branches in one go', async () => {
    const res = await owner.post<EmployeeView>(
      '/api/v1/employees',
      newEmployee({ roleCodes: ['teacher'], branchIds: [branchId] }),
    );

    expect(res.status).toBe(201);
    expect(res.data.isActive).toBe(true);
    expect(res.data.roles.map((role) => role.code)).toEqual(['teacher']);
    expect(res.data.branches.map((branch) => branch.id)).toEqual([branchId]);
    expect(res.data.teacherProfile).toBeNull();
  });

  it('never returns the password hash', async () => {
    const res = await owner.post<EmployeeView & Record<string, unknown>>(
      '/api/v1/employees',
      newEmployee(),
    );
    expect(Object.keys(res.data)).not.toContain('passwordHash');
    expect(JSON.stringify(res.data)).not.toContain('$argon2');

    const fetched = await owner.get<Record<string, unknown>>(`/api/v1/employees/${res.data.id}`);
    expect(Object.keys(fetched.data)).not.toContain('passwordHash');
  });

  it('keeps the password hash out of the audit trail too', async () => {
    const created = await owner.post<EmployeeView>('/api/v1/employees', newEmployee());

    const pg = new PgClient({ connectionString: testApp.migratorUrl });
    await pg.connect();
    try {
      await pg.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
      const result = await pg.query<{ diff: unknown }>(
        'SELECT diff FROM audit_log WHERE entity_id = $1',
        [created.data.id],
      );
      const serialized = JSON.stringify(result.rows);
      expect(serialized).not.toContain('$argon2');
      expect(serialized).toContain('fullName');
    } finally {
      await pg.end();
    }
  });

  it('lets the new employee log in with the password that was set', async () => {
    const phone = nextPhone();
    const created = await owner.post<EmployeeView>(
      '/api/v1/employees',
      newEmployee({ phone, roleCodes: ['administrator'] }),
    );
    expect(created.status).toBe(201);

    const newcomer = new ApiClient(server);
    expect(await newcomer.login(tenantSlug, phone, EMPLOYEE_PASSWORD)).toBe(200);
    const me = await newcomer.get<{ user: { id: string } }>('/api/v1/auth/me');
    expect(me.data.user.id).toBe(created.data.id);
  });

  it('normalizes the phone to +998XXXXXXXXX, which is how login looks it up', async () => {
    const res = await owner.post<EmployeeView>(
      '/api/v1/employees',
      newEmployee({ phone: '90 123-45-67' }),
    );
    expect(res.status).toBe(201);
    expect(res.data.phone).toBe('+998901234567');

    // The same human number in another format is the same account.
    const duplicate = await owner.post('/api/v1/employees', newEmployee({ phone: '901234567' }));
    expect(duplicate.status).toBe(409);
    expect(duplicate.error?.code).toBe('DUPLICATE_NAME');
    expect(duplicate.error?.details).toMatchObject([{ field: 'phone' }]);
  });

  it('requires a phone or an email, because that is the login', async () => {
    const res = await owner.post('/api/v1/employees', {
      fullName: 'Login yoʻq',
      password: EMPLOYEE_PASSWORD,
    });
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a password shorter than the policy allows', async () => {
    const res = await owner.post('/api/v1/employees', newEmployee({ password: 'short' }));
    expect(res.status).toBe(400);
  });

  it('rejects a role or branch that does not exist, and creates nothing', async () => {
    const phone = nextPhone();
    const badRole = await owner.post('/api/v1/employees', {
      ...newEmployee({ phone }),
      roleCodes: ['wizard'],
    });
    expect(badRole.status).toBe(404);
    expect(badRole.error?.details).toMatchObject([{ field: 'roleCodes' }]);

    const badBranch = await owner.post('/api/v1/employees', {
      ...newEmployee({ phone }),
      branchIds: [uuidv7()],
    });
    expect(badBranch.status).toBe(404);
    expect(badBranch.error?.details).toMatchObject([{ field: 'branchIds' }]);

    // The whole create was one transaction, so the phone is still free.
    const retry = await owner.post<EmployeeView>('/api/v1/employees', newEmployee({ phone }));
    expect(retry.status).toBe(201);
  });
});

describe('roles and branches', () => {
  it('replaces the role set and applies it immediately', async () => {
    const phone = nextPhone();
    const created = await owner.post<EmployeeView>(
      '/api/v1/employees',
      newEmployee({ phone, roleCodes: ['teacher'] }),
    );

    const employee = new ApiClient(server);
    expect(await employee.login(tenantSlug, phone, EMPLOYEE_PASSWORD)).toBe(200);
    // A teacher holds no branch.view.
    expect((await employee.get('/api/v1/branches')).status).toBe(403);

    const updated = await owner.put<EmployeeView>(`/api/v1/employees/${created.data.id}/roles`, {
      roleCodes: ['administrator'],
    });
    expect(updated.data.roles.map((role) => role.code)).toEqual(['administrator']);

    // The permission cache is 60s; a role change that waited for it would
    // look broken to whoever just made it.
    expect((await employee.get('/api/v1/branches')).status).toBe(200);
  });

  it('replaces the branch set', async () => {
    const created = await owner.post<EmployeeView>('/api/v1/employees', newEmployee());
    const second = await owner.post<{ id: string }>('/api/v1/branches', {
      name: 'Ikkinchi filial',
      code: `EMP2-${Date.now()}`,
    });

    const withBoth = await owner.put<EmployeeView>(
      `/api/v1/employees/${created.data.id}/branches`,
      { branchIds: [branchId, second.data.id] },
    );
    expect(withBoth.data.branches.map((branch) => branch.id).sort()).toEqual(
      [branchId, second.data.id].sort(),
    );

    const cleared = await owner.put<EmployeeView>(`/api/v1/employees/${created.data.id}/branches`, {
      branchIds: [],
    });
    expect(cleared.data.branches).toEqual([]);
  });

  it('filters the list by role and by branch', async () => {
    const teacher = await owner.post<EmployeeView>(
      '/api/v1/employees',
      newEmployee({ roleCodes: ['teacher'], branchIds: [branchId] }),
    );
    const accountant = await owner.post<EmployeeView>(
      '/api/v1/employees',
      newEmployee({ roleCodes: ['accountant'] }),
    );

    const teachers = await owner.get<EmployeeView[]>('/api/v1/employees?role_code=teacher');
    const ids = teachers.data.map((row) => row.id);
    expect(ids).toContain(teacher.data.id);
    expect(ids).not.toContain(accountant.data.id);

    const inBranch = await owner.get<EmployeeView[]>(`/api/v1/employees?branch_id=${branchId}`);
    expect(inBranch.data.map((row) => row.id)).toContain(teacher.data.id);
    expect(inBranch.data.map((row) => row.id)).not.toContain(accountant.data.id);
  });

  it('searches by name through the TZ 8.5 key', async () => {
    const created = await owner.post<EmployeeView>(
      '/api/v1/employees',
      newEmployee({ fullName: `Gʻafurov Dilshod ${Date.now()}` }),
    );

    const found = await owner.get<EmployeeView[]>('/api/v1/employees?q=gafurov');
    expect(found.data.map((row) => row.id)).toContain(created.data.id);
  });

  it('lists the tenant’s roles for the picker', async () => {
    const res = await owner.get<RoleView[]>('/api/v1/roles');
    expect(res.status).toBe(200);
    expect(res.data.map((role) => role.code)).toContain('teacher');
    expect(res.data.map((role) => role.code)).toContain('owner');
  });
});

describe('teacher profile (TZ M1.4)', () => {
  it('creates the profile on first save and replaces the sets after', async () => {
    const created = await owner.post<EmployeeView>(
      '/api/v1/employees',
      newEmployee({ roleCodes: ['teacher'] }),
    );

    const first = await owner.put<EmployeeView>(
      `/api/v1/employees/${created.data.id}/teacher-profile`,
      { disciplineIds: [disciplineId], levelIds: [levelId], notes: 'Katta guruhlar' },
    );
    expect(first.status).toBe(200);
    expect(first.data.teacherProfile?.disciplineIds).toEqual([disciplineId]);
    expect(first.data.teacherProfile?.levelIds).toEqual([levelId]);
    expect(first.data.teacherProfile?.notes).toBe('Katta guruhlar');

    // A second save is a replacement, not an append.
    const second = await owner.put<EmployeeView>(
      `/api/v1/employees/${created.data.id}/teacher-profile`,
      { disciplineIds: [], levelIds: [] },
    );
    expect(second.data.teacherProfile?.disciplineIds).toEqual([]);
    expect(second.data.teacherProfile?.levelIds).toEqual([]);
    // The profile itself survives, with its notes — only the sets changed.
    expect(second.data.teacherProfile?.id).toBe(first.data.teacherProfile?.id);
    expect(second.data.teacherProfile?.notes).toBe('Katta guruhlar');
  });

  it('rejects a discipline or level that does not exist', async () => {
    const created = await owner.post<EmployeeView>('/api/v1/employees', newEmployee());

    const badDiscipline = await owner.put(`/api/v1/employees/${created.data.id}/teacher-profile`, {
      disciplineIds: [uuidv7()],
      levelIds: [],
    });
    expect(badDiscipline.status).toBe(404);
    expect(badDiscipline.error?.details).toMatchObject([{ field: 'disciplineIds' }]);

    const badLevel = await owner.put(`/api/v1/employees/${created.data.id}/teacher-profile`, {
      disciplineIds: [],
      levelIds: [uuidv7()],
    });
    expect(badLevel.status).toBe(404);
    expect(badLevel.error?.details).toMatchObject([{ field: 'levelIds' }]);
  });
});

describe('deactivation (TZ M1.4 SHART)', () => {
  it('revokes every session and locks out the access token already issued', async () => {
    const phone = nextPhone();
    const created = await owner.post<EmployeeView>(
      '/api/v1/employees',
      newEmployee({ phone, roleCodes: ['administrator'] }),
    );

    const employee = new ApiClient(server);
    expect(await employee.login(tenantSlug, phone, EMPLOYEE_PASSWORD)).toBe(200);
    expect((await employee.get('/api/v1/branches')).status).toBe(200);
    expect((await sessionCount(created.data.id)).live).toBe(1);

    const deactivated = await owner.post<EmployeeView>(
      `/api/v1/employees/${created.data.id}/deactivate`,
    );
    expect(deactivated.status).toBe(200);
    expect(deactivated.data.isActive).toBe(false);

    // "barcha sessiyalar va refresh token'lar bekor qilinadi": the rows
    // stay (reuse detection needs them) but none is live.
    const sessions = await sessionCount(created.data.id);
    expect(sessions.total).toBe(1);
    expect(sessions.live).toBe(0);

    // The access token in the browser is still cryptographically valid for
    // up to 15 minutes; it must stop working anyway.
    const afterward = await employee.get('/api/v1/branches');
    expect(afterward.status).toBe(401);
    expect(afterward.error?.code).toBe('ACCOUNT_DEACTIVATED');

    // And so must the self-service route, which has no catalog permission.
    const me = await employee.get('/api/v1/auth/me');
    expect(me.status).toBe(401);

    // Logging in again is refused by the same generic error as a wrong
    // password (docs/QUESTIONS.md — no account enumeration).
    const relogin = new ApiClient(server);
    expect(await relogin.login(tenantSlug, phone, EMPLOYEE_PASSWORD)).toBe(401);
  });

  it('reactivates, and the employee can log in again', async () => {
    const phone = nextPhone();
    const created = await owner.post<EmployeeView>(
      '/api/v1/employees',
      newEmployee({ phone, roleCodes: ['administrator'] }),
    );
    await owner.post(`/api/v1/employees/${created.data.id}/deactivate`);

    const activated = await owner.post<EmployeeView>(
      `/api/v1/employees/${created.data.id}/activate`,
    );
    expect(activated.data.isActive).toBe(true);

    const employee = new ApiClient(server);
    expect(await employee.login(tenantSlug, phone, EMPLOYEE_PASSWORD)).toBe(200);
    expect((await employee.get('/api/v1/branches')).status).toBe(200);
  });

  it('refuses to deactivate the account making the request', async () => {
    const me = await owner.get<{ user: { id: string } }>('/api/v1/auth/me');
    const res = await owner.post(`/api/v1/employees/${me.data.user.id}/deactivate`);
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('CANNOT_DEACTIVATE_SELF');
  });

  it('hides deactivated employees from the default list but keeps the row', async () => {
    const created = await owner.post<EmployeeView>('/api/v1/employees', newEmployee());
    await owner.post(`/api/v1/employees/${created.data.id}/deactivate`);

    const active = await owner.get<EmployeeView[]>('/api/v1/employees');
    expect(active.data.map((row) => row.id)).not.toContain(created.data.id);

    const archived = await owner.get<EmployeeView[]>('/api/v1/employees?is_active=false');
    expect(archived.data.map((row) => row.id)).toContain(created.data.id);
    expect((await owner.get(`/api/v1/employees/${created.data.id}`)).status).toBe(200);
  });

  it('audits the whole lifecycle', async () => {
    const created = await owner.post<EmployeeView>('/api/v1/employees', newEmployee());
    await owner.patch(`/api/v1/employees/${created.data.id}`, { fullName: 'Yangi ism' });
    await owner.put(`/api/v1/employees/${created.data.id}/roles`, { roleCodes: ['teacher'] });
    await owner.put(`/api/v1/employees/${created.data.id}/branches`, { branchIds: [branchId] });
    await owner.post(`/api/v1/employees/${created.data.id}/deactivate`);

    expect(await auditActions(created.data.id)).toEqual([
      'employee.create',
      'employee.update',
      'employee.set_roles',
      'employee.set_branches',
      'employee.deactivate',
    ]);
  });
});

describe('employee permissions', () => {
  it('needs role.manage to assign roles, even with employee.update', async () => {
    // administrator has employee.view but neither role.manage nor
    // employee.create — exactly the receptionist case.
    const phone = nextPhone();
    const created = await owner.post<EmployeeView>(
      '/api/v1/employees',
      newEmployee({ phone, roleCodes: ['administrator'] }),
    );

    const admin = new ApiClient(server);
    expect(await admin.login(tenantSlug, phone, EMPLOYEE_PASSWORD)).toBe(200);

    expect((await admin.get('/api/v1/employees')).status).toBe(200);
    expect((await admin.post('/api/v1/employees', newEmployee())).status).toBe(403);
    expect(
      (await admin.put(`/api/v1/employees/${created.data.id}/roles`, { roleCodes: ['owner'] }))
        .status,
    ).toBe(403);
    expect((await admin.post(`/api/v1/employees/${created.data.id}/deactivate`)).status).toBe(403);
  });

  it('enforces If-Match on an employee update like everywhere else', async () => {
    const created = await owner.post<EmployeeView>('/api/v1/employees', newEmployee());
    const { id, version } = created.data;

    const ok = await owner.patch<EmployeeView>(
      `/api/v1/employees/${id}`,
      { fullName: 'Birinchi' },
      { 'if-match': String(version) },
    );
    expect(ok.data.version).toBe(version + 1);

    const stale = await owner.patch(
      `/api/v1/employees/${id}`,
      { fullName: 'Ikkinchi' },
      { 'if-match': String(version) },
    );
    expect(stale.status).toBe(409);
    expect(stale.error?.code).toBe('VERSION_CONFLICT');
  });
});
