import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRID,
  addDays,
  buildWeekGrid,
  classroomPalette,
  conflictSummary,
  conflictSummaryFromError,
  dropTarget,
  formatClock,
  formatDayNumber,
  gridBoundsFor,
  gridRows,
  isoWeekday,
  lessonDurationMinutes,
  localDate,
  localMinutes,
  localTime,
  parseClock,
  placeDayLessons,
  statusClass,
  weekDates,
  weekStart,
  type Availability,
  type Lesson,
} from '@/lib/schedule';

/**
 * The week calendar's geometry (TZ M4.6 / UX P4). All of it is pure, which
 * is the point: "parallel lessons sit side by side" and "today's column is
 * highlighted" are layout *rules*, and a rule that is only expressed inside
 * JSX cannot be checked.
 */

const TASHKENT = 'Asia/Tashkent';

let lessonCounter = 0;
function lesson(overrides: Partial<Lesson> & { date: string; startAt: string; endAt: string }): Lesson {
  lessonCounter += 1;
  return {
    id: `lesson-${lessonCounter}`,
    studyUnitId: 'unit-1',
    studyUnitName: 'Ingliz tili B1',
    studyUnitColor: null,
    branchId: 'branch-1',
    scheduleRuleId: 'rule-1',
    classroomId: 'room-1',
    classroomName: 'Xona 204',
    teacherId: 'teacher-1',
    teacherName: 'Oʻqituvchi',
    actualTeacherId: 'teacher-1',
    actualTeacherName: 'Oʻqituvchi',
    isSubstituted: false,
    status: 'planned',
    isDetached: false,
    academicHours: 2,
    topic: null,
    cancelReason: null,
    movedToLessonId: null,
    makeupForLessonId: null,
    attendanceCount: 0,
    version: 1,
    ...overrides,
  };
}

/** A lesson on `date` running `startTime`–`endTime` Tashkent local. */
function at(date: string, startTime: string, endTime: string, overrides: Partial<Lesson> = {}): Lesson {
  const toUtc = (time: string): string => {
    const instant = new Date(`${date}T00:00:00.000Z`);
    instant.setUTCMinutes(instant.getUTCMinutes() + parseClock(time) - 300);
    return instant.toISOString();
  };
  return lesson({ date, startAt: toUtc(startTime), endAt: toUtc(endTime), ...overrides });
}

describe('clock helpers', () => {
  it('round-trips HH:MM', () => {
    for (const time of ['00:00', '09:15', '18:00', '23:45']) {
      expect(formatClock(parseClock(time))).toBe(time);
    }
  });

  it('formats a day number as DD.MM', () => {
    expect(formatDayNumber('2026-10-05')).toBe('05.10');
  });
});

describe('timezone rendering', () => {
  it('renders an instant in the branch timezone, not the viewer’s', () => {
    // 13:00Z is 18:00 in Tashkent. A viewer in London must still see the
    // lesson on the 18:00 row.
    expect(localTime('2026-10-05T13:00:00.000Z', TASHKENT)).toBe('18:00');
    expect(localDate('2026-10-05T13:00:00.000Z', TASHKENT)).toBe('2026-10-05');
    expect(localMinutes('2026-10-05T13:00:00.000Z', TASHKENT)).toBe(18 * 60);
  });

  it('keeps a late-evening lesson on its local date', () => {
    // 22:30 Tashkent on the 5th is 17:30Z the same day.
    expect(localDate('2026-10-05T17:30:00.000Z', TASHKENT)).toBe('2026-10-05');
    // 01:00 Tashkent on the 6th is 20:00Z on the 5th.
    expect(localDate('2026-10-05T20:00:00.000Z', TASHKENT)).toBe('2026-10-06');
  });
});

describe('week arithmetic', () => {
  it('maps dates to ISO weekdays with Sunday last', () => {
    expect(isoWeekday('2026-10-05')).toBe(1);
    expect(isoWeekday('2026-10-11')).toBe(7);
  });

  it('starts the week on Monday', () => {
    // The whole week of 5–11 October 2026 resolves to Monday the 5th.
    for (const date of [
      '2026-10-05',
      '2026-10-07',
      '2026-10-10',
      '2026-10-11',
    ]) {
      expect(weekStart(date)).toBe('2026-10-05');
    }
    // The next day is already the following week.
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
  });

  it('lists the seven dates of a week in order', () => {
    expect(weekDates('2026-10-08')).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ]);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });
});

describe('grid bounds', () => {
  it('uses the working-day default when every lesson fits inside it', () => {
    const bounds = gridBoundsFor([at('2026-10-05', '18:00', '19:30')], TASHKENT);
    expect(bounds).toEqual(DEFAULT_GRID);
  });

  it('stretches to cover an early lesson rather than clipping it', () => {
    const bounds = gridBoundsFor([at('2026-10-05', '06:30', '08:00')], TASHKENT);
    expect(bounds.startMinute).toBe(6 * 60);
    expect(bounds.endMinute).toBe(DEFAULT_GRID.endMinute);
  });

  it('stretches to cover a late lesson', () => {
    const bounds = gridBoundsFor([at('2026-10-05', '21:00', '22:45')], TASHKENT);
    expect(bounds.endMinute).toBe(23 * 60);
  });

  it('does not add a row for a lesson ending exactly on the hour', () => {
    const bounds = gridBoundsFor([at('2026-10-05', '20:00', '22:00')], TASHKENT);
    expect(bounds.endMinute).toBe(22 * 60);
  });

  it('produces one row label per step', () => {
    const rows = gridRows({ startMinute: 8 * 60, endMinute: 11 * 60, stepMinutes: 60 });
    expect(rows.map(formatClock)).toEqual(['08:00', '09:00', '10:00']);
  });
});

describe('placeDayLessons — vertical placement', () => {
  const bounds = { startMinute: 8 * 60, endMinute: 20 * 60, stepMinutes: 60 };

  it('positions a lesson proportionally within the grid', () => {
    const [placed] = placeDayLessons([at('2026-10-05', '14:00', '15:00')], bounds, TASHKENT);
    // 14:00 is halfway through an 08:00–20:00 grid.
    expect(placed?.top).toBeCloseTo(50, 5);
    // One hour of a twelve-hour grid.
    expect(placed?.height).toBeCloseTo(100 / 12, 5);
  });

  it('gives a zero-length lesson a visible minimum height', () => {
    const [placed] = placeDayLessons(
      [lesson({ date: '2026-10-05', startAt: '2026-10-05T09:00:00Z', endAt: '2026-10-05T09:00:00Z' })],
      bounds,
      TASHKENT,
    );
    expect(placed?.height).toBeGreaterThan(0);
  });
});

describe('placeDayLessons — parallel lessons side by side (UX P4)', () => {
  const bounds = { startMinute: 8 * 60, endMinute: 20 * 60, stepMinutes: 60 };

  it('gives a lone lesson the full width', () => {
    const [placed] = placeDayLessons([at('2026-10-05', '18:00', '19:30')], bounds, TASHKENT);
    expect(placed?.column).toBe(0);
    expect(placed?.columns).toBe(1);
  });

  it('splits two overlapping lessons into two columns', () => {
    const placed = placeDayLessons(
      [at('2026-10-05', '18:00', '19:30'), at('2026-10-05', '18:30', '20:00')],
      bounds,
      TASHKENT,
    );
    expect(placed.map((entry) => entry.column)).toEqual([0, 1]);
    // Both report the same total, so the two blocks render the same width.
    expect(placed.map((entry) => entry.columns)).toEqual([2, 2]);
  });

  it('splits three concurrent lessons into three columns', () => {
    const placed = placeDayLessons(
      [
        at('2026-10-05', '18:00', '19:30'),
        at('2026-10-05', '18:00', '19:30'),
        at('2026-10-05', '18:00', '19:30'),
      ],
      bounds,
      TASHKENT,
    );
    expect(placed.map((entry) => entry.column)).toEqual([0, 1, 2]);
    expect(new Set(placed.map((entry) => entry.columns))).toEqual(new Set([3]));
  });

  it('keeps non-overlapping lessons in one full-width column each', () => {
    const placed = placeDayLessons(
      [at('2026-10-05', '09:00', '10:00'), at('2026-10-05', '18:00', '19:00')],
      bounds,
      TASHKENT,
    );
    expect(placed.map((entry) => entry.columns)).toEqual([1, 1]);
    expect(placed.map((entry) => entry.column)).toEqual([0, 0]);
  });

  it('treats back-to-back lessons as non-overlapping', () => {
    // 18:00–19:30 then 19:30–21:00 share only an instant, which is not an
    // overlap — the same half-open rule the DB constraint uses.
    const placed = placeDayLessons(
      [at('2026-10-05', '18:00', '19:30'), at('2026-10-05', '19:30', '21:00')],
      { startMinute: 8 * 60, endMinute: 22 * 60, stepMinutes: 60 },
      TASHKENT,
    );
    expect(placed.map((entry) => entry.columns)).toEqual([1, 1]);
  });

  it('reuses a column once its occupant has ended', () => {
    // A long lesson spanning two short ones: the short ones take column 1
    // in turn rather than forcing a third column.
    const placed = placeDayLessons(
      [
        at('2026-10-05', '09:00', '13:00'),
        at('2026-10-05', '09:30', '10:30'),
        at('2026-10-05', '11:00', '12:00'),
      ],
      bounds,
      TASHKENT,
    );
    expect(placed.map((entry) => entry.column)).toEqual([0, 1, 1]);
    expect(new Set(placed.map((entry) => entry.columns))).toEqual(new Set([2]));
  });

  it('sizes two separate overlap groups independently', () => {
    const placed = placeDayLessons(
      [
        at('2026-10-05', '09:00', '10:00'),
        at('2026-10-05', '09:30', '10:30'),
        at('2026-10-05', '18:00', '19:00'),
      ],
      bounds,
      TASHKENT,
    );
    // The morning pair needs two columns; the evening lesson stands alone.
    expect(placed.map((entry) => entry.columns)).toEqual([2, 2, 1]);
  });
});

describe('buildWeekGrid', () => {
  const today = '2026-10-07';

  it('always produces seven columns, Monday first', () => {
    const grid = buildWeekGrid('2026-10-08', [], today, TASHKENT);
    expect(grid.days).toHaveLength(7);
    expect(grid.days[0]?.date).toBe('2026-10-05');
    expect(grid.days[6]?.date).toBe('2026-10-11');
  });

  it('highlights exactly one column — today’s', () => {
    const grid = buildWeekGrid('2026-10-08', [], today, TASHKENT);
    expect(grid.days.filter((day) => day.isToday).map((day) => day.date)).toEqual([today]);
  });

  it('highlights no column for a week that does not contain today', () => {
    const grid = buildWeekGrid('2026-11-02', [], today, TASHKENT);
    expect(grid.days.some((day) => day.isToday)).toBe(false);
  });

  it('marks Saturday and Sunday as the weekend', () => {
    const grid = buildWeekGrid('2026-10-08', [], today, TASHKENT);
    expect(grid.days.filter((day) => day.isWeekend).map((day) => day.date)).toEqual([
      '2026-10-10',
      '2026-10-11',
    ]);
  });

  it('files each lesson under its own date column', () => {
    const grid = buildWeekGrid(
      '2026-10-08',
      [at('2026-10-05', '18:00', '19:30'), at('2026-10-07', '18:00', '19:30')],
      today,
      TASHKENT,
    );
    expect(grid.days[0]?.placed).toHaveLength(1);
    expect(grid.days[1]?.placed).toHaveLength(0);
    expect(grid.days[2]?.placed).toHaveLength(1);
  });

  it('trusts the lesson’s own date rather than re-deriving it', () => {
    // The API resolved this lesson's date in the branch timezone. A late
    // lesson whose instant lands on the next UTC day must stay on the
    // column the backend said it belongs to.
    const late = lesson({
      date: '2026-10-05',
      startAt: '2026-10-05T19:00:00.000Z',
      endAt: '2026-10-05T20:30:00.000Z',
    });
    const grid = buildWeekGrid('2026-10-08', [late], today, TASHKENT);
    expect(grid.days[0]?.placed.map((entry) => entry.lesson.id)).toEqual([late.id]);
  });

  it('shares one set of bounds across every column', () => {
    const grid = buildWeekGrid(
      '2026-10-08',
      [at('2026-10-05', '07:00', '08:00'), at('2026-10-09', '18:00', '19:00')],
      today,
      TASHKENT,
    );
    // The early Monday lesson widens the grid for the whole week, so rows
    // line up across columns.
    expect(grid.bounds.startMinute).toBe(7 * 60);
  });
});

describe('classroom colours (UX P4 "rang — xona boʻyicha")', () => {
  it('is stable for a given classroom', () => {
    expect(classroomPalette('room-1')).toEqual(classroomPalette('room-1'));
  });

  it('distinguishes a lesson with no classroom', () => {
    const none = classroomPalette(null);
    expect(none.block).toContain('border-dashed');
    expect(none).not.toEqual(classroomPalette('room-1'));
  });

  it('spreads real classrooms across the palette', () => {
    const ids = Array.from({ length: 40 }, (_, index) => `room-${index}`);
    const distinct = new Set(ids.map((id) => classroomPalette(id).bar));
    // Not a uniqueness guarantee — a palette has finitely many slots — but
    // a single-colour calendar would mean the hash is broken.
    expect(distinct.size).toBeGreaterThan(3);
  });
});

describe('status styling', () => {
  it('strikes a cancelled lesson through rather than recolouring it', () => {
    expect(statusClass('cancelled')).toContain('line-through');
  });

  it('leaves a planned lesson unstyled', () => {
    expect(statusClass('planned')).toBe('');
  });
});

describe('dropTarget (drag to move)', () => {
  const bounds = { startMinute: 8 * 60, endMinute: 20 * 60, stepMinutes: 60 };

  it('maps a vertical offset to a snapped time', () => {
    // Halfway down an 08:00–20:00 grid is 14:00.
    expect(dropTarget('2026-10-05', 0.5, bounds, 90).startTime).toBe('14:00');
  });

  it('snaps to the nearest 15 minutes', () => {
    // 08:00 + 0.05 * 720 = 08:36 -> 08:30.
    expect(dropTarget('2026-10-05', 0.05, bounds, 90).startTime).toBe('08:30');
  });

  it('preserves the lesson length', () => {
    const target = dropTarget('2026-10-05', 0.4, bounds, 90);
    expect(parseClock(target.endTime) - parseClock(target.startTime)).toBe(90);
  });

  it('clamps a drop above the grid to its first row', () => {
    expect(dropTarget('2026-10-05', -5, bounds, 90).startTime).toBe('08:00');
  });

  it('never lets the lesson end past the bottom of the grid', () => {
    const target = dropTarget('2026-10-05', 5, bounds, 90);
    expect(parseClock(target.endTime)).toBeLessThanOrEqual(bounds.endMinute);
  });

  it('never lets a drop push the lesson to or past midnight', () => {
    // `24:00` is not expressible in the API's HH:MM format, so the last
    // usable slot ends strictly before it — and stays on the snap grid.
    const lateGrid = { startMinute: 8 * 60, endMinute: 24 * 60, stepMinutes: 60 };
    const target = dropTarget('2026-10-05', 1, lateGrid, 120);
    expect(target.startTime).toBe('21:45');
    expect(target.endTime).toBe('23:45');
    expect(parseClock(target.endTime)).toBeLessThan(24 * 60);
  });

  it('keeps every drop within a valid HH:MM range', () => {
    const lateGrid = { startMinute: 0, endMinute: 24 * 60, stepMinutes: 60 };
    for (const ratio of [0, 0.25, 0.5, 0.75, 0.99, 1]) {
      for (const duration of [45, 90, 180]) {
        const target = dropTarget('2026-10-05', ratio, lateGrid, duration);
        expect(target.startTime).toMatch(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
        expect(target.endTime).toMatch(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
      }
    }
  });

  it('keeps the dropped column’s date', () => {
    expect(dropTarget('2026-10-09', 0.5, bounds, 60).date).toBe('2026-10-09');
  });
});

describe('lessonDurationMinutes', () => {
  it('measures a lesson in whole minutes', () => {
    expect(lessonDurationMinutes(at('2026-10-05', '18:00', '19:30'))).toBe(90);
  });
});

describe('conflictSummary (UX P4 sentence)', () => {
  const labels = {
    busy: 'band',
    free: 'Boʻsh',
    or: 'yoki',
    roomBusy: 'Xona',
    teacherBusy: 'Oʻqituvchi',
  };

  function availability(overrides: Partial<Availability> = {}): Availability {
    return {
      free: false,
      conflicts: [
        {
          kind: 'classroom',
          lessonId: 'other-lesson',
          studyUnitName: 'Ingliz A2',
          startAt: '2026-10-05T13:00:00.000Z',
          endAt: '2026-10-05T14:30:00.000Z',
        },
      ],
      alternatives: {
        classrooms: [
          { classroomId: 'r2', classroomName: '206', capacity: 12 },
          { classroomId: 'r3', classroomName: '301', capacity: 20 },
        ],
        times: [{ startTime: '19:30', endTime: '21:00' }],
      },
      freeTeachers: [],
      ...overrides,
    };
  }

  it('names the blocker and both kinds of alternative', () => {
    expect(conflictSummary(availability(), labels)).toBe(
      'Xona (Ingliz A2) band. Boʻsh: 206, 301 · yoki 19:30',
    );
  });

  it('says nothing when the slot is free', () => {
    expect(conflictSummary(availability({ free: true, conflicts: [] }), labels)).toBe('');
  });

  it('names the teacher when that is what clashes', () => {
    const summary = conflictSummary(
      availability({
        conflicts: [
          {
            kind: 'teacher',
            lessonId: 'other',
            studyUnitName: 'Ingliz A2',
            startAt: '',
            endAt: '',
          },
        ],
      }),
      labels,
    );
    expect(summary.startsWith('Oʻqituvchi (Ingliz A2) band')).toBe(true);
  });

  it('omits the suggestion clause when there is nothing to suggest', () => {
    const summary = conflictSummary(
      availability({ alternatives: { classrooms: [], times: [] } }),
      labels,
    );
    expect(summary).toBe('Xona (Ingliz A2) band');
  });

  it('produces the same sentence from a SCHEDULE_CONFLICT error body', () => {
    const fromError = conflictSummaryFromError(
      {
        kind: 'classroom',
        conflicting_lesson: {
          id: 'other-lesson',
          study_unit_name: 'Ingliz A2',
          start_at: '2026-10-05T13:00:00.000Z',
          end_at: '2026-10-05T14:30:00.000Z',
        },
        free_classrooms: [
          { id: 'r2', name: '206', capacity: 12 },
          { id: 'r3', name: '301', capacity: 20 },
        ],
        free_times: [{ start_time: '19:30', end_time: '21:00' }],
      },
      labels,
    );
    // The tooltip (live, from /availability) and the toast (from a 409)
    // must not drift apart — same function, same sentence.
    expect(fromError).toBe(conflictSummary(availability(), labels));
  });
});
