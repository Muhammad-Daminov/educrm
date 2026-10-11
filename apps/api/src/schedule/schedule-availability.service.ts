import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '../common/crud/archivable-crud.service';
import {
  occurrenceMinutes,
  timeShiftCandidates,
  type TimeShiftCandidate,
} from './lesson-generation';
import { parseClockTime, zonedTimeToUtc } from './zoned-time.util';
import type {
  ClassroomAlternative,
  ConflictingLessonRef,
  ConflictKind,
  ScheduleAlternatives,
} from './schedule.errors';

/**
 * The read side of TZ M4.4 conflict control, plus UX 4.4's free-resource
 * finder.
 *
 * The exclusion constraints in the migration are what *guarantee* no two
 * lessons share a classroom or a teacher. Everything here is the UX half of
 * the same requirement, which TZ M4.4 calls out explicitly: "Application
 * tekshiruvi baribir kerak — UX uchun: constraint xatosi SCHEDULE_CONFLICT
 * kodiga aylantirilib, boʻsh muqobil xona va vaqtlar taklifi bilan
 * qaytariladi." So this service answers "is that slot free, and if not,
 * what is?" — it never stands in for the constraint.
 */

/** Lesson statuses that reserve a slot. The two the constraints exclude
 * (`cancelled`, `moved`) are exactly the two that do not — TZ M4.4's
 * documented v1.0 fix. */
const BLOCKING_STATUSES: Prisma.EnumLessonStatusFilter = {
  notIn: ['cancelled', 'moved'],
};

export interface Slot {
  startAt: Date;
  endAt: Date;
}

export interface SlotConflict {
  kind: ConflictKind;
  lesson: ConflictingLessonRef;
}

/** One candidate occurrence, with whatever is blocking it. */
export interface CheckedSlot extends Slot {
  date: string;
  conflicts: SlotConflict[];
}

interface BlockingLessonRow {
  id: string;
  studyUnitId: string;
  startAt: Date;
  endAt: Date;
  classroomId: string | null;
  actualTeacherId: string | null;
  studyUnit: { name: string };
}

export interface ConflictQuery {
  classroomId: string | null;
  actualTeacherId: string | null;
  /** Lessons that must not count against the candidates — the lesson being
   * moved, or the rule being replaced by this very edit. */
  excludeLessonIds?: readonly string[];
  excludeScheduleRuleId?: string | null;
}

@Injectable()
export class ScheduleAvailabilityService {
  /**
   * Annotates each candidate slot with the lessons that block it.
   *
   * One query for the whole batch rather than one per candidate: generating
   * six months of a twice-weekly rule is ~52 occurrences, and the preview
   * endpoint is on the critical path of the group wizard's live feedback.
   * The overlap test is then done in JS, which is exact — `[start, end)`
   * half-open, matching `tstzrange`'s default bounds and therefore matching
   * the constraint that has the final say.
   */
  async checkSlots(
    tx: Tx,
    candidates: readonly { date: string; startAt: Date; endAt: Date }[],
    query: ConflictQuery,
  ): Promise<CheckedSlot[]> {
    if (candidates.length === 0) {
      return [];
    }
    if (query.classroomId === null && query.actualTeacherId === null) {
      // Nothing to collide with: a lesson with neither a classroom nor a
      // teacher is outside both constraints' WHERE clauses.
      return candidates.map((candidate) => ({ ...candidate, conflicts: [] }));
    }

    const rangeStart = candidates.reduce(
      (min, slot) => (slot.startAt < min ? slot.startAt : min),
      candidates[0]!.startAt,
    );
    const rangeEnd = candidates.reduce(
      (max, slot) => (slot.endAt > max ? slot.endAt : max),
      candidates[0]!.endAt,
    );

    const resourceFilter: Prisma.LessonWhereInput[] = [];
    if (query.classroomId !== null) {
      resourceFilter.push({ classroomId: query.classroomId });
    }
    if (query.actualTeacherId !== null) {
      resourceFilter.push({ actualTeacherId: query.actualTeacherId });
    }

    const excludeIds = query.excludeLessonIds ?? [];
    const rows: BlockingLessonRow[] = await tx.lesson.findMany({
      where: {
        status: BLOCKING_STATUSES,
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
        OR: resourceFilter,
        ...(excludeIds.length === 0 ? {} : { id: { notIn: [...excludeIds] } }),
        ...(query.excludeScheduleRuleId === undefined || query.excludeScheduleRuleId === null
          ? {}
          : { scheduleRuleId: { not: query.excludeScheduleRuleId } }),
      },
      select: {
        id: true,
        studyUnitId: true,
        startAt: true,
        endAt: true,
        classroomId: true,
        actualTeacherId: true,
        studyUnit: { select: { name: true } },
      },
      orderBy: { startAt: 'asc' },
    });

    return candidates.map((candidate) => {
      const conflicts: SlotConflict[] = [];
      for (const row of rows) {
        // Half-open overlap, the same test `tstzrange(start, end) &&` makes.
        if (row.startAt >= candidate.endAt || row.endAt <= candidate.startAt) {
          continue;
        }
        if (query.classroomId !== null && row.classroomId === query.classroomId) {
          conflicts.push({ kind: 'classroom', lesson: toRef(row) });
        }
        if (query.actualTeacherId !== null && row.actualTeacherId === query.actualTeacherId) {
          conflicts.push({ kind: 'teacher', lesson: toRef(row) });
        }
      }
      return { ...candidate, conflicts };
    });
  }

  /**
   * UX 4.4: "boʻsh xonalar (sigʻim bilan)" — the active classrooms in a
   * branch with nothing booked over the slot.
   *
   * `minCapacity` is the group's enrolled count where the caller knows it,
   * so a 15-student group is not offered a 6-seat room. A classroom with no
   * recorded capacity is still offered: TZ M1.2 makes capacity optional,
   * and silently hiding every room that has not been measured would be
   * worse than offering one that might be tight.
   */
  async freeClassrooms(
    tx: Tx,
    options: {
      branchId: string;
      slot: Slot;
      excludeClassroomId?: string | null;
      excludeLessonIds?: readonly string[];
      minCapacity?: number;
      limit?: number;
    },
  ): Promise<ClassroomAlternative[]> {
    const classrooms = await tx.classroom.findMany({
      where: {
        branchId: options.branchId,
        isActive: true,
        ...(options.excludeClassroomId === undefined || options.excludeClassroomId === null
          ? {}
          : { id: { not: options.excludeClassroomId } }),
        ...(options.minCapacity === undefined || options.minCapacity === 0
          ? {}
          : { OR: [{ capacity: null }, { capacity: { gte: options.minCapacity } }] }),
      },
      select: { id: true, name: true, capacity: true, nameKey: true },
      orderBy: [{ nameKey: 'asc' }],
    });
    if (classrooms.length === 0) {
      return [];
    }

    const excludeIds = options.excludeLessonIds ?? [];
    const busy = await tx.lesson.findMany({
      where: {
        status: BLOCKING_STATUSES,
        classroomId: { in: classrooms.map((room) => room.id) },
        startAt: { lt: options.slot.endAt },
        endAt: { gt: options.slot.startAt },
        ...(excludeIds.length === 0 ? {} : { id: { notIn: [...excludeIds] } }),
      },
      select: { classroomId: true },
    });
    const busyIds = new Set(busy.map((row) => row.classroomId));

    return classrooms
      .filter((room) => !busyIds.has(room.id))
      .slice(0, options.limit ?? 5)
      .map((room) => ({
        classroomId: room.id,
        classroomName: room.name,
        capacity: room.capacity,
      }));
  }

  /**
   * UX 4.4's other half: "mos boʻsh oʻqituvchilar (availability + fan)".
   *
   * R0 has no teacher availability calendar (TZ M1.4 lists it as R1), so
   * "free" here means exactly "has no overlapping lesson" — the part that
   * is answerable from data that exists.
   *
   * The candidate set is "active users holding the `teacher` role in this
   * branch", *not* "users with a `teacher_profiles` row". A profile is
   * where TZ M1.4's teaching qualifications live, but it is optional in
   * practice: an employee created with the teacher role has no profile
   * until someone fills one in, and keying the list off profiles would
   * make the whole suggestion list silently empty for a new centre — the
   * exact moment it is most needed.
   *
   * `disciplineId` therefore *ranks* rather than filters: a teacher whose
   * profile names the discipline comes first ("fan" matching, as the UX
   * asks), and one with no profile is still offered rather than hidden.
   */
  async freeTeachers(
    tx: Tx,
    options: {
      branchId: string;
      slot: Slot;
      disciplineId?: string | null;
      excludeTeacherId?: string | null;
      excludeLessonIds?: readonly string[];
      limit?: number;
    },
  ): Promise<{ teacherId: string; teacherName: string; matchesDiscipline: boolean }[]> {
    const candidates = await tx.user.findMany({
      where: {
        isActive: true,
        userBranches: { some: { branchId: options.branchId } },
        userRoles: { some: { role: { code: 'teacher' } } },
        ...(options.excludeTeacherId === undefined || options.excludeTeacherId === null
          ? {}
          : { id: { not: options.excludeTeacherId } }),
      },
      select: {
        id: true,
        fullName: true,
        fullNameKey: true,
        teacherProfile: {
          select: {
            disciplines: { select: { disciplineId: true } },
          },
        },
      },
    });
    if (candidates.length === 0) {
      return [];
    }

    const excludeIds = options.excludeLessonIds ?? [];
    const busy = await tx.lesson.findMany({
      where: {
        status: BLOCKING_STATUSES,
        actualTeacherId: { in: candidates.map((candidate) => candidate.id) },
        startAt: { lt: options.slot.endAt },
        endAt: { gt: options.slot.startAt },
        ...(excludeIds.length === 0 ? {} : { id: { notIn: [...excludeIds] } }),
      },
      select: { actualTeacherId: true },
    });
    const busyIds = new Set(busy.map((row) => row.actualTeacherId));

    const wanted = options.disciplineId ?? null;
    return candidates
      .filter((candidate) => !busyIds.has(candidate.id))
      .map((candidate) => ({
        teacherId: candidate.id,
        teacherName: candidate.fullName,
        sortKey: candidate.fullNameKey ?? '',
        matchesDiscipline:
          wanted !== null &&
          (candidate.teacherProfile?.disciplines ?? []).some(
            (row) => row.disciplineId === wanted,
          ),
      }))
      .sort((left, right) =>
        left.matchesDiscipline === right.matchesDiscipline
          ? left.sortKey.localeCompare(right.sortKey)
          : Number(right.matchesDiscipline) - Number(left.matchesDiscipline),
      )
      .slice(0, options.limit ?? 5)
      .map(({ teacherId, teacherName, matchesDiscipline }) => ({
        teacherId,
        teacherName,
        matchesDiscipline,
      }));
  }

  /**
   * The payload UX P4's conflict message needs: "Xona 204 band. Boʻsh: 206,
   * 301 · yoki 19:30". Both halves — other rooms at the same time, and the
   * same room at another time.
   */
  async alternativesFor(
    tx: Tx,
    options: {
      branchId: string;
      date: string;
      startTime: string;
      endTime: string;
      timeZone: string;
      classroomId: string | null;
      actualTeacherId: string | null;
      excludeLessonIds?: readonly string[];
      minCapacity?: number;
    },
  ): Promise<ScheduleAlternatives> {
    const slot: Slot = {
      startAt: zonedTimeToUtc(options.date, options.startTime, options.timeZone),
      endAt: zonedTimeToUtc(options.date, options.endTime, options.timeZone),
    };
    const durationMinutes = parseClockTime(options.endTime) - parseClockTime(options.startTime);

    const classrooms =
      options.classroomId === null
        ? []
        : await this.freeClassrooms(tx, {
            branchId: options.branchId,
            slot,
            excludeClassroomId: options.classroomId,
            excludeLessonIds: options.excludeLessonIds,
            minCapacity: options.minCapacity,
          });

    const times = await this.freeTimeShifts(tx, {
      date: options.date,
      startTime: options.startTime,
      durationMinutes,
      timeZone: options.timeZone,
      classroomId: options.classroomId,
      actualTeacherId: options.actualTeacherId,
      excludeLessonIds: options.excludeLessonIds,
    });

    return { classrooms, times };
  }

  /** The "· yoki 19:30" half: the same resources, shifted in time. */
  async freeTimeShifts(
    tx: Tx,
    options: {
      date: string;
      startTime: string;
      durationMinutes: number;
      timeZone: string;
      classroomId: string | null;
      actualTeacherId: string | null;
      excludeLessonIds?: readonly string[];
      limit?: number;
    },
  ): Promise<TimeShiftCandidate[]> {
    const candidates = timeShiftCandidates(options.startTime, options.durationMinutes);
    if (candidates.length === 0) {
      return [];
    }

    const checked = await this.checkSlots(
      tx,
      candidates.map((candidate) => ({
        date: options.date,
        startAt: zonedTimeToUtc(options.date, candidate.startTime, options.timeZone),
        endAt: zonedTimeToUtc(options.date, candidate.endTime, options.timeZone),
      })),
      {
        classroomId: options.classroomId,
        actualTeacherId: options.actualTeacherId,
        excludeLessonIds: options.excludeLessonIds,
      },
    );

    const free: TimeShiftCandidate[] = [];
    for (const [index, slot] of checked.entries()) {
      if (slot.conflicts.length === 0) {
        free.push(candidates[index]!);
      }
      if (free.length >= (options.limit ?? 3)) {
        break;
      }
    }
    return free;
  }

  /** Holiday dates (TZ M4.3: skipped) for a branch over a date range. */
  async holidayDates(
    tx: Tx,
    branchId: string,
    from: string,
    to: string,
  ): Promise<Set<string>> {
    const rows = await tx.holiday.findMany({
      where: {
        isActive: true,
        // A holiday with no branch is tenant-wide (TZ M1.3: `branch_id` is
        // nullable precisely so a national holiday is entered once).
        OR: [{ branchId }, { branchId: null }],
        date: {
          gte: new Date(`${from}T00:00:00.000Z`),
          lte: new Date(`${to}T00:00:00.000Z`),
        },
      },
      select: { date: true },
    });
    return new Set(rows.map((row) => row.date.toISOString().slice(0, 10)));
  }

  /** The wall-clock length of a rule's occurrence, for alternative lookups. */
  static ruleDurationMinutes = occurrenceMinutes;
}

function toRef(row: BlockingLessonRow): ConflictingLessonRef {
  return {
    lessonId: row.id,
    studyUnitId: row.studyUnitId,
    studyUnitName: row.studyUnit.name,
    startAt: row.startAt,
    endAt: row.endAt,
  };
}
