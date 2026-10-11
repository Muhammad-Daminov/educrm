import { ConflictException } from '@nestjs/common';

/**
 * TZ M4.4: the exclusion constraint is the guarantee, but a raw Postgres
 * `23P01` reaching the client is a 500 that says nothing. UX P4 is explicit
 * about what should happen instead: "Konflikt boʻlsa: xato emas, yechim
 * taklifi — 'Xona 204 band. Boʻsh: 206, 301 · yoki 19:30'". So the
 * violation is translated into a `SCHEDULE_CONFLICT` body that carries the
 * alternatives the screen needs to render that sentence.
 */

/** Which constraint fired — the two are different sentences in the UI. */
export type ConflictKind = 'classroom' | 'teacher';

export interface ClassroomAlternative {
  classroomId: string;
  classroomName: string;
  capacity: number | null;
}

export interface TimeAlternative {
  /** `HH:MM` local wall-clock, in the branch timezone. */
  startTime: string;
  endTime: string;
}

export interface ScheduleAlternatives {
  classrooms: ClassroomAlternative[];
  times: TimeAlternative[];
}

export const EMPTY_ALTERNATIVES: ScheduleAlternatives = { classrooms: [], times: [] };

export interface ConflictingLessonRef {
  lessonId: string;
  studyUnitId: string;
  studyUnitName: string;
  startAt: Date;
  endAt: Date;
}

/**
 * TZ 6.2 `{ code, message, details }`. The frontend keys off `code` and
 * reads `details[0]` for everything it renders, so the alternatives and the
 * blocking lesson both go in there rather than into the message text.
 */
export function scheduleConflict(
  kind: ConflictKind,
  alternatives: ScheduleAlternatives,
  conflicting: ConflictingLessonRef | null = null,
): ConflictException {
  return new ConflictException({
    code: 'SCHEDULE_CONFLICT',
    message:
      kind === 'classroom'
        ? 'The classroom is already booked for an overlapping lesson'
        : 'The teacher already has an overlapping lesson',
    details: [
      {
        field: kind === 'classroom' ? 'classroomId' : 'actualTeacherId',
        code: 'SCHEDULE_CONFLICT',
        kind,
        conflicting_lesson:
          conflicting === null
            ? null
            : {
                id: conflicting.lessonId,
                study_unit_id: conflicting.studyUnitId,
                study_unit_name: conflicting.studyUnitName,
                start_at: conflicting.startAt.toISOString(),
                end_at: conflicting.endAt.toISOString(),
              },
        // UX P4's "Boʻsh: 206, 301" and "yoki 19:30".
        free_classrooms: alternatives.classrooms.map((option) => ({
          id: option.classroomId,
          name: option.classroomName,
          capacity: option.capacity,
        })),
        free_times: alternatives.times.map((option) => ({
          start_time: option.startTime,
          end_time: option.endTime,
        })),
      },
    ],
  });
}

/**
 * BR-U2 (TZ M4.1 SHART): "forming → active uchun jadval qoidasi SHART".
 * Relaxed in T07 because `schedule_rules` did not exist; re-enabled now
 * that it does (docs/QUESTIONS.md).
 */
export function scheduleRuleRequired(studyUnitId: string): ConflictException {
  return new ConflictException({
    code: 'SCHEDULE_RULE_REQUIRED',
    message: 'BR-U2: a study unit needs an active schedule rule before it can go active',
    details: [{ field: 'status', code: 'SCHEDULE_RULE_REQUIRED', study_unit_id: studyUnitId }],
  });
}

/**
 * Postgres reports an exclusion-constraint violation as SQLSTATE 23P01 with
 * the constraint name in the message. Prisma surfaces it as a raw
 * `PrismaClientUnknownRequestError`/`P2010`-ish error rather than a typed
 * one, so the constraint name in the message text is what we have to match
 * on — the names are ours, pinned by the migration.
 */
const CLASSROOM_CONSTRAINT = 'lessons_classroom_no_overlap';
const TEACHER_CONSTRAINT = 'lessons_teacher_no_overlap';

/**
 * Which of the two conflict constraints an error came from, or `null` if it
 * is some other failure that must keep propagating untouched.
 */
export function conflictKindOf(error: unknown): ConflictKind | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(CLASSROOM_CONSTRAINT)) {
    return 'classroom';
  }
  if (message.includes(TEACHER_CONSTRAINT)) {
    return 'teacher';
  }
  return null;
}

/**
 * The `lessons_refuse_protected_delete` trigger (TZ M4.3 SHART). Should be
 * unreachable — regeneration filters protected lessons out of its DELETE —
 * but if it ever does fire, it must not read as a 500.
 */
export function protectedLessonDelete(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('cannot be deleted (TZ M4.3)');
}
