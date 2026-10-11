import { apiFetch } from '@/lib/api';

/**
 * Client and layout maths for the TZ M4.6 / UX P4 calendar.
 *
 * Everything below the API functions is pure: the week grid's geometry, the
 * side-by-side packing of parallel lessons, and the colour assignment are
 * all plain functions over plain data, so they are unit-tested in
 * `test/schedule.spec.ts` without a browser. The React component is then
 * only responsible for rendering what these return.
 */

export type LessonStatus = 'planned' | 'completed' | 'cancelled' | 'moved';

export interface Lesson {
  id: string;
  studyUnitId: string;
  studyUnitName: string;
  studyUnitColor: string | null;
  branchId: string;
  scheduleRuleId: string | null;
  /** `YYYY-MM-DD`, the branch-local calendar date. */
  date: string;
  /** ISO instant. */
  startAt: string;
  endAt: string;
  classroomId: string | null;
  classroomName: string | null;
  teacherId: string | null;
  teacherName: string | null;
  actualTeacherId: string | null;
  actualTeacherName: string | null;
  isSubstituted: boolean;
  status: LessonStatus;
  isDetached: boolean;
  academicHours: number | null;
  topic: string | null;
  cancelReason: string | null;
  movedToLessonId: string | null;
  makeupForLessonId: string | null;
  attendanceCount: number;
  version: number;
}

export interface ScheduleRule {
  id: string;
  studyUnitId: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string | null;
  academicHoursPerDay: number | null;
  breakMinutes: number;
  periodStart: string;
  periodEnd: string | null;
  totalAcademicHours: number | null;
  classroomId: string | null;
  classroomName: string | null;
  teacherId: string | null;
  teacherName: string | null;
  isActive: boolean;
  version: number;
  lessonCount: number;
}

export interface SchedulePreview {
  lessonCount: number;
  firstDate: string | null;
  lastDate: string | null;
  totalAcademicHours: number;
  skippedHolidays: string[];
  conflicts: {
    date: string;
    startAt: string;
    endAt: string;
    kind: 'classroom' | 'teacher';
    conflictingLessonId: string;
    conflictingStudyUnitName: string;
  }[];
  alternatives: ScheduleAlternatives;
  lessons: { date: string; startAt: string; endAt: string }[];
}

export interface ScheduleAlternatives {
  classrooms: { classroomId: string; classroomName: string; capacity: number | null }[];
  times: { startTime: string; endTime: string }[];
}

export interface Availability {
  free: boolean;
  conflicts: {
    kind: 'classroom' | 'teacher';
    lessonId: string;
    studyUnitName: string;
    startAt: string;
    endAt: string;
  }[];
  alternatives: ScheduleAlternatives;
  freeTeachers: { teacherId: string; teacherName: string; matchesDiscipline: boolean }[];
}

/** The `details[0]` payload of a TZ 6.2 SCHEDULE_CONFLICT body. */
export interface ScheduleConflictDetail {
  kind: 'classroom' | 'teacher';
  conflicting_lesson: {
    id: string;
    study_unit_name: string;
    start_at: string;
    end_at: string;
  } | null;
  free_classrooms: { id: string; name: string; capacity: number | null }[];
  free_times: { start_time: string; end_time: string }[];
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export interface LessonFilters {
  from: string;
  to: string;
  branchId?: string;
  classroomId?: string;
  teacherId?: string;
  studyUnitId?: string;
}

export function fetchLessons(filters: LessonFilters): Promise<Lesson[]> {
  const search = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.branchId !== undefined) {
    search.set('branch_id', filters.branchId);
  }
  if (filters.classroomId !== undefined) {
    search.set('classroom_id', filters.classroomId);
  }
  if (filters.teacherId !== undefined) {
    search.set('teacher_id', filters.teacherId);
  }
  if (filters.studyUnitId !== undefined) {
    search.set('study_unit_id', filters.studyUnitId);
  }
  return apiFetch<Lesson[]>(`/api/v1/lessons?${search.toString()}`);
}

export function fetchScheduleRules(studyUnitId: string): Promise<ScheduleRule[]> {
  return apiFetch<ScheduleRule[]>(
    `/api/v1/schedule-rules?study_unit_id=${studyUnitId}&is_active=all`,
  );
}

export interface ScheduleRuleInput {
  studyUnitId: string;
  daysOfWeek: number[];
  startTime: string;
  endTime?: string | null;
  academicHoursPerDay?: number | null;
  breakMinutes?: number;
  periodStart: string;
  periodEnd?: string | null;
  totalAcademicHours?: number | null;
  classroomId?: string | null;
  teacherId?: string | null;
}

export function previewScheduleRule(
  input: ScheduleRuleInput,
  replacingRuleId?: string,
): Promise<SchedulePreview> {
  const path =
    replacingRuleId === undefined
      ? '/api/v1/schedule-rules/preview'
      : `/api/v1/schedule-rules/${replacingRuleId}/preview`;
  return apiFetch<SchedulePreview>(path, { method: 'POST', body: JSON.stringify(input) });
}

export function createScheduleRule(input: ScheduleRuleInput): Promise<ScheduleRule> {
  return apiFetch<ScheduleRule>('/api/v1/schedule-rules', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateScheduleRule(
  id: string,
  version: number,
  body: Record<string, unknown>,
): Promise<ScheduleRule> {
  return apiFetch<ScheduleRule>(`/api/v1/schedule-rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'if-match': String(version) },
  });
}

export function deactivateScheduleRule(id: string, version: number): Promise<ScheduleRule> {
  return apiFetch<ScheduleRule>(`/api/v1/schedule-rules/${id}`, {
    method: 'DELETE',
    headers: { 'if-match': String(version) },
  });
}

export function moveLesson(
  id: string,
  version: number,
  input: { date: string; startTime: string; endTime?: string; classroomId?: string | null; reason?: string },
): Promise<Lesson> {
  return apiFetch<Lesson>(`/api/v1/lessons/${id}/move`, {
    method: 'POST',
    body: JSON.stringify(input),
    headers: { 'if-match': String(version) },
  });
}

export function cancelLesson(id: string, version: number, reason: string): Promise<Lesson> {
  return apiFetch<Lesson>(`/api/v1/lessons/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
    headers: { 'if-match': String(version) },
  });
}

export function substituteTeacher(
  id: string,
  version: number,
  actualTeacherId: string | null,
  reason?: string,
): Promise<Lesson> {
  return apiFetch<Lesson>(`/api/v1/lessons/${id}/substitute`, {
    method: 'POST',
    body: JSON.stringify({ actualTeacherId, reason }),
    headers: { 'if-match': String(version) },
  });
}

export function createExtraLesson(input: {
  studyUnitId: string;
  date: string;
  startTime: string;
  endTime: string;
  classroomId?: string | null;
  teacherId?: string | null;
  topic?: string | null;
}): Promise<Lesson> {
  return apiFetch<Lesson>('/api/v1/lessons', { method: 'POST', body: JSON.stringify(input) });
}

export interface AvailabilityQuery {
  date: string;
  startTime: string;
  endTime: string;
  branchId: string;
  classroomId?: string | null;
  teacherId?: string | null;
  excludeLessonId?: string;
  minCapacity?: number;
  disciplineId?: string | null;
}

export function fetchAvailability(query: AvailabilityQuery): Promise<Availability> {
  const search = new URLSearchParams({
    date: query.date,
    start_time: query.startTime,
    end_time: query.endTime,
    branch_id: query.branchId,
  });
  if (query.classroomId !== undefined && query.classroomId !== null) {
    search.set('classroom_id', query.classroomId);
  }
  if (query.teacherId !== undefined && query.teacherId !== null) {
    search.set('teacher_id', query.teacherId);
  }
  if (query.excludeLessonId !== undefined) {
    search.set('exclude_lesson_id', query.excludeLessonId);
  }
  if (query.minCapacity !== undefined) {
    search.set('min_capacity', String(query.minCapacity));
  }
  if (query.disciplineId !== undefined && query.disciplineId !== null) {
    search.set('discipline_id', query.disciplineId);
  }
  return apiFetch<Availability>(`/api/v1/schedule/availability?${search.toString()}`);
}

// ---------------------------------------------------------------------------
// Dates and local wall-clock time
// ---------------------------------------------------------------------------

/**
 * The calendar is drawn in the branch's timezone, not the viewer's: a lesson
 * at "18:00" must sit on the 18:00 row for an administrator checking the
 * schedule from another country. Every instant is therefore formatted
 * through an explicit `timeZone`, never through the browser's default.
 */
export const DEFAULT_TIME_ZONE = 'Asia/Tashkent';

export function localDate(instant: string, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
}

export function localTime(instant: string, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(instant));
}

/** Minutes since local midnight — the grid's vertical coordinate. */
export function localMinutes(instant: string, timeZone = DEFAULT_TIME_ZONE): number {
  const [hours, minutes] = localTime(instant, timeZone).split(':').map(Number);
  return (hours as number) * 60 + (minutes as number);
}

export function todayLocal(timeZone = DEFAULT_TIME_ZONE, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** ISO weekday, 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * The Monday of the week `date` falls in. Monday-first because that is how
 * the week is read in Uzbekistan, and because the spec's weekday numbering
 * (ISO, 1 = Monday) already assumes it.
 */
export function weekStart(date: string): string {
  return addDays(date, -(isoWeekday(date) - 1));
}

/** The seven `YYYY-MM-DD` dates of the week containing `date`. */
export function weekDates(date: string): string[] {
  const monday = weekStart(date);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function formatClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function parseClock(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours as number) * 60 + (minutes as number);
}

/** `12.10` — the short day label in the column header. */
export function formatDayNumber(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

// ---------------------------------------------------------------------------
// Week grid geometry
// ---------------------------------------------------------------------------

export interface GridBounds {
  /** Minutes since midnight of the first visible row. */
  startMinute: number;
  /** Minutes since midnight of the end of the last visible row. */
  endMinute: number;
  /** Row height in minutes. */
  stepMinutes: number;
}

export const DEFAULT_GRID: GridBounds = { startMinute: 8 * 60, endMinute: 22 * 60, stepMinutes: 60 };

/**
 * The visible time window, widened so no lesson is clipped.
 *
 * A fixed 08:00–22:00 frame is the right default (it is the working day a
 * language centre actually uses), but a 07:00 lesson must not be invisible
 * — a schedule that silently hides a booking is worse than a tall grid. So
 * the bounds stretch to cover whatever is there, snapped outward to the
 * hour.
 */
export function gridBoundsFor(
  lessons: readonly Lesson[],
  timeZone = DEFAULT_TIME_ZONE,
  base: GridBounds = DEFAULT_GRID,
): GridBounds {
  let startMinute = base.startMinute;
  let endMinute = base.endMinute;

  for (const lesson of lessons) {
    const from = localMinutes(lesson.startAt, timeZone);
    const to = localMinutes(lesson.endAt, timeZone);
    startMinute = Math.min(startMinute, Math.floor(from / 60) * 60);
    // A lesson ending exactly on the hour needs no extra row.
    endMinute = Math.max(endMinute, Math.ceil(to / 60) * 60);
  }

  return { ...base, startMinute, endMinute: Math.max(endMinute, startMinute + base.stepMinutes) };
}

/** The row labels, one per `stepMinutes`. */
export function gridRows(bounds: GridBounds): number[] {
  const rows: number[] = [];
  for (let minute = bounds.startMinute; minute < bounds.endMinute; minute += bounds.stepMinutes) {
    rows.push(minute);
  }
  return rows;
}

export interface PlacedLesson {
  lesson: Lesson;
  /** Percentage from the top of the grid body. */
  top: number;
  /** Percentage of the grid body's height. */
  height: number;
  /** 0-based column among the parallel lessons sharing this overlap group. */
  column: number;
  /** How many columns that overlap group needs. */
  columns: number;
}

/**
 * Places one day's lessons, splitting overlapping ones into side-by-side
 * columns (UX P4: parallel lessons shown next to each other).
 *
 * The packing is the classic sweep: lessons sorted by start, grouped into
 * maximal runs that transitively overlap, and within a run assigned the
 * first column whose previous occupant has already ended. Every lesson in a
 * run gets the same `columns` total so the group's widths line up — giving
 * each lesson its own local column count instead would make two
 * side-by-side lessons render at different widths.
 */
export function placeDayLessons(
  lessons: readonly Lesson[],
  bounds: GridBounds,
  timeZone = DEFAULT_TIME_ZONE,
): PlacedLesson[] {
  const span = bounds.endMinute - bounds.startMinute;
  if (span <= 0) {
    return [];
  }

  const sorted = [...lessons]
    .map((lesson) => ({
      lesson,
      from: localMinutes(lesson.startAt, timeZone),
      to: localMinutes(lesson.endAt, timeZone),
    }))
    // A lesson crossing local midnight would read as `to < from`; clamp it
    // to the end of the grid rather than drawing a negative-height box.
    .map((entry) => ({ ...entry, to: entry.to <= entry.from ? bounds.endMinute : entry.to }))
    .sort((left, right) => left.from - right.from || left.to - right.to);

  const placed: PlacedLesson[] = [];
  let run: typeof sorted = [];
  let runEnd = -1;

  function flush(): void {
    if (run.length === 0) {
      return;
    }
    /** The end time currently occupying each column. */
    const columnEnds: number[] = [];
    const assigned = run.map((entry) => {
      let column = columnEnds.findIndex((end) => end <= entry.from);
      if (column === -1) {
        column = columnEnds.length;
      }
      columnEnds[column] = entry.to;
      return { entry, column };
    });
    const columns = columnEnds.length;

    for (const { entry, column } of assigned) {
      placed.push({
        lesson: entry.lesson,
        top: ((entry.from - bounds.startMinute) / span) * 100,
        height: (Math.max(entry.to - entry.from, bounds.stepMinutes / 4) / span) * 100,
        column,
        columns,
      });
    }
    run = [];
    runEnd = -1;
  }

  for (const entry of sorted) {
    if (run.length > 0 && entry.from >= runEnd) {
      flush();
    }
    run.push(entry);
    runEnd = Math.max(runEnd, entry.to);
  }
  flush();

  return placed;
}

/** One column of the week grid. */
export interface DayColumn {
  date: string;
  isToday: boolean;
  isWeekend: boolean;
  placed: PlacedLesson[];
}

export interface WeekGrid {
  bounds: GridBounds;
  days: DayColumn[];
}

/**
 * The whole week view: seven day columns, each with its lessons placed.
 *
 * `today` is passed in rather than read from the clock so this stays pure
 * and the "today's column is highlighted" rule is testable.
 */
export function buildWeekGrid(
  anchorDate: string,
  lessons: readonly Lesson[],
  today: string,
  timeZone = DEFAULT_TIME_ZONE,
  base: GridBounds = DEFAULT_GRID,
): WeekGrid {
  const dates = weekDates(anchorDate);
  const bounds = gridBoundsFor(lessons, timeZone, base);

  const byDate = new Map<string, Lesson[]>();
  for (const lesson of lessons) {
    // Group by the lesson's own `date`, which the API already resolved in
    // the branch timezone — re-deriving it from `startAt` here would
    // disagree with the backend for a late-evening lesson.
    const bucket = byDate.get(lesson.date);
    if (bucket === undefined) {
      byDate.set(lesson.date, [lesson]);
    } else {
      bucket.push(lesson);
    }
  }

  return {
    bounds,
    days: dates.map((date) => ({
      date,
      isToday: date === today,
      isWeekend: isoWeekday(date) >= 6,
      placed: placeDayLessons(byDate.get(date) ?? [], bounds, timeZone),
    })),
  };
}

// ---------------------------------------------------------------------------
// Colour by classroom (UX P4: "rang — xona yoki fan boʻyicha")
// ---------------------------------------------------------------------------

/**
 * Tailwind classes per palette slot. Kept as whole class strings rather than
 * interpolated colour names because Tailwind's JIT only emits classes it can
 * see literally in the source.
 */
const CLASSROOM_PALETTE = [
  { bar: 'bg-sky-500', block: 'bg-sky-50 border-sky-400 text-sky-950', dark: 'dark:bg-sky-950/60 dark:text-sky-100' },
  { bar: 'bg-emerald-500', block: 'bg-emerald-50 border-emerald-400 text-emerald-950', dark: 'dark:bg-emerald-950/60 dark:text-emerald-100' },
  { bar: 'bg-violet-500', block: 'bg-violet-50 border-violet-400 text-violet-950', dark: 'dark:bg-violet-950/60 dark:text-violet-100' },
  { bar: 'bg-amber-500', block: 'bg-amber-50 border-amber-400 text-amber-950', dark: 'dark:bg-amber-950/60 dark:text-amber-100' },
  { bar: 'bg-rose-500', block: 'bg-rose-50 border-rose-400 text-rose-950', dark: 'dark:bg-rose-950/60 dark:text-rose-100' },
  { bar: 'bg-teal-500', block: 'bg-teal-50 border-teal-400 text-teal-950', dark: 'dark:bg-teal-950/60 dark:text-teal-100' },
  { bar: 'bg-indigo-500', block: 'bg-indigo-50 border-indigo-400 text-indigo-950', dark: 'dark:bg-indigo-950/60 dark:text-indigo-100' },
  { bar: 'bg-orange-500', block: 'bg-orange-50 border-orange-400 text-orange-950', dark: 'dark:bg-orange-950/60 dark:text-orange-100' },
] as const;

/** A lesson with no classroom — visually distinct, not an arbitrary colour. */
const NO_CLASSROOM = {
  bar: 'bg-slate-400',
  block: 'bg-slate-50 border-slate-300 border-dashed text-slate-900',
  dark: 'dark:bg-slate-900/60 dark:text-slate-100',
} as const;

export type LessonPalette = { bar: string; block: string; dark: string };

/**
 * Derives the colour from the classroom id, so a room keeps the same colour
 * across weeks, filters and sessions with nothing stored. Colour is never
 * the only carrier of meaning — the room name is always printed on the
 * block too (UX §8 accessibility).
 */
export function classroomPalette(classroomId: string | null): LessonPalette {
  if (classroomId === null) {
    return NO_CLASSROOM;
  }
  let hash = 0;
  for (const character of classroomId) {
    hash = (hash * 31 + character.charCodeAt(0)) % 100_000;
  }
  return CLASSROOM_PALETTE[hash % CLASSROOM_PALETTE.length] as LessonPalette;
}

/**
 * Status styling on top of the colour. UX P4: "status naqsh bilan (bekor
 * qilingan — chiziqli)" — a cancelled lesson is struck through and faded
 * rather than recoloured, so it stays recognisably the same lesson.
 */
export function statusClass(status: LessonStatus): string {
  switch (status) {
    case 'cancelled':
      return 'line-through opacity-50';
    case 'completed':
      return 'opacity-80';
    case 'moved':
      return 'opacity-40';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Drag-to-move
// ---------------------------------------------------------------------------

/**
 * Where a drop lands: the day column under the pointer, and the time the
 * vertical offset corresponds to, snapped to `snapMinutes`.
 *
 * `offsetRatio` is the pointer's position within the grid body as a
 * fraction (0 at the top, 1 at the bottom), which is what a `mousemove`
 * handler can compute from a bounding rect without this module touching the
 * DOM.
 */
export function dropTarget(
  date: string,
  offsetRatio: number,
  bounds: GridBounds,
  durationMinutes: number,
  snapMinutes = 15,
): { date: string; startTime: string; endTime: string } {
  const span = bounds.endMinute - bounds.startMinute;
  const raw = bounds.startMinute + Math.max(0, Math.min(1, offsetRatio)) * span;
  const snapped = Math.round(raw / snapMinutes) * snapMinutes;

  // Keep the whole lesson inside the day and inside the grid's own window.
  // The end must land *before* midnight, not on it: `24:00` is not a time
  // the API's `HH:MM` format can express, so a drop near the bottom edge
  // would otherwise produce a slot that every request rejects. Flooring to
  // the snap grid keeps the result on a round time rather than 21:59.
  const lastStart = Math.min(bounds.endMinute, 24 * 60 - 1) - durationMinutes;
  const latest = Math.floor(Math.max(lastStart, 0) / snapMinutes) * snapMinutes;
  const start = Math.max(bounds.startMinute, Math.min(snapped, latest));

  return {
    date,
    startTime: formatClock(start),
    endTime: formatClock(start + durationMinutes),
  };
}

export function lessonDurationMinutes(lesson: Lesson): number {
  return Math.round((new Date(lesson.endAt).getTime() - new Date(lesson.startAt).getTime()) / 60_000);
}

/**
 * The one-line conflict summary UX P4 asks for: "Xona 204 band. Boʻsh: 206,
 * 301 · yoki 19:30".
 *
 * Built here rather than in JSX so the exact sentence is testable, and so
 * the tooltip and the toast cannot drift apart. `labels` carries the
 * translated fragments, keeping this module free of the i18n import (and
 * therefore of any assumption about the active language).
 */
export function conflictSummary(
  availability: Availability,
  labels: { busy: string; free: string; or: string; roomBusy: string; teacherBusy: string },
): string {
  const conflict = availability.conflicts[0];
  if (conflict === undefined) {
    return '';
  }

  const head = `${conflict.kind === 'classroom' ? labels.roomBusy : labels.teacherBusy} (${conflict.studyUnitName}) ${labels.busy}`;
  const parts: string[] = [];

  const rooms = availability.alternatives.classrooms.map((room) => room.classroomName);
  if (rooms.length > 0) {
    parts.push(`${labels.free}: ${rooms.join(', ')}`);
  }
  const times = availability.alternatives.times.map((time) => time.startTime);
  if (times.length > 0) {
    parts.push(`${labels.or} ${times.join(', ')}`);
  }

  return parts.length === 0 ? head : `${head}. ${parts.join(' · ')}`;
}

/** The same sentence from a SCHEDULE_CONFLICT error body. */
export function conflictSummaryFromError(
  detail: ScheduleConflictDetail,
  labels: { busy: string; free: string; or: string; roomBusy: string; teacherBusy: string },
): string {
  return conflictSummary(
    {
      free: false,
      conflicts: [
        {
          kind: detail.kind,
          lessonId: detail.conflicting_lesson?.id ?? '',
          studyUnitName: detail.conflicting_lesson?.study_unit_name ?? '',
          startAt: detail.conflicting_lesson?.start_at ?? '',
          endAt: detail.conflicting_lesson?.end_at ?? '',
        },
      ],
      alternatives: {
        classrooms: detail.free_classrooms.map((room) => ({
          classroomId: room.id,
          classroomName: room.name,
          capacity: room.capacity,
        })),
        times: detail.free_times.map((time) => ({
          startTime: time.start_time,
          endTime: time.end_time,
        })),
      },
      freeTeachers: [],
    },
    labels,
  );
}
