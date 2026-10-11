import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { uuidv7 } from '@educrm/shared';
import { startTestDatabase, type TestDatabase } from './setup';

/**
 * CLAUDE.md: "Every new tenant table must ship an RLS integration test
 * covering, at minimum, cross-tenant SELECT and cross-tenant INSERT both
 * being blocked." This is that test for the two tables T08 adds (TZ M4.3 /
 * M4.4): schedule_rules, lessons. Follows the shape of
 * rls-study-units.spec.ts.
 *
 * It also covers TZ M4.4's conflict control at the level the spec puts it
 * at — the database. These assertions deliberately bypass the API: the
 * whole point of an exclusion constraint is that it holds for *any* writer,
 * including a concurrent one, and only a direct two-connection test can
 * show that.
 */

let db: TestDatabase;
let tenantA: string;
let tenantB: string;
let fixtures: Record<string, Fixtures>;

interface Fixtures {
  branchId: string;
  disciplineId: string;
  studyUnitId: string;
  otherStudyUnitId: string;
  classroomId: string;
  otherClassroomId: string;
  teacherId: string;
  otherTeacherId: string;
  scheduleRuleId: string;
}

interface TableCase {
  table: string;
  columns: string[];
  values(tenantId: string, own: Fixtures): unknown[];
}

const CASES: TableCase[] = [
  {
    table: 'schedule_rules',
    columns: [
      'id',
      'tenant_id',
      'study_unit_id',
      'days_of_week',
      'start_time',
      'end_time',
      'period_start',
      'period_end',
    ],
    values: (tenantId, own) => [
      uuidv7(),
      tenantId,
      own.studyUnitId,
      '{1,3}',
      '18:00',
      '19:30',
      '2026-10-05',
      '2026-12-31',
    ],
  },
  {
    table: 'lessons',
    columns: ['id', 'tenant_id', 'study_unit_id', 'date', 'start_at', 'end_at'],
    values: (tenantId, own) => [
      uuidv7(),
      tenantId,
      own.studyUnitId,
      '2026-10-05',
      // No classroom and no teacher: outside both exclusion constraints, so
      // these RLS cases can be re-run without colliding with each other.
      '2026-10-05T13:00:00Z',
      '2026-10-05T14:30:00Z',
    ],
  },
];

const INSERT_LESSON = `INSERT INTO lessons
  (id, tenant_id, study_unit_id, date, start_at, end_at, classroom_id, actual_teacher_id, status, cancel_reason)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;

interface LessonOverrides {
  studyUnitId?: string;
  date?: string;
  startAt?: string;
  endAt?: string;
  classroomId?: string | null;
  actualTeacherId?: string | null;
  status?: string;
  cancelReason?: string | null;
}

/**
 * A lesson row for the constraint cases. `date` drives the instants too:
 * these constraints are about overlapping `tstzrange`s, so a helper that
 * changed only the `date` column would have every case in this file
 * colliding on one shared timestamp instead of testing what it says.
 */
function lessonValues(tenantId: string, own: Fixtures, overrides: LessonOverrides = {}): unknown[] {
  const date = overrides.date ?? '2026-11-02';
  return [
    uuidv7(),
    tenantId,
    overrides.studyUnitId ?? own.studyUnitId,
    date,
    overrides.startAt ?? `${date}T13:00:00Z`,
    overrides.endAt ?? `${date}T14:30:00Z`,
    overrides.classroomId === undefined ? own.classroomId : overrides.classroomId,
    overrides.actualTeacherId === undefined ? own.teacherId : overrides.actualTeacherId,
    overrides.status ?? 'planned',
    overrides.cancelReason ?? null,
  ];
}

function placeholders(count: number): string {
  return Array.from({ length: count }, (_, i) => `$${i + 1}`).join(', ');
}

async function connect(url: string, tenantId: string): Promise<PgClient> {
  const pg = new PgClient({ connectionString: url });
  await pg.connect();
  await pg.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
  return pg;
}

function migratorIn(tenantId: string): Promise<PgClient> {
  return connect(db.migratorUrl, tenantId);
}

function appUserIn(tenantId: string): Promise<PgClient> {
  return connect(db.appUserUrl, tenantId);
}

async function seedFixtures(tenantId: string): Promise<Fixtures> {
  const pg = await migratorIn(tenantId);
  try {
    const branchId = uuidv7();
    await pg.query('INSERT INTO branches (id, tenant_id, name, code) VALUES ($1, $2, $3, $4)', [
      branchId,
      tenantId,
      'Asosiy filial',
      `MAIN-${branchId}`,
    ]);
    const disciplineId = uuidv7();
    await pg.query('INSERT INTO disciplines (id, tenant_id, name) VALUES ($1, $2, $3)', [
      disciplineId,
      tenantId,
      `Fan ${disciplineId}`,
    ]);

    const studyUnitIds: string[] = [];
    for (const label of ['A', 'B']) {
      const id = uuidv7();
      await pg.query(
        `INSERT INTO study_units (id, tenant_id, branch_id, discipline_id, type, name, capacity, min_size)
         VALUES ($1, $2, $3, $4, 'group', $5, 12, 6)`,
        [id, tenantId, branchId, disciplineId, `Guruh ${label} ${id}`],
      );
      studyUnitIds.push(id);
    }

    const classroomIds: string[] = [];
    for (const name of ['204', '206']) {
      const id = uuidv7();
      await pg.query(
        'INSERT INTO classrooms (id, tenant_id, branch_id, name, capacity) VALUES ($1, $2, $3, $4, 20)',
        [id, tenantId, branchId, `Xona ${name} ${id}`],
      );
      classroomIds.push(id);
    }

    const teacherIds: string[] = [];
    for (const name of ['Birinchi', 'Ikkinchi']) {
      const id = uuidv7();
      await pg.query(
        'INSERT INTO users (id, tenant_id, full_name, password_hash) VALUES ($1, $2, $3, $4)',
        [id, tenantId, `${name} oʻqituvchi`, 'not-a-real-hash'],
      );
      teacherIds.push(id);
    }

    const scheduleRuleId = uuidv7();
    await pg.query(
      `INSERT INTO schedule_rules
         (id, tenant_id, study_unit_id, days_of_week, start_time, end_time, period_start, period_end, classroom_id, teacher_id)
       VALUES ($1, $2, $3, '{1,3}', '18:00', '19:30', '2026-10-05', '2026-12-31', $4, $5)`,
      [scheduleRuleId, tenantId, studyUnitIds[0], classroomIds[0], teacherIds[0]],
    );

    return {
      branchId,
      disciplineId,
      studyUnitId: studyUnitIds[0] as string,
      otherStudyUnitId: studyUnitIds[1] as string,
      classroomId: classroomIds[0] as string,
      otherClassroomId: classroomIds[1] as string,
      teacherId: teacherIds[0] as string,
      otherTeacherId: teacherIds[1] as string,
      scheduleRuleId,
    };
  } finally {
    await pg.end();
  }
}

beforeAll(async () => {
  db = await startTestDatabase();

  const pg = new PgClient({ connectionString: db.migratorUrl });
  await pg.connect();
  tenantA = uuidv7();
  tenantB = uuidv7();
  for (const [id, name] of [
    [tenantA, 'Schedule Tenant A'],
    [tenantB, 'Schedule Tenant B'],
  ]) {
    await pg.query('INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)', [
      id,
      name,
      `${String(name).toLowerCase().replace(/\s+/g, '-')}-${String(id)}`,
    ]);
  }
  await pg.end();

  fixtures = {
    [tenantA]: await seedFixtures(tenantA),
    [tenantB]: await seedFixtures(tenantB),
  };
}, 180_000);

afterAll(async () => {
  await db.stop();
}, 60_000);

describe.each(CASES)('Row-Level Security — $table', (testCase) => {
  const { table, columns } = testCase;
  const insertSql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders(columns.length)})`;

  it('tenant A cannot SELECT tenant B rows', async () => {
    const seededB = testCase.values(tenantB, fixtures[tenantB] as Fixtures);
    const bRowId = seededB[0] as string;
    const migratorB = await migratorIn(tenantB);
    try {
      await migratorB.query(insertSql, seededB);
    } finally {
      await migratorB.end();
    }

    const appUserA = await appUserIn(tenantA);
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
    const appUserA = await appUserIn(tenantA);
    try {
      const smuggled = testCase.values(tenantB, fixtures[tenantB] as Fixtures);
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

describe('TZ M4.4 — classroom conflict is blocked by the database', () => {
  it('rejects a second lesson overlapping in the same classroom', async () => {
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      await pg.query(
        INSERT_LESSON,
        lessonValues(tenantA, own, { date: '2026-11-09', startAt: '2026-11-09T13:00:00Z', endAt: '2026-11-09T14:30:00Z', actualTeacherId: null }),
      );
      // Overlaps by 30 minutes, different group, same room.
      await expect(
        pg.query(
          INSERT_LESSON,
          lessonValues(tenantA, own, {
            studyUnitId: own.otherStudyUnitId,
            date: '2026-11-09',
            startAt: '2026-11-09T14:00:00Z',
            endAt: '2026-11-09T15:30:00Z',
            actualTeacherId: null,
          }),
        ),
      ).rejects.toThrow(/lessons_classroom_no_overlap|exclusion/i);
    } finally {
      await pg.end();
    }
  });

  it('allows back-to-back lessons in the same classroom', async () => {
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      await pg.query(
        INSERT_LESSON,
        lessonValues(tenantA, own, { date: '2026-11-10', startAt: '2026-11-10T13:00:00Z', endAt: '2026-11-10T14:30:00Z', actualTeacherId: null }),
      );
      // `tstzrange` is half-open, so an end that equals the next start is
      // not an overlap — 18:00–19:30 then 19:30–21:00 must be allowed.
      await expect(
        pg.query(
          INSERT_LESSON,
          lessonValues(tenantA, own, {
            studyUnitId: own.otherStudyUnitId,
            date: '2026-11-10',
            startAt: '2026-11-10T14:30:00Z',
            endAt: '2026-11-10T16:00:00Z',
            actualTeacherId: null,
          }),
        ),
      ).resolves.toBeDefined();
    } finally {
      await pg.end();
    }
  });

  it('allows the same time in a different classroom (parallel lessons)', async () => {
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      await pg.query(
        INSERT_LESSON,
        lessonValues(tenantA, own, { date: '2026-11-11', actualTeacherId: null }),
      );
      await expect(
        pg.query(
          INSERT_LESSON,
          lessonValues(tenantA, own, {
            studyUnitId: own.otherStudyUnitId,
            date: '2026-11-11',
            classroomId: own.otherClassroomId,
            actualTeacherId: null,
          }),
        ),
      ).resolves.toBeDefined();
    } finally {
      await pg.end();
    }
  });
});

describe('TZ M4.4 — teacher conflict is blocked on actual_teacher_id', () => {
  it('rejects a second lesson overlapping for the same actual_teacher_id', async () => {
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      await pg.query(
        INSERT_LESSON,
        lessonValues(tenantA, own, { date: '2026-11-16', classroomId: null }),
      );
      // Different room, same teacher — still blocked.
      await expect(
        pg.query(
          INSERT_LESSON,
          lessonValues(tenantA, own, {
            studyUnitId: own.otherStudyUnitId,
            date: '2026-11-16',
            classroomId: null,
            startAt: '2026-11-16T14:00:00Z',
            endAt: '2026-11-16T15:30:00Z',
          }),
        ),
      ).rejects.toThrow(/lessons_teacher_no_overlap|exclusion/i);
    } finally {
      await pg.end();
    }
  });

  it('allows the same slot for a different teacher', async () => {
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      await pg.query(
        INSERT_LESSON,
        lessonValues(tenantA, own, { date: '2026-11-17', classroomId: null }),
      );
      await expect(
        pg.query(
          INSERT_LESSON,
          lessonValues(tenantA, own, {
            studyUnitId: own.otherStudyUnitId,
            date: '2026-11-17',
            classroomId: null,
            actualTeacherId: own.otherTeacherId,
          }),
        ),
      ).resolves.toBeDefined();
    } finally {
      await pg.end();
    }
  });

  it('keys the constraint on actual_teacher_id, not teacher_id', async () => {
    // TZ M4.4 (TUZATILDI): v1.0 checked `teacher_id`, which left a
    // substitute's own calendar unprotected. Two lessons scheduled for
    // *different* teachers but actually taught by the same substitute must
    // collide.
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      await pg.query(
        `INSERT INTO lessons (id, tenant_id, study_unit_id, date, start_at, end_at, teacher_id, actual_teacher_id)
         VALUES ($1, $2, $3, '2026-11-18', '2026-11-18T13:00:00Z', '2026-11-18T14:30:00Z', $4, $5)`,
        [uuidv7(), tenantA, own.studyUnitId, own.teacherId, own.otherTeacherId],
      );
      await expect(
        pg.query(
          `INSERT INTO lessons (id, tenant_id, study_unit_id, date, start_at, end_at, teacher_id, actual_teacher_id)
           VALUES ($1, $2, $3, '2026-11-18', '2026-11-18T13:00:00Z', '2026-11-18T14:30:00Z', $4, $5)`,
          [uuidv7(), tenantA, own.otherStudyUnitId, own.otherTeacherId, own.otherTeacherId],
        ),
      ).rejects.toThrow(/lessons_teacher_no_overlap|exclusion/i);
    } finally {
      await pg.end();
    }
  });
});

describe('TZ M4.4 — cancelled and moved lessons release their slot', () => {
  it('a cancelled lesson does not block a new one in the same room and time', async () => {
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      await pg.query(
        INSERT_LESSON,
        lessonValues(tenantA, own, {
          date: '2026-11-23',
          status: 'cancelled',
          cancelReason: 'Oʻqituvchi kasal',
        }),
      );
      await expect(
        pg.query(INSERT_LESSON, lessonValues(tenantA, own, { date: '2026-11-23' })),
      ).resolves.toBeDefined();
    } finally {
      await pg.end();
    }
  });

  it('a moved lesson does not keep its old slot busy', async () => {
    // This is the v1.0 bug TZ M4.4 records as fixed: the old row used to
    // stay in the constraint, so a lesson could never be moved back.
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      await pg.query(
        INSERT_LESSON,
        lessonValues(tenantA, own, { date: '2026-11-24', status: 'moved' }),
      );
      await expect(
        pg.query(INSERT_LESSON, lessonValues(tenantA, own, { date: '2026-11-24' })),
      ).resolves.toBeDefined();
    } finally {
      await pg.end();
    }
  });

  it('a completed lesson still blocks its slot', async () => {
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      await pg.query(
        INSERT_LESSON,
        lessonValues(tenantA, own, { date: '2026-11-25', status: 'completed' }),
      );
      await expect(
        pg.query(INSERT_LESSON, lessonValues(tenantA, own, { date: '2026-11-25' })),
      ).rejects.toThrow(/exclusion|no_overlap/i);
    } finally {
      await pg.end();
    }
  });
});

describe('TZ M4.4 — the parallel race the constraint exists for', () => {
  it('two simultaneous inserts of the same slot leave exactly one lesson', async () => {
    // The reason TZ M4.4 puts this in the database and not in a service:
    // "SELECT ... overlaps keyin INSERT — race condition." Both writers
    // below would pass any application-level pre-check.
    const own = fixtures[tenantA] as Fixtures;
    const first = await appUserIn(tenantA);
    const second = await appUserIn(tenantA);
    const date = '2026-12-07';

    try {
      await first.query('BEGIN');
      await second.query('BEGIN');

      await first.query(
        INSERT_LESSON,
        lessonValues(tenantA, own, { date, actualTeacherId: null }),
      );

      // The exclusion constraint makes this *block* rather than fail fast:
      // Postgres cannot decide until the first transaction's fate is known.
      const contender = second
        .query(
          INSERT_LESSON,
          lessonValues(tenantA, own, {
            studyUnitId: own.otherStudyUnitId,
            date,
            actualTeacherId: null,
          }),
        )
        .then(() => 'won' as const)
        .catch((error: unknown) => error as Error);

      await first.query('COMMIT');

      const outcome = await contender;
      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).toMatch(/exclusion|lessons_classroom_no_overlap/i);
      await second.query('ROLLBACK');

      const surviving = await first.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM lessons WHERE date = $1 AND classroom_id = $2',
        [date, own.classroomId],
      );
      expect(surviving.rows[0]?.count).toBe('1');
    } finally {
      await first.end();
      await second.end();
    }
  }, 60_000);
});

describe('TZ M4.3 — a lesson with attendance is never deleted', () => {
  it('the DELETE guard trigger refuses a lesson carrying attendance', async () => {
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      const id = uuidv7();
      await pg.query(
        `INSERT INTO lessons (id, tenant_id, study_unit_id, date, start_at, end_at, attendance_count)
         VALUES ($1, $2, $3, '2026-12-14', '2026-12-14T13:00:00Z', '2026-12-14T14:30:00Z', 3)`,
        [id, tenantA, own.studyUnitId],
      );
      await expect(pg.query('DELETE FROM lessons WHERE id = $1', [id])).rejects.toThrow(
        /has attendance and cannot be deleted/i,
      );
    } finally {
      await pg.end();
    }
  });

  it('the same guard refuses a completed lesson', async () => {
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      const id = uuidv7();
      await pg.query(
        `INSERT INTO lessons (id, tenant_id, study_unit_id, date, start_at, end_at, status)
         VALUES ($1, $2, $3, '2026-12-15', '2026-12-15T13:00:00Z', '2026-12-15T14:30:00Z', 'completed')`,
        [id, tenantA, own.studyUnitId],
      );
      await expect(pg.query('DELETE FROM lessons WHERE id = $1', [id])).rejects.toThrow(
        /is completed and cannot be deleted/i,
      );
    } finally {
      await pg.end();
    }
  });

  it('an unprotected planned lesson is still deletable', async () => {
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      const id = uuidv7();
      await pg.query(
        `INSERT INTO lessons (id, tenant_id, study_unit_id, date, start_at, end_at)
         VALUES ($1, $2, $3, '2026-12-16', '2026-12-16T13:00:00Z', '2026-12-16T14:30:00Z')`,
        [id, tenantA, own.studyUnitId],
      );
      await expect(pg.query('DELETE FROM lessons WHERE id = $1', [id])).resolves.toBeDefined();
    } finally {
      await pg.end();
    }
  });
});

describe('value constraints', () => {
  it('refuses a cancelled lesson with no reason (TZ M4.5)', async () => {
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      await expect(
        pg.query(
          INSERT_LESSON,
          lessonValues(tenantA, own, {
            date: '2026-12-21',
            status: 'cancelled',
            cancelReason: null,
            classroomId: null,
            actualTeacherId: null,
          }),
        ),
      ).rejects.toThrow(/lessons_cancel_reason_required/i);
    } finally {
      await pg.end();
    }
  });

  it('refuses a lesson that ends before it starts', async () => {
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      await expect(
        pg.query(
          INSERT_LESSON,
          lessonValues(tenantA, own, {
            date: '2026-12-22',
            startAt: '2026-12-22T14:30:00Z',
            endAt: '2026-12-22T13:00:00Z',
            classroomId: null,
            actualTeacherId: null,
          }),
        ),
      ).rejects.toThrow(/lessons_time_order/i);
    } finally {
      await pg.end();
    }
  });

  it('refuses a rule with both endTime and academicHoursPerDay (TZ M4.3 "yoki")', async () => {
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      await expect(
        pg.query(
          `INSERT INTO schedule_rules
             (id, tenant_id, study_unit_id, days_of_week, start_time, end_time, academic_hours_per_day, period_start, period_end)
           VALUES ($1, $2, $3, '{1}', '18:00', '19:30', 2, '2026-10-05', '2026-12-31')`,
          [uuidv7(), tenantA, own.studyUnitId],
        ),
      ).rejects.toThrow(/schedule_rules_duration_source/i);
    } finally {
      await pg.end();
    }
  });

  it('refuses a rule with neither a period end nor an hour budget', async () => {
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      await expect(
        pg.query(
          `INSERT INTO schedule_rules
             (id, tenant_id, study_unit_id, days_of_week, start_time, end_time, period_start)
           VALUES ($1, $2, $3, '{1}', '18:00', '19:30', '2026-10-05')`,
          [uuidv7(), tenantA, own.studyUnitId],
        ),
      ).rejects.toThrow(/schedule_rules_period_end_source/i);
    } finally {
      await pg.end();
    }
  });

  it('refuses a weekday outside 1..7 and an empty weekday list', async () => {
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      for (const days of ['{0,1}', '{8}', '{}']) {
        await expect(
          pg.query(
            `INSERT INTO schedule_rules
               (id, tenant_id, study_unit_id, days_of_week, start_time, end_time, period_start, period_end)
             VALUES ($1, $2, $3, $4, '18:00', '19:30', '2026-10-05', '2026-12-31')`,
            [uuidv7(), tenantA, own.studyUnitId, days],
          ),
        ).rejects.toThrow(/schedule_rules_days_of_week_valid/i);
      }
    } finally {
      await pg.end();
    }
  });

  it('refuses a start_time that is not a clock time', async () => {
    const own = fixtures[tenantA] as Fixtures;
    const pg = await migratorIn(tenantA);
    try {
      await expect(
        pg.query(
          `INSERT INTO schedule_rules
             (id, tenant_id, study_unit_id, days_of_week, start_time, end_time, period_start, period_end)
           VALUES ($1, $2, $3, '{1}', '6pm', '19:30', '2026-10-05', '2026-12-31')`,
          [uuidv7(), tenantA, own.studyUnitId],
        ),
      ).rejects.toThrow(/schedule_rules_start_time_format/i);
    } finally {
      await pg.end();
    }
  });
});

describe('cross-tenant references are structurally impossible', () => {
  it('a lesson cannot point at another tenant’s classroom', async () => {
    const pg = await appUserIn(tenantA);
    try {
      await expect(
        pg.query(
          `INSERT INTO lessons (id, tenant_id, study_unit_id, date, start_at, end_at, classroom_id)
           VALUES ($1, $2, $3, '2027-01-04', '2027-01-04T13:00:00Z', '2027-01-04T14:30:00Z', $4)`,
          [
            uuidv7(),
            tenantA,
            (fixtures[tenantA] as Fixtures).studyUnitId,
            (fixtures[tenantB] as Fixtures).classroomId,
          ],
        ),
      ).rejects.toThrow(/foreign key|violates/i);
    } finally {
      await pg.end();
    }
  });

  it('a schedule_rule cannot point at another tenant’s study_unit', async () => {
    const pg = await appUserIn(tenantA);
    try {
      await expect(
        pg.query(
          `INSERT INTO schedule_rules
             (id, tenant_id, study_unit_id, days_of_week, start_time, end_time, period_start, period_end)
           VALUES ($1, $2, $3, '{1}', '18:00', '19:30', '2026-10-05', '2026-12-31')`,
          [uuidv7(), tenantA, (fixtures[tenantB] as Fixtures).studyUnitId],
        ),
      ).rejects.toThrow(/foreign key|violates/i);
    } finally {
      await pg.end();
    }
  });
});
