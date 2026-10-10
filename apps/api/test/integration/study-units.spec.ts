import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { findOrCreateTenant, seedOwnerUser } from '../../src/auth/seed-owner';
import { startAuthTestApp, type AuthTestApp } from './auth-setup';
import { ApiClient } from './api-client';

/**
 * TZ M4.1/M4.2 over real HTTP: study_unit create/list/status machine,
 * enrollment add/transfer(BR-E2)/cancel, the BR-E1 overlap rejection, the
 * BR-U3/BR-U4 capacity/min_size warnings, and the BR-S3 student-status
 * recompute that enrollment writes trigger.
 */

interface StudyUnitView {
  id: string;
  branchId: string;
  disciplineId: string;
  levelId: string | null;
  type: string;
  status: string;
  name: string;
  capacity: number;
  minSize: number;
  version: number;
  enrolledCount: number;
  overCapacity: boolean;
  belowMinSize: boolean;
  enrollments: EnrollmentView[];
}

interface EnrollmentView {
  id: string;
  studentId: string;
  studentName: string;
  studyUnitId: string;
  startDate: string;
  endDate: string | null;
  status: string;
  version: number;
}

interface StudentView {
  id: string;
  status: string;
  version: number;
}

const PASSWORD = 'correct-password-1';
const OWNER_PHONE = '+998903333333';

let testApp: AuthTestApp;
let server: Server;
let seedPrisma: PrismaClient;
let tenantId: string;
let tenantSlug: string;
let owner: ApiClient;
let branchId: string;
let disciplineId: string;
let levelId: string;

let studentCounter = 0;
async function newStudent(): Promise<StudentView> {
  studentCounter += 1;
  const res = await owner.post<StudentView>('/api/v1/students', {
    fullName: `Oʻquvchi UNIT ${uuidv7()}`,
    phone: `+99894${String(1000000 + studentCounter).slice(0, 7)}`,
    branchId,
  });
  return res.data;
}

function newUnitBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    branchId,
    disciplineId,
    levelId,
    type: 'group',
    capacity: 3,
    minSize: 2,
    ...overrides,
  };
}

beforeAll(async () => {
  testApp = await startAuthTestApp();
  server = testApp.app.getHttpServer() as Server;
  seedPrisma = new PrismaClient({ datasources: { db: { url: testApp.appUserUrl } } });

  tenantSlug = `unit-tenant-${Date.now()}`;
  const tenant = await findOrCreateTenant(testApp.migratorUrl, tenantSlug);
  tenantId = tenant.id;
  await seedOwnerUser(seedPrisma, tenantId, {
    fullName: 'Unit Owner',
    phone: OWNER_PHONE,
    password: PASSWORD,
  });

  owner = new ApiClient(server);
  expect(await owner.login(tenantSlug, OWNER_PHONE, PASSWORD)).toBe(200);

  const branch = await owner.post<{ id: string }>('/api/v1/branches', {
    name: 'Guruhlar filiali',
    code: `UNIT-${Date.now()}`,
  });
  branchId = branch.data.id;

  const discipline = await owner.post<{ id: string }>('/api/v1/disciplines', {
    name: `Ingliz tili ${Date.now()}`,
  });
  disciplineId = discipline.data.id;

  const level = await owner.post<{ id: string }>('/api/v1/levels', { name: `B1 ${Date.now()}` });
  levelId = level.data.id;
}, 180_000);

afterAll(async () => {
  await seedPrisma.$disconnect();
  await testApp.stop();
}, 60_000);

describe('study_unit creation (TZ M4.1)', () => {
  it('creates with status forming and an auto-generated name when name is blank', async () => {
    const res = await owner.post<StudyUnitView>('/api/v1/study-units', newUnitBody());
    expect(res.status).toBe(201);
    expect(res.data.status).toBe('forming');
    expect(res.data.name.length).toBeGreaterThan(0);
    expect(res.data.enrolledCount).toBe(0);
  });

  it('uses the given name when provided', async () => {
    const res = await owner.post<StudyUnitView>(
      '/api/v1/study-units',
      newUnitBody({ name: 'Maxsus guruh' }),
    );
    expect(res.data.name).toBe('Maxsus guruh');
  });

  it('rejects a branch that does not exist', async () => {
    const res = await owner.post('/api/v1/study-units', newUnitBody({ branchId: uuidv7() }));
    expect(res.status).toBe(404);
    expect(res.error?.details).toMatchObject([{ field: 'branchId' }]);
  });
});

describe('status machine (BR-U2 relaxed for R0)', () => {
  it('allows forming -> active unconditionally (no schedule_rules yet)', async () => {
    const created = await owner.post<StudyUnitView>('/api/v1/study-units', newUnitBody());
    const activated = await owner.post<StudyUnitView>(
      `/api/v1/study-units/${created.data.id}/status`,
      { status: 'active' },
      { 'if-match': String(created.data.version) },
    );
    expect(activated.status).toBe(200);
    expect(activated.data.status).toBe('active');
  });

  it('rejects an out-of-graph transition (forming -> finished)', async () => {
    const created = await owner.post<StudyUnitView>('/api/v1/study-units', newUnitBody());
    const res = await owner.post(
      `/api/v1/study-units/${created.data.id}/status`,
      { status: 'finished' },
      { 'if-match': String(created.data.version) },
    );
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('does not allow a transition out of a terminal status', async () => {
    const created = await owner.post<StudyUnitView>('/api/v1/study-units', newUnitBody());
    const cancelled = await owner.post<StudyUnitView>(
      `/api/v1/study-units/${created.data.id}/status`,
      { status: 'cancelled' },
      { 'if-match': String(created.data.version) },
    );
    expect(cancelled.data.status).toBe('cancelled');

    const res = await owner.post(
      `/api/v1/study-units/${created.data.id}/status`,
      { status: 'active' },
      { 'if-match': String(cancelled.data.version) },
    );
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('INVALID_STATUS_TRANSITION');
  });
});

describe('members (TZ M4.2) and BR-S3 student-status recompute', () => {
  it('adding a member flips the student from no_enrollment to active', async () => {
    const student = await newStudent();
    expect(student.status).toBe('no_enrollment');

    const unit = await owner.post<StudyUnitView>('/api/v1/study-units', newUnitBody());
    const added = await owner.post<EnrollmentView>(`/api/v1/study-units/${unit.data.id}/enrollments`, {
      studentId: student.id,
      startDate: '2026-01-10',
    });
    expect(added.status).toBe(201);
    expect(added.data.status).toBe('active');

    const reloaded = await owner.get<StudentView>(`/api/v1/students/${student.id}`);
    expect(reloaded.data.status).toBe('active');

    const unitAfter = await owner.get<StudyUnitView>(`/api/v1/study-units/${unit.data.id}`);
    expect(unitAfter.data.enrolledCount).toBe(1);
  });

  it('BR-E1: a second overlapping enrollment for the same student+unit is rejected with a clean app error', async () => {
    const student = await newStudent();
    const unit = await owner.post<StudyUnitView>('/api/v1/study-units', newUnitBody());

    const first = await owner.post<EnrollmentView>(`/api/v1/study-units/${unit.data.id}/enrollments`, {
      studentId: student.id,
      startDate: '2026-02-01',
    });
    expect(first.status).toBe(201);

    const overlapping = await owner.post(`/api/v1/study-units/${unit.data.id}/enrollments`, {
      studentId: student.id,
      startDate: '2026-02-15',
    });
    expect(overlapping.status).toBe(409);
    expect(overlapping.error?.code).toBe('ENROLLMENT_OVERLAP');
  });

  it('a non-overlapping re-enrollment after the first is cancelled succeeds', async () => {
    const student = await newStudent();
    const unit = await owner.post<StudyUnitView>('/api/v1/study-units', newUnitBody());

    const first = await owner.post<EnrollmentView>(`/api/v1/study-units/${unit.data.id}/enrollments`, {
      studentId: student.id,
      startDate: '2026-03-01',
    });
    const cancelled = await owner.post<EnrollmentView>(
      `/api/v1/study-units/${unit.data.id}/enrollments/${first.data.id}/cancel`,
      { endDate: '2026-03-10' },
      { 'if-match': String(first.data.version) },
    );
    expect(cancelled.data.status).toBe('cancelled');

    const second = await owner.post<EnrollmentView>(`/api/v1/study-units/${unit.data.id}/enrollments`, {
      studentId: student.id,
      startDate: '2026-03-11',
    });
    expect(second.status).toBe(201);

    const reloaded = await owner.get<StudentView>(`/api/v1/students/${student.id}`);
    // The cancelled enrollment doesn't count as active, but the student has
    // an enrollment history now, so BR-S3 recomputes to `active` (the new
    // one) rather than back to no_enrollment.
    expect(reloaded.data.status).toBe('active');
  });

  it('BR-E2: transfer closes the old enrollment and opens a new one atomically', async () => {
    const student = await newStudent();
    const unitA = await owner.post<StudyUnitView>('/api/v1/study-units', newUnitBody());
    const unitB = await owner.post<StudyUnitView>('/api/v1/study-units', newUnitBody());

    const enrollment = await owner.post<EnrollmentView>(
      `/api/v1/study-units/${unitA.data.id}/enrollments`,
      { studentId: student.id, startDate: '2026-04-01' },
    );

    const transferred = await owner.post<EnrollmentView>(
      `/api/v1/study-units/${unitA.data.id}/enrollments/${enrollment.data.id}/transfer`,
      { toStudyUnitId: unitB.data.id, transferDate: '2026-04-15' },
      { 'if-match': String(enrollment.data.version) },
    );
    expect(transferred.status).toBe(200);
    expect(transferred.data.status).toBe('active');
    expect(transferred.data.studyUnitId).toBe(unitB.data.id);

    const unitAAfter = await owner.get<StudyUnitView>(`/api/v1/study-units/${unitA.data.id}`);
    const oldEnrollment = unitAAfter.data.enrollments.find((e) => e.id === enrollment.data.id);
    expect(oldEnrollment?.status).toBe('transferred');
    expect(oldEnrollment?.endDate).toBe('2026-04-15');

    const unitBAfter = await owner.get<StudyUnitView>(`/api/v1/study-units/${unitB.data.id}`);
    expect(unitBAfter.data.enrolledCount).toBe(1);

    const reloaded = await owner.get<StudentView>(`/api/v1/students/${student.id}`);
    expect(reloaded.data.status).toBe('active');
  });

  it('cancelling the only enrollment flips the student to finished', async () => {
    const student = await newStudent();
    const unit = await owner.post<StudyUnitView>('/api/v1/study-units', newUnitBody());
    const enrollment = await owner.post<EnrollmentView>(
      `/api/v1/study-units/${unit.data.id}/enrollments`,
      { studentId: student.id, startDate: '2026-05-01' },
    );

    await owner.post(
      `/api/v1/study-units/${unit.data.id}/enrollments/${enrollment.data.id}/cancel`,
      {},
      { 'if-match': String(enrollment.data.version) },
    );

    const reloaded = await owner.get<StudentView>(`/api/v1/students/${student.id}`);
    expect(reloaded.data.status).toBe('finished');
  });

  it('freeze/unfreeze toggles the enrollment and student status, and rejects an invalid transition', async () => {
    const student = await newStudent();
    const unit = await owner.post<StudyUnitView>('/api/v1/study-units', newUnitBody());
    const enrollment = await owner.post<EnrollmentView>(
      `/api/v1/study-units/${unit.data.id}/enrollments`,
      { studentId: student.id, startDate: '2026-06-01' },
    );

    const frozen = await owner.post<EnrollmentView>(
      `/api/v1/study-units/${unit.data.id}/enrollments/${enrollment.data.id}/freeze`,
      undefined,
      { 'if-match': String(enrollment.data.version) },
    );
    expect(frozen.data.status).toBe('frozen');

    const studentFrozen = await owner.get<StudentView>(`/api/v1/students/${student.id}`);
    expect(studentFrozen.data.status).toBe('frozen');

    const unfrozen = await owner.post<EnrollmentView>(
      `/api/v1/study-units/${unit.data.id}/enrollments/${enrollment.data.id}/unfreeze`,
      undefined,
      { 'if-match': String(frozen.data.version) },
    );
    expect(unfrozen.data.status).toBe('active');

    const finished = await owner.post<EnrollmentView>(
      `/api/v1/study-units/${unit.data.id}/enrollments/${enrollment.data.id}/finish`,
      {},
      { 'if-match': String(unfrozen.data.version) },
    );
    expect(finished.data.status).toBe('finished');

    const invalid = await owner.post(
      `/api/v1/study-units/${unit.data.id}/enrollments/${enrollment.data.id}/freeze`,
      undefined,
      { 'if-match': String(finished.data.version) },
    );
    expect(invalid.status).toBe(409);
    expect(invalid.error?.code).toBe('INVALID_STATUS_TRANSITION');
  });
});

describe('BR-U3/BR-U4: capacity and min_size are warnings, never a block', () => {
  it('overCapacity flips true once enrolled count passes capacity, and the write still succeeds', async () => {
    const unit = await owner.post<StudyUnitView>(
      '/api/v1/study-units',
      newUnitBody({ capacity: 1, minSize: 1 }),
    );
    const first = await newStudent();
    const second = await newStudent();

    const addedFirst = await owner.post(`/api/v1/study-units/${unit.data.id}/enrollments`, {
      studentId: first.id,
      startDate: '2026-07-01',
    });
    expect(addedFirst.status).toBe(201);

    const atCapacity = await owner.get<StudyUnitView>(`/api/v1/study-units/${unit.data.id}`);
    expect(atCapacity.data.overCapacity).toBe(false);

    const addedSecond = await owner.post(`/api/v1/study-units/${unit.data.id}/enrollments`, {
      studentId: second.id,
      startDate: '2026-07-01',
    });
    // Never blocked (BR-U3) — the second member still gets added.
    expect(addedSecond.status).toBe(201);

    const overCapacity = await owner.get<StudyUnitView>(`/api/v1/study-units/${unit.data.id}`);
    expect(overCapacity.data.enrolledCount).toBe(2);
    expect(overCapacity.data.overCapacity).toBe(true);
  });

  it('belowMinSize is true while enrolled count is under min_size', async () => {
    const unit = await owner.post<StudyUnitView>(
      '/api/v1/study-units',
      newUnitBody({ capacity: 10, minSize: 5 }),
    );
    expect(unit.data.belowMinSize).toBe(true);

    const found = await owner.get<StudyUnitView[]>('/api/v1/study-units?below_min_size=true');
    expect(found.data.map((row) => row.id)).toContain(unit.data.id);
  });
});
