import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { TENANT_PRISMA, type TenantPrismaClient } from '../database/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { diffOf, snapshotOf } from '../audit/audit-diff';
import { CrudDeps } from '../common/crud/crud.deps';
import type { Tx } from '../common/crud/archivable-crud.service';
import { notFound, unknownReference } from '../common/crud/crud.errors';
import { settleFailedUpdate } from '../common/crud/optimistic-lock';
import { ScheduleAvailabilityService } from './schedule-availability.service';
import { ScheduleRulesService } from './schedule-rules.service';
import {
  EMPTY_ALTERNATIVES,
  conflictKindOf,
  scheduleConflict,
  type ScheduleAlternatives,
} from './schedule.errors';
import { ACADEMIC_HOUR_MINUTES } from './lesson-generation';
import {
  formatClockTime,
  parseClockTime,
  utcToZonedTime,
  zonedTimeToUtc,
} from './zoned-time.util';
import type {
  AvailabilityQueryDto,
  CancelLessonDto,
  CreateLessonDto,
  LessonListQueryDto,
  MoveLessonDto,
  SubstituteTeacherDto,
} from './dto/schedule.dto';

const LESSON_INCLUDE = {
  studyUnit: { select: { name: true, color: true, branchId: true, disciplineId: true } },
  classroom: { select: { name: true } },
  teacher: { select: { fullName: true } },
  actualTeacher: { select: { fullName: true } },
} satisfies Prisma.LessonInclude;

type LessonRecord = Prisma.LessonGetPayload<{ include: typeof LESSON_INCLUDE }>;

export interface LessonView {
  id: string;
  studyUnitId: string;
  studyUnitName: string;
  studyUnitColor: string | null;
  branchId: string;
  scheduleRuleId: string | null;
  date: string;
  startAt: string;
  endAt: string;
  classroomId: string | null;
  classroomName: string | null;
  teacherId: string | null;
  teacherName: string | null;
  actualTeacherId: string | null;
  actualTeacherName: string | null;
  /** True when a substitute is teaching — UX P4 marks these. */
  isSubstituted: boolean;
  status: string;
  isDetached: boolean;
  academicHours: number | null;
  topic: string | null;
  cancelReason: string | null;
  movedToLessonId: string | null;
  makeupForLessonId: string | null;
  attendanceCount: number;
  version: number;
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toView(record: LessonRecord): LessonView {
  return {
    id: record.id,
    studyUnitId: record.studyUnitId,
    studyUnitName: record.studyUnit.name,
    studyUnitColor: record.studyUnit.color,
    branchId: record.studyUnit.branchId,
    scheduleRuleId: record.scheduleRuleId,
    date: record.date.toISOString().slice(0, 10),
    startAt: record.startAt.toISOString(),
    endAt: record.endAt.toISOString(),
    classroomId: record.classroomId,
    classroomName: record.classroom?.name ?? null,
    teacherId: record.teacherId,
    teacherName: record.teacher?.fullName ?? null,
    actualTeacherId: record.actualTeacherId,
    actualTeacherName: record.actualTeacher?.fullName ?? null,
    isSubstituted:
      record.teacherId !== null && record.actualTeacherId !== null
        ? record.teacherId !== record.actualTeacherId
        : record.teacherId !== record.actualTeacherId,
    status: record.status,
    isDetached: record.isDetached,
    academicHours: record.academicHours === null ? null : Number(record.academicHours),
    topic: record.topic,
    cancelReason: record.cancelReason,
    movedToLessonId: record.movedToLessonId,
    makeupForLessonId: record.makeupForLessonId,
    attendanceCount: record.attendanceCount,
    version: record.version,
  };
}

export interface AvailabilityView {
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

/**
 * TZ M4.5–M4.6 — the calendar read model and the per-lesson actions.
 *
 * Every write here goes through `tenantDb.transaction`: each one touches at
 * least two rows (a move writes the old lesson *and* the new one) or reads
 * then writes, which CLAUDE.md requires to be one atomic operation.
 */
@Injectable()
export class LessonsService {
  private readonly logger = new Logger(LessonsService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly tenantDb: TenantPrismaClient,
    private readonly deps: CrudDeps,
    private readonly audit: AuditService,
    private readonly availability: ScheduleAvailabilityService,
    private readonly rules: ScheduleRulesService,
  ) {}

  /**
   * TZ M4.6 calendar. `from`/`to` are local calendar dates, so the query
   * filters on `date` rather than on `start_at` — "the week of 12 October"
   * means those seven branch-local days, and an instant range would clip a
   * late lesson on the last day in a zone ahead of UTC.
   */
  async list(query: LessonListQueryDto): Promise<LessonView[]> {
    const rows = await this.tenantDb.lesson.findMany({
      where: {
        date: { gte: toDate(query.from), lte: toDate(query.to) },
        ...(query.classroom_id === undefined ? {} : { classroomId: query.classroom_id }),
        ...(query.teacher_id === undefined ? {} : { actualTeacherId: query.teacher_id }),
        ...(query.study_unit_id === undefined ? {} : { studyUnitId: query.study_unit_id }),
        ...(query.branch_id === undefined ? {} : { studyUnit: { branchId: query.branch_id } }),
        ...(query.include_cancelled === 'true' ? {} : { status: { not: 'cancelled' } }),
        // A `moved` lesson is history, not a calendar entry: its replacement
        // is the row the grid should draw, and showing both would render
        // the same lesson twice in two places.
        NOT: { status: 'moved' },
      },
      include: LESSON_INCLUDE,
      orderBy: [{ startAt: 'asc' }],
      take: query.limit,
    });
    return rows.map(toView);
  }

  async get(id: string): Promise<LessonView> {
    const record = await this.tenantDb.lesson.findUnique({ where: { id }, include: LESSON_INCLUDE });
    if (record === null) {
      throw notFound('lesson', id);
    }
    return toView(record);
  }

  /**
   * UX 4.4's free-resource finder and the live tooltip the drag gesture
   * shows. Read-only, so it is a GET: it fires on every drag-over.
   */
  async checkAvailability(query: AvailabilityQueryDto): Promise<AvailabilityView> {
    return this.tenantDb.transaction(async (tx) => {
      const branch = await tx.branch.findUnique({
        where: { id: query.branch_id },
        select: { timezone: true },
      });
      if (branch === null) {
        throw unknownReference('branch_id', query.branch_id);
      }

      const exclude = query.exclude_lesson_id === undefined ? [] : [query.exclude_lesson_id];
      const slot = {
        startAt: zonedTimeToUtc(query.date, query.start_time, branch.timezone),
        endAt: zonedTimeToUtc(query.date, query.end_time, branch.timezone),
      };

      const [checked] = await this.availability.checkSlots(
        tx,
        [{ date: query.date, ...slot }],
        {
          classroomId: query.classroom_id ?? null,
          actualTeacherId: query.teacher_id ?? null,
          excludeLessonIds: exclude,
        },
      );
      const conflicts = checked?.conflicts ?? [];

      const [alternatives, freeTeachers] = await Promise.all([
        this.availability.alternativesFor(tx, {
          branchId: query.branch_id,
          date: query.date,
          startTime: query.start_time,
          endTime: query.end_time,
          timeZone: branch.timezone,
          classroomId: query.classroom_id ?? null,
          actualTeacherId: query.teacher_id ?? null,
          excludeLessonIds: exclude,
          minCapacity: query.min_capacity,
        }),
        this.availability.freeTeachers(tx, {
          branchId: query.branch_id,
          slot,
          disciplineId: query.discipline_id ?? null,
          excludeTeacherId: query.teacher_id ?? null,
          excludeLessonIds: exclude,
        }),
      ]);

      return {
        free: conflicts.length === 0,
        conflicts: conflicts.map((conflict) => ({
          kind: conflict.kind,
          lessonId: conflict.lesson.lessonId,
          studyUnitName: conflict.lesson.studyUnitName,
          startAt: conflict.lesson.startAt.toISOString(),
          endAt: conflict.lesson.endAt.toISOString(),
        })),
        alternatives,
        freeTeachers,
      };
    });
  }

  /**
   * TZ M4.5 "bitta darsni koʻchirish (moved_to_lesson_id)".
   *
   * The original row is *not* mutated. It becomes `moved` and points at a
   * brand-new lesson. Two reasons, both from the spec: the exclusion
   * constraints exclude `moved`, so the old slot is released the moment the
   * status changes (TZ M4.4's documented v1.0 fix), and any attendance
   * already recorded against the original keeps the row it was recorded on.
   *
   * The new lesson is `is_detached`, so a later regeneration of the rule
   * will not overwrite the move (TZ M4.3 SHART).
   */
  async move(id: string, expectedVersion: number | undefined, dto: MoveLessonDto): Promise<LessonView> {
    try {
      const record = await this.tenantDb.transaction(async (tx) => {
        const before = await this.loadOrThrow(tx, id);
        assertMutable(before, 'move');

        const timeZone = await this.timeZoneOf(tx, before.studyUnit.branchId);
        const durationMinutes =
          dto.endTime === undefined
            ? Math.round((before.endAt.getTime() - before.startAt.getTime()) / 60_000)
            : parseClockTime(dto.endTime) - parseClockTime(dto.startTime);
        const endTime = formatClockTime(parseClockTime(dto.startTime) + durationMinutes);

        const classroomId = dto.classroomId === undefined ? before.classroomId : dto.classroomId;
        if (classroomId !== null) {
          const classroom = await tx.classroom.findUnique({ where: { id: classroomId } });
          if (classroom === null) {
            throw unknownReference('classroomId', classroomId);
          }
        }

        const startAt = zonedTimeToUtc(dto.date, dto.startTime, timeZone);
        const endAt = zonedTimeToUtc(dto.date, endTime, timeZone);

        await this.assertSlotFree(tx, {
          date: dto.date,
          startAt,
          endAt,
          startTime: dto.startTime,
          endTime,
          timeZone,
          branchId: before.studyUnit.branchId,
          classroomId,
          actualTeacherId: before.actualTeacherId,
          // The lesson being moved must not block its own new slot — it is
          // about to become `moved` and stop reserving anything anyway.
          excludeLessonIds: [id],
        });

        const version = expectedVersion ?? before.version;
        const created = await tx.lesson.create({
          data: {
            id: uuidv7(),
            tenantId: this.deps.tenantId,
            studyUnitId: before.studyUnitId,
            scheduleRuleId: before.scheduleRuleId,
            date: toDate(dto.date),
            startAt,
            endAt,
            classroomId,
            teacherId: before.teacherId,
            actualTeacherId: before.actualTeacherId,
            academicHours: Math.round((durationMinutes / ACADEMIC_HOUR_MINUTES) * 100) / 100,
            topic: before.topic,
            homework: before.homework,
            notes: before.notes,
            isDetached: true,
          },
        });

        const { count } = await tx.lesson.updateMany({
          where: { id, version },
          data: {
            status: 'moved',
            movedToLessonId: created.id,
            isDetached: true,
            version: { increment: 1 },
          },
        });
        if (count === 0) {
          settleFailedUpdate(
            'lesson',
            id,
            version,
            await tx.lesson.findUnique({ where: { id } }),
            notFound,
          );
        }

        await this.audit.record(
          {
            action: 'lesson.reschedule',
            entityType: 'lesson',
            entityId: id,
            diff: snapshotOf({
              movedToLessonId: created.id,
              fromStartAt: before.startAt,
              toStartAt: startAt,
              fromClassroomId: before.classroomId,
              toClassroomId: classroomId,
              reason: dto.reason ?? null,
            }),
          },
          tx,
        );

        return this.loadOrThrow(tx, created.id);
      });
      return toView(record);
    } catch (error) {
      throw await this.translateConflict(error, id);
    }
  }

  /** TZ M4.5: "bekor qilish (sabab bilan, yechimsiz)". */
  async cancel(
    id: string,
    expectedVersion: number | undefined,
    dto: CancelLessonDto,
  ): Promise<LessonView> {
    const record = await this.tenantDb.transaction(async (tx) => {
      const before = await this.loadOrThrow(tx, id);
      assertMutable(before, 'cancel');

      const version = expectedVersion ?? before.version;
      const { count } = await tx.lesson.updateMany({
        where: { id, version },
        data: {
          status: 'cancelled',
          cancelReason: dto.reason,
          // A cancellation is a human decision about this one lesson;
          // regeneration must not resurrect it (TZ M4.3 SHART).
          isDetached: true,
          version: { increment: 1 },
        },
      });
      if (count === 0) {
        settleFailedUpdate('lesson', id, version, await tx.lesson.findUnique({ where: { id } }), notFound);
      }

      await this.audit.record(
        {
          action: 'lesson.cancel',
          entityType: 'lesson',
          entityId: id,
          diff: diffOf({ status: before.status }, { status: 'cancelled', reason: dto.reason }),
        },
        tx,
      );
      return this.loadOrThrow(tx, id);
    });
    return toView(record);
  }

  /**
   * TZ M4.5 "oʻqituvchini almashtirish". Only `actual_teacher_id` moves:
   * `teacher_id` keeps recording who was scheduled (otherwise the
   * substitution is invisible after the fact), and TZ M4.4 is explicit that
   * both the conflict constraint and payroll follow the actual teacher.
   */
  async substituteTeacher(
    id: string,
    expectedVersion: number | undefined,
    dto: SubstituteTeacherDto,
  ): Promise<LessonView> {
    try {
      const record = await this.tenantDb.transaction(async (tx) => {
        const before = await this.loadOrThrow(tx, id);
        assertMutable(before, 'substitute');

        if (dto.actualTeacherId !== null) {
          const teacher = await tx.user.findUnique({ where: { id: dto.actualTeacherId } });
          if (teacher === null) {
            throw unknownReference('actualTeacherId', dto.actualTeacherId);
          }
          const timeZone = await this.timeZoneOf(tx, before.studyUnit.branchId);
          await this.assertSlotFree(tx, {
            date: before.date.toISOString().slice(0, 10),
            startAt: before.startAt,
            endAt: before.endAt,
            startTime: utcToZonedTime(before.startAt, timeZone),
            endTime: utcToZonedTime(before.endAt, timeZone),
            timeZone,
            branchId: before.studyUnit.branchId,
            // Only the teacher is changing; the room is already this
            // lesson's own and would conflict with itself.
            classroomId: null,
            actualTeacherId: dto.actualTeacherId,
            excludeLessonIds: [id],
          });
        }

        const version = expectedVersion ?? before.version;
        const { count } = await tx.lesson.updateMany({
          where: { id, version },
          data: {
            actualTeacherId: dto.actualTeacherId,
            isDetached: true,
            version: { increment: 1 },
          },
        });
        if (count === 0) {
          settleFailedUpdate('lesson', id, version, await tx.lesson.findUnique({ where: { id } }), notFound);
        }

        await this.audit.record(
          {
            action: 'lesson.substitute_teacher',
            entityType: 'lesson',
            entityId: id,
            diff: diffOf(
              { actualTeacherId: before.actualTeacherId },
              { actualTeacherId: dto.actualTeacherId, reason: dto.reason ?? null },
            ),
          },
          tx,
        );
        return this.loadOrThrow(tx, id);
      });
      return toView(record);
    } catch (error) {
      throw await this.translateConflict(error, id);
    }
  }

  /**
   * TZ M4.5 "qoʻshimcha dars" / "qayta dars (makeup)". Always detached —
   * it belongs to no rule, so regeneration has nothing to match it against
   * and must leave it alone.
   */
  async create(dto: CreateLessonDto): Promise<LessonView> {
    try {
      const record = await this.tenantDb.transaction(async (tx) => {
        const context = await this.rules.loadContext(tx, dto.studyUnitId);

        if (dto.classroomId !== undefined && dto.classroomId !== null) {
          const classroom = await tx.classroom.findUnique({ where: { id: dto.classroomId } });
          if (classroom === null) {
            throw unknownReference('classroomId', dto.classroomId);
          }
        }
        if (dto.teacherId !== undefined && dto.teacherId !== null) {
          const teacher = await tx.user.findUnique({ where: { id: dto.teacherId } });
          if (teacher === null) {
            throw unknownReference('teacherId', dto.teacherId);
          }
        }
        if (dto.makeupForLessonId !== undefined && dto.makeupForLessonId !== null) {
          const original = await tx.lesson.findUnique({ where: { id: dto.makeupForLessonId } });
          if (original === null) {
            throw unknownReference('makeupForLessonId', dto.makeupForLessonId);
          }
        }

        const startAt = zonedTimeToUtc(dto.date, dto.startTime, context.timeZone);
        const endAt = zonedTimeToUtc(dto.date, dto.endTime, context.timeZone);
        const durationMinutes = parseClockTime(dto.endTime) - parseClockTime(dto.startTime);

        await this.assertSlotFree(tx, {
          date: dto.date,
          startAt,
          endAt,
          startTime: dto.startTime,
          endTime: dto.endTime,
          timeZone: context.timeZone,
          branchId: context.branchId,
          classroomId: dto.classroomId ?? null,
          actualTeacherId: dto.teacherId ?? null,
          minCapacity: context.enrolledCount,
        });

        const created = await tx.lesson.create({
          data: {
            id: uuidv7(),
            tenantId: this.deps.tenantId,
            studyUnitId: dto.studyUnitId,
            date: toDate(dto.date),
            startAt,
            endAt,
            classroomId: dto.classroomId ?? null,
            teacherId: dto.teacherId ?? null,
            actualTeacherId: dto.teacherId ?? null,
            academicHours: Math.round((durationMinutes / ACADEMIC_HOUR_MINUTES) * 100) / 100,
            topic: dto.topic ?? null,
            makeupForLessonId: dto.makeupForLessonId ?? null,
            isDetached: true,
          },
        });

        await this.audit.record(
          {
            action: 'schedule.create',
            entityType: 'lesson',
            entityId: created.id,
            diff: snapshotOf({
              studyUnitId: dto.studyUnitId,
              date: dto.date,
              startTime: dto.startTime,
              endTime: dto.endTime,
              classroomId: dto.classroomId ?? null,
              makeupForLessonId: dto.makeupForLessonId ?? null,
            }),
          },
          tx,
        );
        return this.loadOrThrow(tx, created.id);
      });
      return toView(record);
    } catch (error) {
      throw await this.translateConflict(error, null);
    }
  }

  /**
   * The application-side half of TZ M4.4: catches the conflict *before* the
   * constraint does, purely so the caller gets alternatives to pick from.
   * The constraint is still what guarantees the invariant under
   * concurrency — see `translateConflict` for the loser of that race.
   */
  private async assertSlotFree(
    tx: Tx,
    options: {
      date: string;
      startAt: Date;
      endAt: Date;
      startTime: string;
      endTime: string;
      timeZone: string;
      branchId: string;
      classroomId: string | null;
      actualTeacherId: string | null;
      excludeLessonIds?: readonly string[];
      minCapacity?: number;
    },
  ): Promise<void> {
    const [checked] = await this.availability.checkSlots(
      tx,
      [{ date: options.date, startAt: options.startAt, endAt: options.endAt }],
      {
        classroomId: options.classroomId,
        actualTeacherId: options.actualTeacherId,
        excludeLessonIds: options.excludeLessonIds,
      },
    );
    const conflict = checked?.conflicts[0];
    if (conflict === undefined) {
      return;
    }

    const alternatives = await this.availability.alternativesFor(tx, {
      branchId: options.branchId,
      date: options.date,
      startTime: options.startTime,
      endTime: options.endTime,
      timeZone: options.timeZone,
      classroomId: options.classroomId,
      actualTeacherId: options.actualTeacherId,
      excludeLessonIds: options.excludeLessonIds,
      minCapacity: options.minCapacity,
    });
    throw scheduleConflict(conflict.kind, alternatives, conflict.lesson);
  }

  /**
   * The exclusion constraint firing means a concurrent write won the race
   * between our pre-check and our INSERT. The caller still deserves the
   * SCHEDULE_CONFLICT body, so the alternatives are rebuilt in a fresh
   * transaction (the failed one can no longer run queries).
   */
  private async translateConflict(error: unknown, lessonId: string | null): Promise<unknown> {
    const kind = conflictKindOf(error);
    if (kind === null) {
      return error;
    }
    if (lessonId === null) {
      return scheduleConflict(kind, EMPTY_ALTERNATIVES);
    }
    try {
      const alternatives = await this.tenantDb.transaction(async (tx) => {
        const lesson = await this.loadOrThrow(tx, lessonId);
        const timeZone = await this.timeZoneOf(tx, lesson.studyUnit.branchId);
        return this.availability.alternativesFor(tx, {
          branchId: lesson.studyUnit.branchId,
          date: lesson.date.toISOString().slice(0, 10),
          startTime: utcToZonedTime(lesson.startAt, timeZone),
          endTime: utcToZonedTime(lesson.endAt, timeZone),
          timeZone,
          classroomId: lesson.classroomId,
          actualTeacherId: lesson.actualTeacherId,
          excludeLessonIds: [lessonId],
        });
      });
      return scheduleConflict(kind, alternatives);
    } catch (nested) {
      this.logger.warn(
        `Could not build schedule alternatives: ${
          nested instanceof Error ? nested.message : String(nested)
        }`,
      );
      return scheduleConflict(kind, EMPTY_ALTERNATIVES);
    }
  }

  private async timeZoneOf(tx: Tx, branchId: string): Promise<string> {
    const branch = await tx.branch.findUnique({
      where: { id: branchId },
      select: { timezone: true },
    });
    if (branch === null) {
      throw unknownReference('branchId', branchId);
    }
    return branch.timezone;
  }

  private async loadOrThrow(tx: Tx, id: string): Promise<LessonRecord> {
    const record = await tx.lesson.findUnique({ where: { id }, include: LESSON_INCLUDE });
    if (record === null) {
      throw notFound('lesson', id);
    }
    return record;
  }
}

/**
 * A lesson that has already been cancelled, completed or moved away is
 * history. Editing it would either contradict a recorded outcome or
 * resurrect a slot the constraint has already released.
 */
function assertMutable(lesson: LessonRecord, action: string): void {
  if (lesson.status === 'planned') {
    return;
  }
  throw new ConflictException({
    code: 'LESSON_NOT_MUTABLE',
    message: `a ${lesson.status} lesson cannot be ${action}ed`,
    details: [{ field: 'status', code: 'LESSON_NOT_MUTABLE', status: lesson.status, action }],
  });
}
