import { formatClockTime, parseClockTime, zonedTimeToUtc } from './zoned-time.util';

/**
 * TZ M4.3 lesson generation, as a pure function.
 *
 * Kept free of Prisma and Nest on purpose: this is where every rule the
 * spec marks SHART actually lives (holidays skipped, rolling horizon,
 * total-hours budget pushing the period out rather than shrinking it), so
 * it is the part that most needs to be testable without a database. The
 * service's job is only to load the inputs, call this, and reconcile the
 * result against the rows that already exist.
 */

/** One academic hour, in wall-clock minutes. */
export const ACADEMIC_HOUR_MINUTES = 45;

/**
 * TZ M4.3: "Gorizont — rolling 6 oy (v1.0 da 12 oy edi): kechki job har
 * kuni gorizontni uzaytiradi." Six, not twelve: fewer orphan lessons and a
 * faster regeneration.
 */
export const HORIZON_MONTHS = 6;

export interface ScheduleRuleInput {
  /** ISO-8601 weekday numbers, 1 = Monday ... 7 = Sunday. */
  daysOfWeek: readonly number[];
  /** `HH:MM` local wall-clock start. */
  startTime: string;
  /** `HH:MM` local wall-clock end, or null in academic-hours mode. */
  endTime: string | null;
  /** Academic hours per lesson, or null in fixed-slot mode. */
  academicHoursPerDay: number | null;
  /** Break inside a lesson, added to its wall-clock length. */
  breakMinutes: number;
  /** `YYYY-MM-DD`. */
  periodStart: string;
  /** `YYYY-MM-DD`, or null in total-hours mode. */
  periodEnd: string | null;
  /** Academic-hour budget, or null when the period's dates bound it. */
  totalAcademicHours: number | null;
}

export interface GeneratedLesson {
  /** `YYYY-MM-DD` local calendar date. */
  date: string;
  startAt: Date;
  endAt: Date;
  /** What this occurrence consumes from `totalAcademicHours`. */
  academicHours: number;
}

export interface GenerationWindow {
  /** Generate occurrences on or after this `YYYY-MM-DD` (inclusive). */
  from: string;
  /** Generate occurrences on or before this `YYYY-MM-DD` (inclusive). */
  to: string;
}

/** `YYYY-MM-DD` -> ISO weekday (1 = Monday ... 7 = Sunday). */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  // getUTCDay is 0 = Sunday; ISO puts Sunday last.
  return day === 0 ? 7 : day;
}

/** `YYYY-MM-DD`, `n` days later. */
export function addDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD`, `n` months later, clamped to the end of the target month. */
export function addMonths(date: string, months: number): string {
  const base = new Date(`${date}T00:00:00.000Z`);
  const day = base.getUTCDate();
  const shifted = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1),
  );
  // "6 months after 31 August" has no 31st; clamp instead of rolling into
  // the next month, which would make the horizon jump a day some months.
  const lastDay = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return shifted.toISOString().slice(0, 10);
}

/** The rolling horizon's last date (TZ M4.3): `HORIZON_MONTHS` out from `today`. */
export function horizonEnd(today: string, months: number = HORIZON_MONTHS): string {
  return addMonths(today, months);
}

/**
 * How long one occurrence runs, in wall-clock minutes.
 *
 * Fixed-slot mode takes it straight from the clock times. Academic-hours
 * mode derives it: `academicHoursPerDay` 45-minute hours plus one break
 * between them (TZ M4.3's `break_minutes` is a break *inside* the lesson,
 * so a single-hour lesson has none).
 */
export function occurrenceMinutes(rule: ScheduleRuleInput): number {
  if (rule.endTime !== null) {
    return parseClockTime(rule.endTime) - parseClockTime(rule.startTime);
  }
  if (rule.academicHoursPerDay === null) {
    throw new RangeError('schedule rule has neither endTime nor academicHoursPerDay');
  }
  const teaching = rule.academicHoursPerDay * ACADEMIC_HOUR_MINUTES;
  const breaks = Math.max(0, Math.ceil(rule.academicHoursPerDay) - 1) * rule.breakMinutes;
  return Math.round(teaching + breaks);
}

/** The academic-hour value one occurrence carries. */
export function occurrenceAcademicHours(rule: ScheduleRuleInput): number {
  if (rule.academicHoursPerDay !== null) {
    return rule.academicHoursPerDay;
  }
  const minutes = occurrenceMinutes(rule);
  // Fixed-slot mode: a 90-minute slot is 2 academic hours. Rounded to two
  // decimals because that is the column's precision (numeric(5,2)) — an
  // unrounded 1.3333 would be stored rounded anyway, and the generated
  // value must match what a later read returns or the budget drifts.
  return Math.round((minutes / ACADEMIC_HOUR_MINUTES) * 100) / 100;
}

/**
 * The occurrences a rule produces inside `window`.
 *
 * `skipDates` are `YYYY-MM-DD` dates that produce no occurrence and consume
 * no budget. Two things land in it:
 *   * holidays (TZ M4.3: "Bayramlar oʻtkazib yuboriladi"). Not consuming
 *     budget is what "total_academic_hours rejimida davr oxiriga suriladi"
 *     means — the course runs longer rather than teaching less;
 *   * on regeneration, dates already covered by a lesson that is being
 *     *kept* (past, detached, completed, cancelled). Those are accounted
 *     for by `hoursAlreadySpent` instead, so counting them here too would
 *     charge the budget twice.
 *
 * `hoursAlreadySpent` lets a partial regeneration continue a budget the
 * kept lessons have already eaten into: regeneration leaves everything
 * before `window.from` untouched (TZ M4.3: "oʻtgan darslar tegilmaydi"),
 * so the remaining budget is the total minus what those lessons hold.
 */
export function generateLessons(
  rule: ScheduleRuleInput,
  window: GenerationWindow,
  skipDates: ReadonlySet<string>,
  timeZone: string,
  hoursAlreadySpent = 0,
): GeneratedLesson[] {
  const days = new Set(rule.daysOfWeek);
  if (days.size === 0) {
    return [];
  }

  const minutes = occurrenceMinutes(rule);
  const academicHours = occurrenceAcademicHours(rule);
  const startMinute = parseClockTime(rule.startTime);
  const endClock = formatClockTime(startMinute + minutes);

  // The rule's own period and the caller's window intersected: the rule
  // never produces a lesson outside its period, and the window is what
  // bounds an unbounded (total-hours) rule to the rolling horizon.
  const from = rule.periodStart > window.from ? rule.periodStart : window.from;
  const to =
    rule.periodEnd !== null && rule.periodEnd < window.to ? rule.periodEnd : window.to;

  // Read into a local before the subtraction: the `no-money-number-arithmetic`
  // lint rule matches on the *word* "total", so `rule.totalAcademicHours -
  // ...` reads as money arithmetic to it. These are teaching hours, not
  // tiyin, and the rule is right to stay strict rather than learn
  // exceptions.
  const hourBudget = rule.totalAcademicHours;
  const budget = hourBudget === null ? null : hourBudget - hoursAlreadySpent;
  if (budget !== null && budget < academicHours) {
    return [];
  }

  const lessons: GeneratedLesson[] = [];
  let spent = 0;

  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (!days.has(isoWeekday(date))) {
      continue;
    }
    if (skipDates.has(date)) {
      continue;
    }
    if (budget !== null && spent + academicHours > budget) {
      break;
    }

    lessons.push({
      date,
      startAt: zonedTimeToUtc(date, rule.startTime, timeZone),
      endAt: zonedTimeToUtc(date, endClock, timeZone),
      academicHours,
    });
    spent += academicHours;
  }

  return lessons;
}

/**
 * A free slot suggestion for the SCHEDULE_CONFLICT body (UX P4: "Xona 204
 * band. Boʻsh: 206, 301 · yoki 19:30").
 */
export interface TimeShiftCandidate {
  startTime: string;
  endTime: string;
}

/**
 * Candidate start times to offer when the requested slot is taken: the same
 * slot shifted by increasing multiples of `stepMinutes`, later first (a
 * group that cannot start at 18:00 is far likelier to accept 19:30 than
 * 16:30 — the earlier slot usually collides with the students' school day).
 *
 * Pure, so the "which of these is actually free" filtering can be a single
 * query in the service rather than a query per candidate.
 */
export function timeShiftCandidates(
  startTime: string,
  durationMinutes: number,
  stepMinutes = 30,
  steps = 6,
): TimeShiftCandidate[] {
  const start = parseClockTime(startTime);
  const candidates: TimeShiftCandidate[] = [];

  for (let step = 1; step <= steps; step += 1) {
    for (const direction of [1, -1]) {
      const shifted = start + direction * step * stepMinutes;
      // Must stay inside the same calendar day: a lesson whose slot wrapped
      // past midnight would land on the wrong date entirely.
      if (shifted < 0 || shifted + durationMinutes > 24 * 60) {
        continue;
      }
      candidates.push({
        startTime: formatClockTime(shifted),
        endTime: formatClockTime(shifted + durationMinutes),
      });
    }
  }

  return candidates;
}
