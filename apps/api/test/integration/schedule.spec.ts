import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { PrismaClient } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { findOrCreateTenant, seedOwnerUser } from '../../src/auth/seed-owner';
import { runInTenant } from '../../src/tenant/run-in-tenant';
import { ScheduleHorizonService } from '../../src/schedule/schedule-horizon.service';
import { startAuthTestApp, type AuthTestApp } from './auth-setup';
import { ApiClient } from './api-client';

/**
 * TZ M4.3–M4.6 over real HTTP: rule preview, materialization, the
 * regeneration protections, the conflict control's SCHEDULE_CONFLICT body
 * with free alternatives, the single-lesson actions, BR-U2, and the nightly
 * horizon job.
 *
 * The database-level guarantees (the exclusion constraints themselves, the
 * parallel-insert race, the DELETE guard trigger) are in
 * rls-schedule.spec.ts — they are properties of the schema, not of the API.
 *
 * Two things do belong here even though they are about the database: the
 * exclusion constraints as seen by `app_user` (the role this very
 * application connects with, against the schema this very application
 * migrated), and the end-to-end race — two real HTTP requests for the same
 * slot, where the constraint firing has to come back out of the API as a
 * 409 SCHEDULE_CONFLICT rather than a 500.
 */

interface LessonView {
  id: string;
  studyUnitId: string;
  date: string;
  startAt: string;
  endAt: string;
  classroomId: string | null;
  classroomName: string | null;
  teacherId: string | null;
  actualTeacherId: string | null;
  actualTeacherName: string | null;
  isSubstituted: boolean;
  status: string;
  isDetached: boolean;
  academicHours: number | null;
  cancelReason: string | null;
  movedToLessonId: string | null;
  version: number;
}

interface ScheduleRuleView {
  id: string;
  studyUnitId: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string | null;
  periodStart: string;
  periodEnd: string | null;
  classroomId: string | null;
  isActive: boolean;
  version: number;
  lessonCount: number;
}

interface SchedulePreview {
  lessonCount: number;
  firstDate: string | null;
  lastDate: string | null;
  totalAcademicHours: number;
  skippedHolidays: string[];
  conflicts: { date: string; kind: string; conflictingStudyUnitName: string }[];
  alternatives: {
    classrooms: { classroomId: string; classroomName: string; capacity: number | null }[];
    times: { startTime: string; endTime: string }[];
  };
}

interface AvailabilityView {
  free: boolean;
  conflicts: { kind: string; studyUnitName: string }[];
  alternatives: { classrooms: { classroomId: string }[]; times: { startTime: string }[] };
  freeTeachers: { teacherId: string; teacherName: string }[];
}

interface ConflictDetail {
  kind: string;
  free_classrooms: { id: string; name: string; capacity: number | null }[];
  free_times: { start_time: string; end_time: string }[];
}

const PASSWORD = 'correct-password-1';
const OWNER_PHONE = '+998904444444';
/** Every weekday, so a date range maps one-to-one onto lessons. */
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

let testApp: AuthTestApp;
let server: Server;
let seedPrisma: PrismaClient;
let tenantId: string;
let owner: ApiClient;
let branchId: string;
let disciplineId: string;
let classroomA: string;
let classroomB: string;
let teacherA: string;
let teacherB: string;

/** Branch-local today. The branch is Asia/Tashkent (the default). */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function plusDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The instant a branch-local `HH:MM` on `date` corresponds to. Asia/Tashkent
 * is UTC+5 all year, so this is a fixed shift — but going through Date
 * arithmetic rather than subtracting 5 from the hour keeps the day rollover
 * right for an early-morning slot.
 */
function utcOf(date: string, time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCMinutes(instant.getUTCMinutes() + (hours as number) * 60 + (minutes as number) - 300);
  return instant.toISOString();
}

/**
 * A fresh 45-minute slot, on its own hour of the day, for every test that
 * books a real classroom or teacher.
 *
 * Without this, tests collide with each other rather than with what they
 * are testing: the rooms and teachers are shared across the whole file, so
 * two tests that both default to "18:00 in Xona 204" make the second one
 * fail with a perfectly correct SCHEDULE_CONFLICT. One hour each, 45
 * minutes long, means no two slots can overlap by construction.
 */
let slotCursor = 5;
function nextSlot(): { startTime: string; endTime: string } {
  const hour = slotCursor;
  slotCursor += 1;
  if (hour > 23) {
    throw new Error('Out of distinct hourly slots — give this file a second classroom pair');
  }
  const padded = String(hour).padStart(2, '0');
  return { startTime: `${padded}:00`, endTime: `${padded}:45` };
}

/** Direct SQL in the tenant's RLS context — for the rows the API cannot
 * create (a lesson in the past, a lesson that already has attendance). */
async function sql<T extends Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pg = new PgClient({ connectionString: testApp.migratorUrl });
  await pg.connect();
  try {
    await pg.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
    const result = await pg.query<T>(query, params);
    return result.rows;
  } finally {
    await pg.end();
  }
}

/**
 * The same, but as `app_user` — the role the API itself connects with.
 * `migrator` owns `lessons`, so a constraint proof run as migrator would
 * only show that the *owner* is blocked; the question these tests ask is
 * whether the application's own role can slip an overlap past the schema.
 */
async function asAppUser<T>(fn: (pg: PgClient) => Promise<T>): Promise<T> {
  const pg = new PgClient({ connectionString: testApp.appUserUrl });
  await pg.connect();
  try {
    await pg.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
    return await fn(pg);
  } finally {
    await pg.end();
  }
}

/** `pg` hangs the SQLSTATE and the constraint name off the error. */
interface PgError extends Error {
  code?: string;
  constraint?: string;
}

const INSERT_LESSON = `INSERT INTO lessons
  (id, tenant_id, study_unit_id, date, start_at, end_at, classroom_id, actual_teacher_id, status, cancel_reason)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;

interface RawLesson {
  studyUnitId: string;
  date: string;
  /** Branch-local `HH:MM`; UTC+5, so a 13:00Z instant is 18:00 in Tashkent. */
  startTime: string;
  endTime: string;
  classroomId?: string | null;
  actualTeacherId?: string | null;
  status?: string;
  cancelReason?: string | null;
}

/**
 * Inserts a lesson with no service in the way and returns the Postgres
 * error, or `null` if it went in. Bypassing `LessonsService` is the entire
 * point: its `assertSlotFree` pre-check would reject the second row long
 * before the constraint got a chance to, which would prove nothing about the
 * constraint.
 */
async function insertRawLesson(pg: PgClient, lesson: RawLesson): Promise<PgError | null> {
  try {
    await pg.query(INSERT_LESSON, [
      uuidv7(),
      tenantId,
      lesson.studyUnitId,
      lesson.date,
      utcOf(lesson.date, lesson.startTime),
      utcOf(lesson.date, lesson.endTime),
      lesson.classroomId ?? null,
      lesson.actualTeacherId ?? null,
      lesson.status ?? 'planned',
      lesson.cancelReason ?? null,
    ]);
    return null;
  } catch (error) {
    return error as PgError;
  }
}

/**
 * A date far past the 6-month generation horizon, so the raw rows below
 * cannot collide with anything the rule tests materialize near today — and
 * so a failure here is about the constraint and not about test fixtures.
 */
function rawDate(offset: number): string {
  return plusDays('2028-03-06', offset);
}

let unitCounter = 0;
async function newUnit(overrides: Record<string, unknown> = {}): Promise<{ id: string; version: number }> {
  unitCounter += 1;
  const res = await owner.post<{ id: string; version: number }>('/api/v1/study-units', {
    branchId,
    disciplineId,
    type: 'group',
    name: `Guruh ${unitCounter} ${uuidv7()}`,
    capacity: 12,
    minSize: 4,
    ...overrides,
  });
  expect(res.status, JSON.stringify(res.error)).toBe(201);
  return res.data;
}

/**
 * A rule that books no room and no teacher, so it cannot conflict with
 * anything. Tests that are *about* conflicts opt into a real classroom or
 * teacher, on their own `nextSlot()`.
 */
function ruleBody(studyUnitId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const start = today();
  return {
    studyUnitId,
    daysOfWeek: EVERY_DAY,
    startTime: '18:00',
    endTime: '19:30',
    periodStart: start,
    periodEnd: plusDays(start, 9),
    classroomId: null,
    teacherId: null,
    ...overrides,
  };
}

async function createRule(
  studyUnitId: string,
  overrides: Record<string, unknown> = {},
): Promise<ScheduleRuleView> {
  const res = await owner.post<ScheduleRuleView>('/api/v1/schedule-rules', ruleBody(studyUnitId, overrides));
  expect(res.status, JSON.stringify(res.error)).toBe(201);
  return res.data;
}

async function lessonsOf(studyUnitId: string, from: string, to: string): Promise<LessonView[]> {
  const res = await owner.get<LessonView[]>(
    `/api/v1/lessons?from=${from}&to=${to}&study_unit_id=${studyUnitId}`,
  );
  expect(res.status, JSON.stringify(res.error)).toBe(200);
  return res.data;
}

beforeAll(async () => {
  testApp = await startAuthTestApp();
  server = testApp.app.getHttpServer() as Server;
  seedPrisma = new PrismaClient({ datasources: { db: { url: testApp.appUserUrl } } });

  const tenantSlug = `schedule-tenant-${Date.now()}`;
  const tenant = await findOrCreateTenant(testApp.migratorUrl, tenantSlug);
  tenantId = tenant.id;
  await seedOwnerUser(seedPrisma, tenantId, {
    fullName: 'Schedule Owner',
    phone: OWNER_PHONE,
    password: PASSWORD,
  });

  owner = new ApiClient(server);
  expect(await owner.login(tenantSlug, OWNER_PHONE, PASSWORD)).toBe(200);

  const branch = await owner.post<{ id: string }>('/api/v1/branches', {
    name: 'Jadval filiali',
    code: `SCH-${Date.now()}`,
  });
  branchId = branch.data.id;

  const discipline = await owner.post<{ id: string }>('/api/v1/disciplines', {
    name: `Ingliz tili ${Date.now()}`,
  });
  disciplineId = discipline.data.id;

  const roomA = await owner.post<{ id: string }>('/api/v1/classrooms', {
    branchId,
    name: `Xona 204 ${Date.now()}`,
    capacity: 20,
  });
  classroomA = roomA.data.id;
  const roomB = await owner.post<{ id: string }>('/api/v1/classrooms', {
    branchId,
    name: `Xona 206 ${Date.now()}`,
    capacity: 20,
  });
  classroomB = roomB.data.id;

  // Two teachers, both attached to the branch so the free-teacher finder
  // can see them.
  for (const [index, name] of ['Birinchi', 'Ikkinchi'].entries()) {
    const employee = await owner.post<{ id: string }>('/api/v1/employees', {
      fullName: `${name} oʻqituvchi ${Date.now()}`,
      phone: `+99893${String(2000000 + index).slice(0, 7)}`,
      password: 'teacher-password-1',
      roleCodes: ['teacher'],
      branchIds: [branchId],
    });
    if (index === 0) {
      teacherA = employee.data.id;
    } else {
      teacherB = employee.data.id;
    }
  }
}, 240_000);

afterAll(async () => {
  await seedPrisma.$disconnect();
  await testApp.stop();
}, 60_000);

describe('TZ M4.3 — POST /schedule-rules/preview (SHART)', () => {
  it('reports the lesson count and the first/last date without writing anything', async () => {
    const unit = await newUnit();
    const start = today();
    const res = await owner.post<SchedulePreview>(
      '/api/v1/schedule-rules/preview',
      ruleBody(unit.id, { periodStart: start, periodEnd: plusDays(start, 9) }),
    );

    expect(res.status, JSON.stringify(res.error)).toBe(200);
    expect(res.data.lessonCount).toBe(10);
    expect(res.data.firstDate).toBe(start);
    expect(res.data.lastDate).toBe(plusDays(start, 9));
    // 90-minute slot = 2 academic hours each.
    expect(res.data.totalAcademicHours).toBe(20);
    expect(res.data.conflicts).toEqual([]);

    // Nothing persisted.
    const rules = await owner.get<ScheduleRuleView[]>(
      `/api/v1/schedule-rules?study_unit_id=${unit.id}`,
    );
    expect(rules.data).toHaveLength(0);
  });

  it('skips holidays and reports which ones it skipped', async () => {
    // A window 120 days out, so the holiday this test creates cannot
    // perturb the lesson counts the other tests assert on dates near today.
    const start = today();
    const periodStart = plusDays(start, 120);
    const holiday = plusDays(periodStart, 3);
    await owner.post('/api/v1/holidays', { name: `Bayram ${uuidv7()}`, date: holiday, branchId });

    const unit = await newUnit();
    const res = await owner.post<SchedulePreview>(
      '/api/v1/schedule-rules/preview',
      ruleBody(unit.id, { periodStart, periodEnd: plusDays(periodStart, 9) }),
    );

    expect(res.data.lessonCount).toBe(9);
    expect(res.data.skippedHolidays).toContain(holiday);
  });

  it('lists conflicts and offers free rooms and times (UX P4)', async () => {
    const slot = nextSlot();
    // One group already owns classroom A in this slot.
    const occupying = await newUnit();
    await createRule(occupying.id, { ...slot, classroomId: classroomA });

    const unit = await newUnit();
    const res = await owner.post<SchedulePreview>(
      '/api/v1/schedule-rules/preview',
      ruleBody(unit.id, { ...slot, classroomId: classroomA }),
    );

    expect(res.status).toBe(200);
    expect(res.data.conflicts.length).toBeGreaterThan(0);
    expect(res.data.conflicts[0]?.kind).toBe('classroom');
    // "Xona 204 band. Boʻsh: 206 · yoki 19:30"
    expect(res.data.alternatives.classrooms.map((room) => room.classroomId)).toContain(classroomB);
    expect(res.data.alternatives.times.length).toBeGreaterThan(0);
  });

  it('rejects a body with both endTime and academicHoursPerDay', async () => {
    const unit = await newUnit();
    const res = await owner.post('/api/v1/schedule-rules/preview', {
      ...ruleBody(unit.id),
      academicHoursPerDay: 2,
    });
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a body with neither a period end nor an hour budget', async () => {
    const unit = await newUnit();
    const body = ruleBody(unit.id);
    delete body.periodEnd;
    const res = await owner.post('/api/v1/schedule-rules/preview', body);
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe('VALIDATION_ERROR');
  });
});

describe('TZ M4.3 — creating a rule materializes its lessons', () => {
  it('writes one lesson per occurrence, with the branch wall clock', async () => {
    const unit = await newUnit();
    const start = today();
    const slot = nextSlot();
    const rule = await createRule(unit.id, {
      ...slot,
      periodStart: start,
      periodEnd: plusDays(start, 4),
      classroomId: classroomA,
      teacherId: teacherA,
    });

    expect(rule.lessonCount).toBe(5);

    const lessons = await lessonsOf(unit.id, start, plusDays(start, 4));
    expect(lessons).toHaveLength(5);
    expect(lessons[0]?.date).toBe(start);
    // Authored as a branch-local wall clock, stored as the matching instant
    // (Asia/Tashkent is UTC+5).
    expect(lessons[0]?.startAt).toBe(utcOf(start, slot.startTime));
    expect(lessons[0]?.endAt).toBe(utcOf(start, slot.endTime));
    expect(lessons[0]?.classroomId).toBe(classroomA);
    // TZ M4.4: actual_teacher_id defaults to teacher_id.
    expect(lessons[0]?.teacherId).toBe(teacherA);
    expect(lessons[0]?.actualTeacherId).toBe(teacherA);
    expect(lessons[0]?.isDetached).toBe(false);
    // A 45-minute slot is exactly one academic hour.
    expect(lessons[0]?.academicHours).toBe(1);
  });

  it('caps generation at the rolling 6-month horizon (TZ M4.3)', async () => {
    const unit = await newUnit();
    const start = today();
    // A two-year period: only six months of it may be materialized.
    const rule = await createRule(unit.id, {
      periodStart: start,
      periodEnd: plusDays(start, 730),
      classroomId: null,
      teacherId: null,
    });

    expect(rule.lessonCount).toBeGreaterThan(150);
    expect(rule.lessonCount).toBeLessThan(200);
    expect(rule.lessonCount).toBeLessThan(730);

    const beyond = await lessonsOf(unit.id, plusDays(start, 200), plusDays(start, 730));
    expect(beyond).toHaveLength(0);
  });

  it('refuses to save a rule that collides, with alternatives in the error', async () => {
    const slot = nextSlot();
    const occupying = await newUnit();
    await createRule(occupying.id, { ...slot, classroomId: classroomA });

    const unit = await newUnit();
    const res = await owner.post(
      '/api/v1/schedule-rules',
      ruleBody(unit.id, { ...slot, classroomId: classroomA }),
    );

    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('SCHEDULE_CONFLICT');
    const detail = (res.error?.details as ConflictDetail[])[0];
    expect(detail?.kind).toBe('classroom');
    expect(detail?.free_classrooms.map((room) => room.id)).toContain(classroomB);

    // Nothing was written.
    const rules = await owner.get<ScheduleRuleView[]>(
      `/api/v1/schedule-rules?study_unit_id=${unit.id}`,
    );
    expect(rules.data).toHaveLength(0);
  });

  it('allows a parallel lesson in another classroom at the same time', async () => {
    const slot = nextSlot();
    const first = await newUnit();
    await createRule(first.id, { ...slot, classroomId: classroomA, teacherId: teacherA });

    const second = await newUnit();
    const rule = await createRule(second.id, {
      ...slot,
      classroomId: classroomB,
      teacherId: teacherB,
    });
    expect(rule.lessonCount).toBe(10);
  });

  it('refuses a rule that collides on the teacher even in a free room', async () => {
    const slot = nextSlot();
    const first = await newUnit();
    await createRule(first.id, { ...slot, classroomId: classroomA, teacherId: teacherA });

    const second = await newUnit();
    const res = await owner.post(
      '/api/v1/schedule-rules',
      ruleBody(second.id, { ...slot, classroomId: classroomB, teacherId: teacherA }),
    );

    expect(res.status).toBe(409);
    expect((res.error?.details as ConflictDetail[])[0]?.kind).toBe('teacher');
  });
});

describe('TZ M4.3 — regeneration protections (SHART)', () => {
  it('keeps past lessons, detached lessons and lessons with attendance', async () => {
    const unit = await newUnit();
    const start = today();
    const rule = await createRule(unit.id, {
      periodStart: start,
      periodEnd: plusDays(start, 9),
      classroomId: null,
      teacherId: null,
    });

    // A lesson in the past, which generation never creates but a real
    // schedule accumulates. TZ M4.3: "oʻtgan darslar tegilmaydi".
    const pastDate = plusDays(start, -7);
    const pastId = uuidv7();
    await sql(
      `INSERT INTO lessons (id, tenant_id, study_unit_id, schedule_rule_id, date, start_at, end_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        pastId,
        tenantId,
        unit.id,
        rule.id,
        pastDate,
        `${pastDate}T13:00:00Z`,
        `${pastDate}T14:30:00Z`,
      ],
    );

    const lessons = await lessonsOf(unit.id, start, plusDays(start, 9));

    // A cancelled lesson is detached by the cancel action.
    const toCancel = lessons[2] as LessonView;
    const cancelled = await owner.post<LessonView>(`/api/v1/lessons/${toCancel.id}/cancel`, {
      reason: 'Oʻqituvchi kasal',
    });
    expect(cancelled.status, JSON.stringify(cancelled.error)).toBe(200);

    // A lesson that already carries attendance (T09 maintains this counter;
    // here it stands in for what T09 will write).
    const withAttendance = lessons[4] as LessonView;
    await sql('UPDATE lessons SET attendance_count = 2 WHERE id = $1', [withAttendance.id]);

    // Now change the rule's time, which regenerates the future. Note this
    // PATCH sends only the two time fields: the "exactly one of endTime /
    // academicHoursPerDay" and "periodEnd or totalAcademicHours"
    // invariants belong to the merged rule, not to the patch body.
    const patched = await owner.patch<ScheduleRuleView>(
      `/api/v1/schedule-rules/${rule.id}`,
      { startTime: '10:00', endTime: '11:30' },
      { 'if-match': String(rule.version) },
    );
    expect(patched.status, JSON.stringify(patched.error)).toBe(200);

    // The past lesson is untouched, at its original time.
    const past = await sql<{ id: string; start_at: Date }>(
      'SELECT id, start_at FROM lessons WHERE id = $1',
      [pastId],
    );
    expect(past).toHaveLength(1);
    expect(past[0]?.start_at.toISOString()).toBe(utcOf(pastDate, '18:00'));

    // The cancelled lesson survives, still cancelled, and was not replaced.
    const after = await lessonsOf(unit.id, start, plusDays(start, 9));
    const survivingCancelled = after.find((lesson) => lesson.id === toCancel.id);
    expect(survivingCancelled?.status).toBe('cancelled');
    expect(after.filter((lesson) => lesson.date === toCancel.date)).toHaveLength(1);

    // The lesson with attendance survives at its original 18:00 time.
    const survivingAttendance = after.find((lesson) => lesson.id === withAttendance.id);
    expect(survivingAttendance).toBeDefined();
    expect(survivingAttendance?.startAt).toBe(utcOf(withAttendance.date, '18:00'));
    expect(after.filter((lesson) => lesson.date === withAttendance.date)).toHaveLength(1);

    // Every other future lesson moved to the new 10:00 time.
    const regenerated = after.filter(
      (lesson) => lesson.id !== toCancel.id && lesson.id !== withAttendance.id,
    );
    expect(regenerated.length).toBeGreaterThan(0);
    for (const lesson of regenerated) {
      expect(lesson.startAt).toBe(utcOf(lesson.date, '10:00'));
    }
  });

  it('does not overwrite a lesson that was moved by hand', async () => {
    const unit = await newUnit();
    const start = today();
    const rule = await createRule(unit.id, {
      periodStart: start,
      periodEnd: plusDays(start, 9),
      classroomId: null,
      teacherId: null,
    });

    const lessons = await lessonsOf(unit.id, start, plusDays(start, 9));
    const original = lessons[3] as LessonView;
    const moved = await owner.post<LessonView>(
      `/api/v1/lessons/${original.id}/move`,
      { date: original.date, startTime: '09:00' },
      { 'if-match': String(original.version) },
    );
    expect(moved.status, JSON.stringify(moved.error)).toBe(200);
    expect(moved.data.isDetached).toBe(true);

    await owner.patch(
      `/api/v1/schedule-rules/${rule.id}`,
      { startTime: '10:00', endTime: '11:30' },
      { 'if-match': String(rule.version) },
    );

    const after = await lessonsOf(unit.id, start, plusDays(start, 9));
    const stillMoved = after.find((lesson) => lesson.id === moved.data.id);
    // The hand-placed time, not the rule's new one.
    expect(stillMoved?.startAt).toBe(utcOf(original.date, '09:00'));
    expect(after.filter((lesson) => lesson.date === original.date)).toHaveLength(1);
  });

  it('deactivating a rule drops its future lessons but keeps the protected ones', async () => {
    const unit = await newUnit();
    const start = today();
    const rule = await createRule(unit.id, {
      periodStart: start,
      periodEnd: plusDays(start, 9),
      classroomId: null,
      teacherId: null,
    });

    const lessons = await lessonsOf(unit.id, start, plusDays(start, 9));
    const protectedLesson = lessons[1] as LessonView;
    await sql('UPDATE lessons SET attendance_count = 1 WHERE id = $1', [protectedLesson.id]);

    const res = await owner.delete<ScheduleRuleView>(`/api/v1/schedule-rules/${rule.id}`, {
      'if-match': String(rule.version),
    });
    expect(res.status, JSON.stringify(res.error)).toBe(200);
    expect(res.data.isActive).toBe(false);

    const after = await lessonsOf(unit.id, start, plusDays(start, 9));
    expect(after.map((lesson) => lesson.id)).toEqual([protectedLesson.id]);
  });
});

describe('TZ M4.5 — lesson actions', () => {
  it('a move leaves the original as `moved` pointing at the new lesson', async () => {
    const unit = await newUnit();
    const start = today();
    await createRule(unit.id, {
      periodStart: start,
      periodEnd: plusDays(start, 4),
      classroomId: null,
      teacherId: null,
    });

    const lessons = await lessonsOf(unit.id, start, plusDays(start, 4));
    const original = lessons[1] as LessonView;
    const target = plusDays(original.date, 1);

    const moved = await owner.post<LessonView>(
      `/api/v1/lessons/${original.id}/move`,
      { date: target, startTime: '20:00', reason: 'Bayram tufayli' },
      { 'if-match': String(original.version) },
    );
    expect(moved.status, JSON.stringify(moved.error)).toBe(200);
    expect(moved.data.date).toBe(target);
    expect(moved.data.startAt).toBe(utcOf(target, '20:00'));
    // The original's 90-minute length is preserved when no endTime is given.
    expect(moved.data.endAt).toBe(utcOf(target, '21:30'));

    const old = await sql<{ status: string; moved_to_lesson_id: string }>(
      'SELECT status, moved_to_lesson_id FROM lessons WHERE id = $1',
      [original.id],
    );
    expect(old[0]?.status).toBe('moved');
    expect(old[0]?.moved_to_lesson_id).toBe(moved.data.id);

    // A `moved` row is history, so the calendar shows the new lesson only.
    const calendar = await lessonsOf(unit.id, start, plusDays(start, 5));
    expect(calendar.map((lesson) => lesson.id)).not.toContain(original.id);
    expect(calendar.map((lesson) => lesson.id)).toContain(moved.data.id);
  });

  it('a move onto an occupied slot is refused with alternatives', async () => {
    const start = today();
    const taken = nextSlot();
    const mine = nextSlot();

    const occupying = await newUnit();
    await createRule(occupying.id, {
      ...taken,
      periodStart: start,
      periodEnd: plusDays(start, 4),
      classroomId: classroomA,
      teacherId: null,
    });

    const unit = await newUnit();
    await createRule(unit.id, {
      ...mine,
      periodStart: start,
      periodEnd: plusDays(start, 4),
      classroomId: classroomA,
      teacherId: null,
    });

    const lessons = await lessonsOf(unit.id, start, plusDays(start, 4));
    const lesson = lessons[2] as LessonView;

    const res = await owner.post(
      `/api/v1/lessons/${lesson.id}/move`,
      { date: lesson.date, startTime: taken.startTime },
      { 'if-match': String(lesson.version) },
    );
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('SCHEDULE_CONFLICT');
    const detail = (res.error?.details as ConflictDetail[])[0];
    expect(detail?.free_classrooms.map((room) => room.id)).toContain(classroomB);

    // The lesson did not move.
    const unchanged = await owner.get<LessonView>(`/api/v1/lessons/${lesson.id}`);
    expect(unchanged.data.status).toBe('planned');
    expect(unchanged.data.startAt).toBe(lesson.startAt);
  });

  it('a move frees the original slot, so a lesson can be moved back', async () => {
    const unit = await newUnit();
    const start = today();
    const home = nextSlot();
    const elsewhere = nextSlot();
    await createRule(unit.id, {
      ...home,
      periodStart: start,
      periodEnd: plusDays(start, 2),
      classroomId: classroomA,
      teacherId: null,
    });

    const lessons = await lessonsOf(unit.id, start, plusDays(start, 2));
    const original = lessons[0] as LessonView;

    const away = await owner.post<LessonView>(
      `/api/v1/lessons/${original.id}/move`,
      { date: original.date, startTime: elsewhere.startTime },
      { 'if-match': String(original.version) },
    );
    expect(away.status, JSON.stringify(away.error)).toBe(200);

    // Back to the original slot — only possible because the `moved` row no
    // longer reserves it (TZ M4.4's documented v1.0 fix).
    const back = await owner.post<LessonView>(
      `/api/v1/lessons/${away.data.id}/move`,
      { date: original.date, startTime: home.startTime },
      { 'if-match': String(away.data.version) },
    );
    expect(back.status, JSON.stringify(back.error)).toBe(200);
    expect(back.data.startAt).toBe(original.startAt);
  });

  it('cancelling requires a reason and frees the slot', async () => {
    const unit = await newUnit();
    const start = today();
    const slot = nextSlot();
    await createRule(unit.id, {
      ...slot,
      periodStart: start,
      periodEnd: plusDays(start, 2),
      classroomId: classroomA,
      teacherId: null,
    });

    const lessons = await lessonsOf(unit.id, start, plusDays(start, 2));
    const lesson = lessons[0] as LessonView;

    const noReason = await owner.post(`/api/v1/lessons/${lesson.id}/cancel`, {});
    expect(noReason.status).toBe(400);
    expect(noReason.error?.code).toBe('VALIDATION_ERROR');

    const res = await owner.post<LessonView>(
      `/api/v1/lessons/${lesson.id}/cancel`,
      { reason: 'Oʻqituvchi kasal' },
      { 'if-match': String(lesson.version) },
    );
    expect(res.status, JSON.stringify(res.error)).toBe(200);
    expect(res.data.status).toBe('cancelled');
    expect(res.data.cancelReason).toBe('Oʻqituvchi kasal');

    // The freed slot can be reused by an extra lesson for another group.
    const other = await newUnit();
    const extra = await owner.post<LessonView>('/api/v1/lessons', {
      studyUnitId: other.id,
      date: lesson.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      classroomId: classroomA,
    });
    expect(extra.status, JSON.stringify(extra.error)).toBe(201);
  });

  it('a cancelled lesson cannot be moved or cancelled again', async () => {
    const unit = await newUnit();
    const start = today();
    await createRule(unit.id, {
      periodStart: start,
      periodEnd: plusDays(start, 2),
      startTime: '11:00',
      endTime: '12:30',
      classroomId: null,
      teacherId: null,
    });

    const lessons = await lessonsOf(unit.id, start, plusDays(start, 2));
    const lesson = lessons[0] as LessonView;
    await owner.post(`/api/v1/lessons/${lesson.id}/cancel`, { reason: 'Sabab' });

    const move = await owner.post(`/api/v1/lessons/${lesson.id}/move`, {
      date: lesson.date,
      startTime: '16:00',
    });
    expect(move.status).toBe(409);
    expect(move.error?.code).toBe('LESSON_NOT_MUTABLE');
  });

  it('substituting a teacher changes actual_teacher_id only', async () => {
    const unit = await newUnit();
    const start = today();
    await createRule(unit.id, {
      ...nextSlot(),
      periodStart: start,
      periodEnd: plusDays(start, 2),
      classroomId: null,
      teacherId: teacherA,
    });

    const lessons = await lessonsOf(unit.id, start, plusDays(start, 2));
    const lesson = lessons[0] as LessonView;

    const res = await owner.post<LessonView>(
      `/api/v1/lessons/${lesson.id}/substitute`,
      { actualTeacherId: teacherB, reason: 'Kasallik' },
      { 'if-match': String(lesson.version) },
    );
    expect(res.status, JSON.stringify(res.error)).toBe(200);
    expect(res.data.teacherId).toBe(teacherA);
    expect(res.data.actualTeacherId).toBe(teacherB);
    expect(res.data.isSubstituted).toBe(true);
  });

  it('refuses a substitute who already teaches an overlapping lesson', async () => {
    const start = today();
    const slot = nextSlot();
    const busy = await newUnit();
    await createRule(busy.id, {
      ...slot,
      periodStart: start,
      periodEnd: plusDays(start, 2),
      classroomId: classroomB,
      teacherId: teacherB,
    });

    const unit = await newUnit();
    await createRule(unit.id, {
      ...slot,
      periodStart: start,
      periodEnd: plusDays(start, 2),
      classroomId: classroomA,
      teacherId: teacherA,
    });

    const lessons = await lessonsOf(unit.id, start, plusDays(start, 2));
    const lesson = lessons[0] as LessonView;

    const res = await owner.post(
      `/api/v1/lessons/${lesson.id}/substitute`,
      { actualTeacherId: teacherB },
      { 'if-match': String(lesson.version) },
    );
    expect(res.status).toBe(409);
    expect((res.error?.details as ConflictDetail[])[0]?.kind).toBe('teacher');
  });

  it('creates an extra lesson, always detached so regeneration leaves it alone', async () => {
    const unit = await newUnit();
    const start = today();
    const rule = await createRule(unit.id, {
      periodStart: start,
      periodEnd: plusDays(start, 2),
      startTime: '13:00',
      endTime: '14:30',
      classroomId: null,
      teacherId: null,
    });

    const extraDate = plusDays(start, 1);
    const extra = await owner.post<LessonView>('/api/v1/lessons', {
      studyUnitId: unit.id,
      date: extraDate,
      startTime: '21:00',
      endTime: '22:00',
      topic: 'Qoʻshimcha dars',
    });
    expect(extra.status, JSON.stringify(extra.error)).toBe(201);
    expect(extra.data.isDetached).toBe(true);

    await owner.patch(
      `/api/v1/schedule-rules/${rule.id}`,
      { startTime: '15:00', endTime: '16:30' },
      { 'if-match': String(rule.version) },
    );

    const after = await owner.get<LessonView>(`/api/v1/lessons/${extra.data.id}`);
    expect(after.status).toBe(200);
    expect(after.data.startAt).toBe(utcOf(extraDate, '21:00'));
  });
});

describe('UX 4.4 — GET /schedule/availability', () => {
  it('reports a free slot with candidate rooms and teachers', async () => {
    const start = today();
    const slot = nextSlot();
    const res = await owner.get<AvailabilityView>(
      `/api/v1/schedule/availability?date=${plusDays(start, 2)}&start_time=${slot.startTime}&end_time=${slot.endTime}&branch_id=${branchId}&classroom_id=${classroomA}&discipline_id=${disciplineId}`,
    );
    expect(res.status, JSON.stringify(res.error)).toBe(200);
    expect(res.data.free).toBe(true);
    // Teacher suggestions come from the `teacher` role, not from a
    // teacher_profiles row — a freshly created teacher has no profile yet
    // and must still be offered.
    expect(res.data.freeTeachers.length).toBeGreaterThan(0);
  });

  it('reports a taken slot and names the group holding it', async () => {
    const start = today();
    const slot = nextSlot();
    const unit = await newUnit();
    await createRule(unit.id, {
      ...slot,
      periodStart: start,
      periodEnd: plusDays(start, 4),
      classroomId: classroomA,
      teacherId: null,
    });

    const res = await owner.get<AvailabilityView>(
      `/api/v1/schedule/availability?date=${plusDays(start, 1)}&start_time=${slot.startTime}&end_time=${slot.endTime}&branch_id=${branchId}&classroom_id=${classroomA}`,
    );
    expect(res.data.free).toBe(false);
    expect(res.data.conflicts[0]?.kind).toBe('classroom');
    expect(res.data.conflicts[0]?.studyUnitName).toBeTruthy();
    expect(res.data.alternatives.classrooms.map((room) => room.classroomId)).toContain(classroomB);
  });

  it('does not count the lesson being dragged as a conflict with itself', async () => {
    const start = today();
    const slot = nextSlot();
    const unit = await newUnit();
    await createRule(unit.id, {
      ...slot,
      periodStart: start,
      periodEnd: plusDays(start, 2),
      classroomId: classroomA,
      teacherId: null,
    });
    const lessons = await lessonsOf(unit.id, start, plusDays(start, 2));
    const lesson = lessons[0] as LessonView;

    const res = await owner.get<AvailabilityView>(
      `/api/v1/schedule/availability?date=${lesson.date}&start_time=${slot.startTime}&end_time=${slot.endTime}&branch_id=${branchId}&classroom_id=${classroomA}&exclude_lesson_id=${lesson.id}`,
    );
    expect(res.data.free).toBe(true);
  });
});

describe('BR-U2 — forming → active requires an active schedule rule', () => {
  it('refuses the transition while the group has no rule', async () => {
    const unit = await newUnit();
    const res = await owner.post(
      `/api/v1/study-units/${unit.id}/status`,
      { status: 'active' },
      { 'if-match': String(unit.version) },
    );
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('SCHEDULE_RULE_REQUIRED');
  });

  it('allows it once a rule exists', async () => {
    const unit = await newUnit();
    await createRule(unit.id, { classroomId: null, teacherId: null });

    const res = await owner.post<{ status: string }>(
      `/api/v1/study-units/${unit.id}/status`,
      { status: 'active' },
      { 'if-match': String(unit.version) },
    );
    expect(res.status, JSON.stringify(res.error)).toBe(200);
    expect(res.data.status).toBe('active');
  });

  it('does not require a rule to resume a paused group', async () => {
    const unit = await newUnit();
    const rule = await createRule(unit.id, { classroomId: null, teacherId: null });

    let current = await owner.post<{ status: string; version: number }>(
      `/api/v1/study-units/${unit.id}/status`,
      { status: 'active' },
      { 'if-match': String(unit.version) },
    );
    current = await owner.post<{ status: string; version: number }>(
      `/api/v1/study-units/${unit.id}/status`,
      { status: 'paused' },
      { 'if-match': String(current.data.version) },
    );
    expect(current.data.status).toBe('paused');

    // The term ended and the rule was retired.
    await owner.delete(`/api/v1/schedule-rules/${rule.id}`, { 'if-match': String(rule.version) });

    const resumed = await owner.post<{ status: string }>(
      `/api/v1/study-units/${unit.id}/status`,
      { status: 'active' },
      { 'if-match': String(current.data.version) },
    );
    expect(resumed.status, JSON.stringify(resumed.error)).toBe(200);
    expect(resumed.data.status).toBe('active');
  });

  it('does not accept a deactivated rule as satisfying BR-U2', async () => {
    const unit = await newUnit();
    const rule = await createRule(unit.id, { classroomId: null, teacherId: null });
    await owner.delete(`/api/v1/schedule-rules/${rule.id}`, { 'if-match': String(rule.version) });

    const res = await owner.post(
      `/api/v1/study-units/${unit.id}/status`,
      { status: 'active' },
      { 'if-match': String(unit.version) },
    );
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('SCHEDULE_RULE_REQUIRED');
  });
});

describe('TZ M4.3 — the nightly horizon extension job', () => {
  it('refills lessons up to the horizon and is idempotent', async () => {
    const unit = await newUnit();
    const start = today();
    const rule = await createRule(unit.id, {
      periodStart: start,
      periodEnd: plusDays(start, 60),
      classroomId: null,
      teacherId: null,
    });
    // Every weekday is in the rule, so one lesson per day of the period —
    // minus any holiday another test in this file put inside it. Read the
    // real count rather than hard-coding 61, so the assertions below are
    // about the job and not about this file's holiday fixtures.
    const fullCount = rule.lessonCount;
    expect(fullCount).toBeGreaterThan(50);

    // Simulate a horizon that has fallen behind: drop the last three weeks
    // of generated lessons, as if the rule had been saved with a shorter
    // reach and the clock has since moved on.
    const removed = await sql<{ id: string }>(
      'DELETE FROM lessons WHERE schedule_rule_id = $1 AND date > $2 RETURNING id',
      [rule.id, plusDays(start, 39)],
    );
    expect(removed.length).toBeGreaterThan(0);

    const horizon = testApp.app.get(ScheduleHorizonService);
    const created = await runInTenant(tenantId, () => horizon.extendTenant());
    expect(created).toBe(removed.length);

    const after = await lessonsOf(unit.id, start, plusDays(start, 60));
    expect(after).toHaveLength(fullCount);

    // A second pass has nothing left to do — regeneration skips dates an
    // existing lesson already covers.
    const again = await runInTenant(tenantId, () => horizon.extendTenant());
    expect(again).toBe(0);
  });

  it('leaves existing lesson ids alone', async () => {
    // The job appends; it does not rebuild. A nightly rebuild would produce
    // the same dates and times but a fresh id for every planned lesson, and
    // lesson ids are what attendance (T09) and charges (T10) hang off.
    const unit = await newUnit();
    const start = today();
    await createRule(unit.id, {
      periodStart: start,
      periodEnd: plusDays(start, 20),
      classroomId: null,
      teacherId: null,
    });

    const before = (await lessonsOf(unit.id, start, plusDays(start, 20))).map((lesson) => lesson.id);
    expect(before.length).toBeGreaterThan(0);

    const horizon = testApp.app.get(ScheduleHorizonService);
    await runInTenant(tenantId, () => horizon.extendTenant());

    const after = (await lessonsOf(unit.id, start, plusDays(start, 20))).map((lesson) => lesson.id);
    expect(after).toEqual(before);
  });
});

describe('TZ M4.3 — total academic hours mode', () => {
  it('stops at the contracted hour budget rather than at a date', async () => {
    const unit = await newUnit();
    const start = today();
    const res = await owner.post<ScheduleRuleView>('/api/v1/schedule-rules', {
      studyUnitId: unit.id,
      daysOfWeek: EVERY_DAY,
      startTime: '19:45',
      academicHoursPerDay: 2,
      breakMinutes: 0,
      periodStart: start,
      totalAcademicHours: 12,
    });
    expect(res.status, JSON.stringify(res.error)).toBe(201);
    // 12 hours / 2 per lesson = 6 lessons.
    expect(res.data.lessonCount).toBe(6);

    const lessons = await lessonsOf(unit.id, start, plusDays(start, 365));
    expect(lessons).toHaveLength(6);
    expect(lessons[0]?.academicHours).toBe(2);
    // 2 academic hours = 90 minutes, no break: 19:45 -> 21:15 local.
    expect(lessons[0]?.startAt).toBe(utcOf(start, '19:45'));
    expect(lessons[0]?.endAt).toBe(utcOf(start, '21:15'));
  });

  it('pushes the end out rather than teaching fewer hours when a holiday lands mid-course', async () => {
    // A window 140 days out, with a single holiday inside it, so no other
    // test's holidays can affect which dates this course lands on.
    const periodStart = plusDays(today(), 140);
    const holiday = plusDays(periodStart, 2);
    await owner.post('/api/v1/holidays', { name: `Bayram ${uuidv7()}`, date: holiday, branchId });

    const unit = await newUnit();
    const res = await owner.post<ScheduleRuleView>('/api/v1/schedule-rules', {
      studyUnitId: unit.id,
      daysOfWeek: EVERY_DAY,
      startTime: '22:00',
      academicHoursPerDay: 2,
      breakMinutes: 0,
      periodStart,
      totalAcademicHours: 8,
    });
    expect(res.status, JSON.stringify(res.error)).toBe(201);
    // 8 hours / 2 per lesson: the holiday costs a *date*, never an hour.
    expect(res.data.lessonCount).toBe(4);

    const lessons = await lessonsOf(unit.id, periodStart, plusDays(periodStart, 30));
    expect(lessons.map((lesson) => lesson.date)).toEqual([
      periodStart,
      plusDays(periodStart, 1),
      plusDays(periodStart, 3),
      plusDays(periodStart, 4),
    ]);
    expect(lessons.map((lesson) => lesson.date)).not.toContain(holiday);
  });
});

describe('TZ M4.4 — the exclusion constraints as app_user, service bypassed', () => {
  it('refuses a second overlapping lesson in the same classroom (23P01)', async () => {
    const first = await newUnit();
    const second = await newUnit();
    const date = rawDate(0);

    await asAppUser(async (pg) => {
      expect(
        await insertRawLesson(pg, {
          studyUnitId: first.id,
          date,
          startTime: '18:00',
          endTime: '19:30',
          classroomId: classroomA,
        }),
      ).toBeNull();

      // Overlaps by 30 minutes, different group, same room.
      const error = await insertRawLesson(pg, {
        studyUnitId: second.id,
        date,
        startTime: '19:00',
        endTime: '20:30',
        classroomId: classroomA,
      });
      expect(error?.code).toBe('23P01');
      expect(error?.constraint).toBe('lessons_classroom_no_overlap');
    });
  });

  it('refuses a second overlapping lesson for the same actual_teacher_id (23P01)', async () => {
    const first = await newUnit();
    const second = await newUnit();
    const date = rawDate(1);

    await asAppUser(async (pg) => {
      expect(
        await insertRawLesson(pg, {
          studyUnitId: first.id,
          date,
          startTime: '18:00',
          endTime: '19:30',
          classroomId: null,
          actualTeacherId: teacherA,
        }),
      ).toBeNull();

      // No room at all, so only the teacher constraint can fire.
      const error = await insertRawLesson(pg, {
        studyUnitId: second.id,
        date,
        startTime: '19:00',
        endTime: '20:30',
        classroomId: null,
        actualTeacherId: teacherA,
      });
      expect(error?.code).toBe('23P01');
      expect(error?.constraint).toBe('lessons_teacher_no_overlap');
    });
  });

  it.each([
    { status: 'cancelled', cancelReason: 'Oʻqituvchi kasal', offset: 2 },
    { status: 'moved', cancelReason: null, offset: 3 },
  ])(
    'lets an overlapping lesson in when the first one is $status',
    async ({ status, cancelReason, offset }) => {
      // Both constraints carry `WHERE status NOT IN ('cancelled','moved')`,
      // so one overlapping row that reuses the room *and* the teacher proves
      // both halves of that filter at once.
      const first = await newUnit();
      const second = await newUnit();
      const date = rawDate(offset);

      await asAppUser(async (pg) => {
        expect(
          await insertRawLesson(pg, {
            studyUnitId: first.id,
            date,
            startTime: '18:00',
            endTime: '19:30',
            classroomId: classroomA,
            actualTeacherId: teacherA,
            status,
            cancelReason,
          }),
        ).toBeNull();

        expect(
          await insertRawLesson(pg, {
            studyUnitId: second.id,
            date,
            startTime: '19:00',
            endTime: '20:30',
            classroomId: classroomA,
            actualTeacherId: teacherA,
          }),
        ).toBeNull();
      });
    },
  );
});

describe('TZ M4.4 — two concurrent create requests for one slot', () => {
  it('gives exactly one 201 and one 409, never a 500, over ten rounds', async () => {
    // The race TZ M4.4 puts the constraint in the database for: both
    // requests pass `assertSlotFree` before either has inserted, so the
    // loser only finds out when the constraint fires mid-transaction. What
    // this asserts is that the loser still leaves through the UX P4 door —
    // 409 SCHEDULE_CONFLICT — and not as a raw 23P01 turned 500.
    //
    // Ten rounds because a race that is won the same way every time is a
    // race that was never run: a single pass can easily serialize by luck.
    const first = await newUnit();
    const second = await newUnit();

    for (let round = 0; round < 10; round += 1) {
      // A fresh date per round, so an earlier round's surviving lesson is
      // not what blocks the next one.
      const date = plusDays('2028-06-05', round);
      const body = { date, startTime: '18:00', endTime: '19:30', classroomId: classroomA };

      const [left, right] = await Promise.all([
        owner.post<LessonView>('/api/v1/lessons', { ...body, studyUnitId: first.id }),
        owner.post<LessonView>('/api/v1/lessons', { ...body, studyUnitId: second.id }),
      ]);

      const statuses = [left.status, right.status].sort((a, b) => a - b);
      expect(
        statuses,
        `round ${round}: ${JSON.stringify([left.error, right.error])}`,
      ).toEqual([201, 409]);

      const loser = left.status === 409 ? left : right;
      expect(loser.error?.code).toBe('SCHEDULE_CONFLICT');
      expect((loser.error?.details as ConflictDetail[])[0]?.kind).toBe('classroom');

      const rows = await sql<{ count: string }>(
        'SELECT count(*)::text AS count FROM lessons WHERE date = $1 AND classroom_id = $2',
        [date, classroomA],
      );
      expect(rows[0]?.count, `round ${round}`).toBe('1');
    }
  }, 180_000);
});

describe('permissions', () => {
  it('a teacher may read the calendar but not change it', async () => {
    const teacherPhone = `+99895${String(Date.now()).slice(-7)}`;
    await owner.post('/api/v1/employees', {
      fullName: `Faqat oʻqituvchi ${Date.now()}`,
      phone: teacherPhone,
      password: 'teacher-password-2',
      roleCodes: ['teacher'],
      branchIds: [branchId],
    });

    const teacher = new ApiClient(server);
    const slug = (await seedPrisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).slug;
    expect(await teacher.login(slug, teacherPhone, 'teacher-password-2')).toBe(200);

    const start = today();
    const read = await teacher.get(`/api/v1/lessons?from=${start}&to=${plusDays(start, 7)}`);
    expect(read.status).toBe(200);

    const unit = await newUnit();
    const write = await teacher.post('/api/v1/schedule-rules', ruleBody(unit.id));
    expect(write.status).toBe(403);
  });
});
