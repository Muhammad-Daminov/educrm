import { describe, expect, it } from 'vitest';
import {
  ACADEMIC_HOUR_MINUTES,
  HORIZON_MONTHS,
  addDays,
  addMonths,
  generateLessons,
  horizonEnd,
  isoWeekday,
  occurrenceAcademicHours,
  occurrenceMinutes,
  timeShiftCandidates,
  type ScheduleRuleInput,
} from '../../src/schedule/lesson-generation';
import {
  formatClockTime,
  parseClockTime,
  utcToZonedDate,
  utcToZonedTime,
  zonedTimeToUtc,
} from '../../src/schedule/zoned-time.util';

/**
 * TZ M4.3 generation rules, tested without a database — this is where the
 * SHART behaviours (holidays skipped, rolling 6-month horizon, the
 * total-hours budget pushing the period out rather than teaching less) are
 * actually decided.
 */

const TASHKENT = 'Asia/Tashkent';

/** Mon+Wed 18:00–19:30, a fixed October–November period. */
function fixedSlotRule(overrides: Partial<ScheduleRuleInput> = {}): ScheduleRuleInput {
  return {
    daysOfWeek: [1, 3],
    startTime: '18:00',
    endTime: '19:30',
    academicHoursPerDay: null,
    breakMinutes: 0,
    periodStart: '2026-10-05',
    periodEnd: '2026-10-31',
    totalAcademicHours: null,
    ...overrides,
  };
}

const WHOLE_PERIOD = { from: '2026-10-05', to: '2026-10-31' };
const NO_SKIPS = new Set<string>();

describe('clock time helpers', () => {
  it('round-trips HH:MM through minutes', () => {
    for (const time of ['00:00', '08:05', '18:00', '23:59']) {
      expect(formatClockTime(parseClockTime(time))).toBe(time);
    }
  });

  it('rejects anything that is not a 24-hour clock time', () => {
    for (const bad of ['24:00', '18:60', '8:00', '18:0', '', 'morning']) {
      expect(() => parseClockTime(bad)).toThrow(RangeError);
    }
  });
});

describe('zoned time conversion', () => {
  it('reads a wall-clock time as the branch timezone, not as UTC', () => {
    // Tashkent is UTC+5 year round: 18:00 local is 13:00Z.
    expect(zonedTimeToUtc('2026-10-05', '18:00', TASHKENT).toISOString()).toBe(
      '2026-10-05T13:00:00.000Z',
    );
  });

  it('round-trips back to the same local date and time', () => {
    const instant = zonedTimeToUtc('2026-10-05', '18:00', TASHKENT);
    expect(utcToZonedDate(instant, TASHKENT)).toBe('2026-10-05');
    expect(utcToZonedTime(instant, TASHKENT)).toBe('18:00');
  });

  it('keeps the local wall clock fixed across a DST transition', () => {
    // Europe/Berlin loses an hour on 2026-03-29. A lesson authored as
    // "10:00" must stay 10:00 locally on both sides of that boundary —
    // which it only does if the offset is resolved per occurrence.
    const before = zonedTimeToUtc('2026-03-28', '10:00', 'Europe/Berlin');
    const after = zonedTimeToUtc('2026-03-30', '10:00', 'Europe/Berlin');
    expect(before.toISOString()).toBe('2026-03-28T09:00:00.000Z');
    expect(after.toISOString()).toBe('2026-03-30T08:00:00.000Z');
    expect(utcToZonedTime(before, 'Europe/Berlin')).toBe('10:00');
    expect(utcToZonedTime(after, 'Europe/Berlin')).toBe('10:00');
  });

  it('treats midnight as the same calendar day in the branch zone', () => {
    const instant = zonedTimeToUtc('2026-10-05', '00:30', TASHKENT);
    // 00:30 Tashkent is 19:30Z the previous day — the local date is what a
    // lesson's `date` column must agree with, not the UTC one.
    expect(instant.toISOString()).toBe('2026-10-04T19:30:00.000Z');
    expect(utcToZonedDate(instant, TASHKENT)).toBe('2026-10-05');
  });
});

describe('date helpers', () => {
  it('maps dates to ISO weekdays with Sunday last', () => {
    expect(isoWeekday('2026-10-05')).toBe(1); // Monday
    expect(isoWeekday('2026-10-10')).toBe(6); // Saturday
    expect(isoWeekday('2026-10-11')).toBe(7); // Sunday
  });

  it('adds days across a month boundary', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('clamps a month shift to the end of the target month', () => {
    // 31 August + 6 months is February, which has no 31st. Rolling into
    // March would make the horizon jump a day in some months.
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2026-10-11', 6)).toBe('2027-04-11');
  });

  it('puts the rolling horizon six months out (TZ M4.3)', () => {
    expect(HORIZON_MONTHS).toBe(6);
    expect(horizonEnd('2026-10-11')).toBe('2027-04-11');
  });
});

describe('occurrence length', () => {
  it('takes the length from the clock times in fixed-slot mode', () => {
    expect(occurrenceMinutes(fixedSlotRule())).toBe(90);
    expect(occurrenceAcademicHours(fixedSlotRule())).toBe(2);
  });

  it('derives it from academic hours plus the in-lesson breaks', () => {
    const rule = fixedSlotRule({
      endTime: null,
      academicHoursPerDay: 2,
      breakMinutes: 10,
    });
    // Two 45-minute hours with one 10-minute break between them.
    expect(occurrenceMinutes(rule)).toBe(2 * ACADEMIC_HOUR_MINUTES + 10);
    expect(occurrenceAcademicHours(rule)).toBe(2);
  });

  it('charges no break for a single academic hour', () => {
    const rule = fixedSlotRule({ endTime: null, academicHoursPerDay: 1, breakMinutes: 15 });
    expect(occurrenceMinutes(rule)).toBe(ACADEMIC_HOUR_MINUTES);
  });
});

describe('generateLessons — weekdays and period', () => {
  it('emits one lesson per matching weekday inside the period', () => {
    const lessons = generateLessons(fixedSlotRule(), WHOLE_PERIOD, NO_SKIPS, TASHKENT);
    // Mondays 5, 12, 19, 26 October; Wednesdays 7, 14, 21, 28.
    expect(lessons.map((lesson) => lesson.date)).toEqual([
      '2026-10-05',
      '2026-10-07',
      '2026-10-12',
      '2026-10-14',
      '2026-10-19',
      '2026-10-21',
      '2026-10-26',
      '2026-10-28',
    ]);
  });

  it('sets start and end from the branch wall clock', () => {
    const [first] = generateLessons(fixedSlotRule(), WHOLE_PERIOD, NO_SKIPS, TASHKENT);
    expect(first?.startAt.toISOString()).toBe('2026-10-05T13:00:00.000Z');
    expect(first?.endAt.toISOString()).toBe('2026-10-05T14:30:00.000Z');
    expect(first?.academicHours).toBe(2);
  });

  it('never emits outside the rule period, even for a wider window', () => {
    const lessons = generateLessons(
      fixedSlotRule({ periodStart: '2026-10-12', periodEnd: '2026-10-14' }),
      { from: '2026-01-01', to: '2027-01-01' },
      NO_SKIPS,
      TASHKENT,
    );
    expect(lessons.map((lesson) => lesson.date)).toEqual(['2026-10-12', '2026-10-14']);
  });

  it('never emits outside the window, even for a wider period', () => {
    const lessons = generateLessons(
      fixedSlotRule({ periodEnd: '2027-12-31' }),
      { from: '2026-10-05', to: '2026-10-07' },
      NO_SKIPS,
      TASHKENT,
    );
    expect(lessons.map((lesson) => lesson.date)).toEqual(['2026-10-05', '2026-10-07']);
  });

  it('emits nothing for an empty weekday list', () => {
    expect(
      generateLessons(fixedSlotRule({ daysOfWeek: [] }), WHOLE_PERIOD, NO_SKIPS, TASHKENT),
    ).toEqual([]);
  });
});

describe('generateLessons — holidays are skipped (TZ M4.3)', () => {
  it('drops an occurrence that falls on a holiday', () => {
    // 12 October is a Monday the rule would otherwise meet on.
    const lessons = generateLessons(
      fixedSlotRule(),
      WHOLE_PERIOD,
      new Set(['2026-10-12']),
      TASHKENT,
    );
    const dates = lessons.map((lesson) => lesson.date);
    expect(dates).not.toContain('2026-10-12');
    expect(dates).toHaveLength(7);
  });

  it('ignores a holiday on a day the group never meets', () => {
    // 11 October is a Sunday; the rule is Mon+Wed.
    const lessons = generateLessons(
      fixedSlotRule(),
      WHOLE_PERIOD,
      new Set(['2026-10-11']),
      TASHKENT,
    );
    expect(lessons).toHaveLength(8);
  });
});

describe('generateLessons — total academic hours mode', () => {
  const totalHoursRule = fixedSlotRule({
    periodEnd: null,
    totalAcademicHours: 8,
  });

  it('stops once the hour budget is spent', () => {
    const lessons = generateLessons(
      totalHoursRule,
      { from: '2026-10-05', to: '2027-04-05' },
      NO_SKIPS,
      TASHKENT,
    );
    // 8 hours / 2 per lesson = 4 lessons.
    expect(lessons).toHaveLength(4);
    expect(lessons.map((lesson) => lesson.date)).toEqual([
      '2026-10-05',
      '2026-10-07',
      '2026-10-12',
      '2026-10-14',
    ]);
  });

  it('pushes the end of the period out rather than teaching fewer hours', () => {
    // 12 October is a holiday. The budget is unchanged, so the course still
    // gets four lessons — the last one simply lands a week later.
    const lessons = generateLessons(
      totalHoursRule,
      { from: '2026-10-05', to: '2027-04-05' },
      new Set(['2026-10-12']),
      TASHKENT,
    );
    expect(lessons).toHaveLength(4);
    expect(lessons[lessons.length - 1]?.date).toBe('2026-10-19');
  });

  it('counts hours already spent by kept lessons', () => {
    // Four of the eight hours are already on the books (two past lessons),
    // so only two more lessons may be generated.
    const lessons = generateLessons(
      totalHoursRule,
      { from: '2026-10-12', to: '2027-04-05' },
      NO_SKIPS,
      TASHKENT,
      4,
    );
    expect(lessons).toHaveLength(2);
  });

  it('emits nothing when the budget is already exhausted', () => {
    expect(
      generateLessons(totalHoursRule, { from: '2026-10-05', to: '2027-04-05' }, NO_SKIPS, TASHKENT, 8),
    ).toEqual([]);
  });

  it('does not emit a lesson that would overshoot a partial budget', () => {
    // 3 hours left but each lesson is 2 — one fits, the second would take
    // the course past its contracted hours.
    const lessons = generateLessons(
      totalHoursRule,
      { from: '2026-10-05', to: '2027-04-05' },
      NO_SKIPS,
      TASHKENT,
      5,
    );
    expect(lessons).toHaveLength(1);
  });

  it('respects periodEnd as well when both bounds are set', () => {
    const lessons = generateLessons(
      fixedSlotRule({ periodEnd: '2026-10-07', totalAcademicHours: 100 }),
      { from: '2026-10-05', to: '2027-04-05' },
      NO_SKIPS,
      TASHKENT,
    );
    expect(lessons.map((lesson) => lesson.date)).toEqual(['2026-10-05', '2026-10-07']);
  });
});

describe('timeShiftCandidates (UX P4 "· yoki 19:30")', () => {
  it('offers later slots before earlier ones', () => {
    const candidates = timeShiftCandidates('18:00', 90, 30, 2);
    expect(candidates.map((candidate) => candidate.startTime)).toEqual([
      '18:30',
      '17:30',
      '19:00',
      '17:00',
    ]);
  });

  it('keeps the slot length', () => {
    for (const candidate of timeShiftCandidates('18:00', 90)) {
      expect(parseClockTime(candidate.endTime) - parseClockTime(candidate.startTime)).toBe(90);
    }
  });

  it('never proposes a slot that would run past midnight or before 00:00', () => {
    const late = timeShiftCandidates('23:00', 60, 30, 4);
    expect(late.every((candidate) => candidate.endTime <= '24:00')).toBe(true);
    expect(late.map((candidate) => candidate.startTime)).not.toContain('23:30');

    const early = timeShiftCandidates('00:00', 60, 30, 4);
    expect(early.every((candidate) => candidate.startTime >= '00:00')).toBe(true);
  });
});
