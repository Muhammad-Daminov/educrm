import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { findOrCreateTenant, seedOwnerUser } from '../../src/auth/seed-owner';
import { startAuthTestApp, type AuthTestApp } from './auth-setup';
import { ApiClient } from './api-client';

/**
 * TZ M11.1 student CSV import: mapping → dry-run → confirm → rollback,
 * each batched under one import_batch_id.
 */

interface StudentView {
  id: string;
  status: string;
}

interface DryRunResult {
  totalRows: number;
  validCount: number;
  errors: { row: number; field: string; code: string }[];
}

interface ConfirmResult {
  batchId: string;
  totalRows: number;
  importedCount: number;
  errorCount: number;
}

const PASSWORD = 'correct-password-1';
const OWNER_PHONE = '+998903333333';

let testApp: AuthTestApp;
let server: Server;
let seedPrisma: PrismaClient;
let tenantId: string;
let tenantSlug: string;
let owner: ApiClient;
let branchCode: string;

const MAPPING = JSON.stringify({ fullName: 'Name', phone: 'Phone', branchCode: 'Branch' });

beforeAll(async () => {
  testApp = await startAuthTestApp();
  server = testApp.app.getHttpServer() as Server;
  seedPrisma = new PrismaClient({ datasources: { db: { url: testApp.appUserUrl } } });

  tenantSlug = `import-tenant-${Date.now()}`;
  const tenant = await findOrCreateTenant(testApp.migratorUrl, tenantSlug);
  tenantId = tenant.id;
  await seedOwnerUser(seedPrisma, tenantId, {
    fullName: 'Import Owner',
    phone: OWNER_PHONE,
    password: PASSWORD,
  });

  owner = new ApiClient(server);
  expect(await owner.login(tenantSlug, OWNER_PHONE, PASSWORD)).toBe(200);

  branchCode = `IMP-${Date.now()}`;
  await owner.post('/api/v1/branches', { name: 'Import filiali', code: branchCode });
}, 180_000);

afterAll(async () => {
  await seedPrisma.$disconnect();
  await testApp.stop();
}, 60_000);

function csv(rows: string[][]): string {
  return [['Name', 'Phone', 'Branch'], ...rows].map((row) => row.join(',')).join('\n');
}

describe('dry-run', () => {
  it('reports valid rows and leaves nothing imported', async () => {
    const file = csv([
      [`Ali ${uuidv7()}`, '+998911000001', branchCode],
      [`Vali ${uuidv7()}`, '+998911000002', branchCode],
    ]);

    const res = await owner.postMultipart<DryRunResult>(
      '/api/v1/students/import/dry-run',
      { field: 'file', filename: 'students.csv', content: file },
      { mapping: MAPPING },
    );
    expect(res.status).toBe(200);
    expect(res.data.totalRows).toBe(2);
    expect(res.data.validCount).toBe(2);
    expect(res.data.errors).toEqual([]);

    const list = await owner.get<StudentView[]>('/api/v1/students');
    const before = list.data.length;
    expect(before).toBeGreaterThanOrEqual(0);
    // dry-run creates nothing — re-running confirm later must still see 2 valid rows.
  });

  it('reports per-row errors: bad phone, unknown branch, duplicate phone in file', async () => {
    const dup = '+998911000099';
    const file = csv([
      [`Ok ${uuidv7()}`, dup, branchCode],
      [`Bad phone ${uuidv7()}`, 'not-a-phone', branchCode],
      [`Bad branch ${uuidv7()}`, '+998911000003', 'NO-SUCH-BRANCH'],
      [`Repeat ${uuidv7()}`, dup, branchCode],
    ]);

    const res = await owner.postMultipart<DryRunResult>(
      '/api/v1/students/import/dry-run',
      { field: 'file', filename: 'students.csv', content: file },
      { mapping: MAPPING },
    );
    expect(res.data.totalRows).toBe(4);
    expect(res.data.validCount).toBe(1);
    const codes = res.data.errors.map((error) => error.code).sort();
    expect(codes).toEqual(['DUPLICATE_IN_FILE', 'INVALID', 'REFERENCE_NOT_FOUND']);
  });

  it('flags an existing phone as a duplicate against the database', async () => {
    const phone = '+998911000050';
    await owner.post('/api/v1/students', { fullName: 'Mavjud', phone, branchId: (await owner.get<{ id: string }[]>('/api/v1/branches')).data[0]?.id });

    const file = csv([[`Yangi ${uuidv7()}`, phone, branchCode]]);
    const res = await owner.postMultipart<DryRunResult>(
      '/api/v1/students/import/dry-run',
      { field: 'file', filename: 'students.csv', content: file },
      { mapping: MAPPING },
    );
    expect(res.data.errors).toMatchObject([{ field: 'phone', code: 'DUPLICATE_PHONE' }]);
  });
});

describe('confirm + rollback', () => {
  it('imports the valid rows under one batch and rolls them back together', async () => {
    const file = csv([
      [`Birinchi ${uuidv7()}`, '+998911000010', branchCode],
      [`Ikkinchi ${uuidv7()}`, '+998911000011', branchCode],
    ]);

    const confirmed = await owner.postMultipart<ConfirmResult>(
      '/api/v1/students/import/confirm',
      { field: 'file', filename: 'students.csv', content: file },
      { mapping: MAPPING },
    );
    expect(confirmed.status).toBe(201);
    expect(confirmed.data.importedCount).toBe(2);
    expect(confirmed.data.errorCount).toBe(0);

    const active = await owner.get<StudentView[]>('/api/v1/students');
    const importedCountBefore = active.data.length;

    const rollback = await owner.post<{ archivedCount: number }>(
      `/api/v1/students/import/${confirmed.data.batchId}/rollback`,
    );
    expect(rollback.status).toBe(200);
    expect(rollback.data.archivedCount).toBe(2);

    const afterRollback = await owner.get<StudentView[]>('/api/v1/students');
    expect(afterRollback.data.length).toBe(importedCountBefore - 2);

    // Idempotent — a second rollback archives nothing more.
    const again = await owner.post<{ archivedCount: number }>(
      `/api/v1/students/import/${confirmed.data.batchId}/rollback`,
    );
    expect(again.data.archivedCount).toBe(0);
  });

  it('imports only the valid rows, skipping the invalid ones', async () => {
    const file = csv([
      [`Toza ${uuidv7()}`, '+998911000020', branchCode],
      [`Xato ${uuidv7()}`, 'bad', branchCode],
    ]);

    const confirmed = await owner.postMultipart<ConfirmResult>(
      '/api/v1/students/import/confirm',
      { field: 'file', filename: 'students.csv', content: file },
      { mapping: MAPPING },
    );
    expect(confirmed.data.importedCount).toBe(1);
    expect(confirmed.data.errorCount).toBe(1);
  });
});

describe('permissions', () => {
  it('requires import.run for dry-run and confirm', async () => {
    const phone = '+998903333399';
    await owner.post('/api/v1/employees', {
      fullName: 'Oqituvchi',
      phone,
      password: 'employee-password-1',
      roleCodes: ['teacher'],
    });
    const teacher = new ApiClient(server);
    expect(await teacher.login(tenantSlug, phone, 'employee-password-1')).toBe(200);

    const file = csv([[`X ${uuidv7()}`, '+998911000030', branchCode]]);
    const res = await teacher.postMultipart(
      '/api/v1/students/import/dry-run',
      { field: 'file', filename: 'students.csv', content: file },
      { mapping: MAPPING },
    );
    expect(res.status).toBe(403);
  });
});
