import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { TENANT_PRISMA, type TenantPrismaClient } from '../database/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { diffOf, snapshotOf } from '../audit/audit-diff';
import { CrudDeps } from '../common/crud/crud.deps';
import type { Tx } from '../common/crud/archivable-crud.service';
import { notFound, unknownReference } from '../common/crud/crud.errors';
import { settleFailedUpdate } from '../common/crud/optimistic-lock';
import {
  generateLessons,
  horizonEnd,
  occurrenceAcademicHours,
  occurrenceMinutes,
  type GeneratedLesson,
  type ScheduleRuleInput,
} from './lesson-generation';
import { formatClockTime, parseClockTime } from './zoned-time.util';
import { ScheduleAvailabilityService, type SlotConflict } from './schedule-availability.service';
import {
  EMPTY_ALTERNATIVES,
  conflictKindOf,
  scheduleConflict,
  type ScheduleAlternatives,
} from './schedule.errors';
import { createScheduleRuleSchema } from './dto/schedule.dto';
import type {
  CreateScheduleRuleDto,
  PreviewScheduleRuleDto,
  ScheduleRuleListQueryDto,
  UpdateScheduleRuleDto,
} from './dto/schedule.dto';

/** `YYYY-MM-DD` -> the `Date` Prisma wants for a `@db.Date` column. */
function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateStr(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function decimalToNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}

export interface ScheduleRuleView {
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
  /** How many lessons this rule currently owns — what the UI reports after a save. */
  lessonCount: number;
}

const RULE_INCLUDE = {
  classroom: { select: { name: true } },
  teacher: { select: { fullName: true } },
  _count: { select: { lessons: true } },
} satisfies Prisma.ScheduleRuleInclude;

type RuleRecord = Prisma.ScheduleRuleGetPayload<{ include: typeof RULE_INCLUDE }>;

function toView(record: RuleRecord): ScheduleRuleView {
  return {
    id: record.id,
    studyUnitId: record.studyUnitId,
    daysOfWeek: [...record.daysOfWeek].sort((left, right) => left - right),
    startTime: record.startTime,
    endTime: record.endTime,
    academicHoursPerDay: decimalToNumber(record.academicHoursPerDay),
    breakMinutes: record.breakMinutes,
    periodStart: toDateStr(record.periodStart),
    periodEnd: record.periodEnd === null ? null : toDateStr(record.periodEnd),
    totalAcademicHours: decimalToNumber(record.totalAcademicHours),
    classroomId: record.classroomId,
    classroomName: record.classroom?.name ?? null,
    teacherId: record.teacherId,
    teacherName: record.teacher?.fullName ?? null,
    isActive: record.isActive,
    version: record.version,
    lessonCount: record._count.lessons,
  };
}

/** TZ M4.3 (SHART) preview: what saving this rule would produce. */
export interface SchedulePreview {
  lessonCount: number;
  firstDate: string | null;
  lastDate: string | null;
  totalAcademicHours: number;
  /** Dates inside the period that produced no lesson because of a holiday. */
  skippedHolidays: string[];
  conflicts: {
    date: string;
    startAt: string;
    endAt: string;
    kind: 'classroom' | 'teacher';
    conflictingLessonId: string;
    conflictingStudyUnitName: string;
  }[];
  /** Free rooms/times for the first conflict — UX P4's "Boʻsh: 206, 301". */
  alternatives: ScheduleAlternatives;
  lessons: { date: string; startAt: string; endAt: string }[];
}

interface RuleContext {
  studyUnitId: string;
  studyUnitName: string;
  branchId: string;
  disciplineId: string;
  timeZone: string;
  /** Occupying members — used as the minimum capacity for room suggestions. */
  enrolledCount: number;
}

/**
 * TZ M4.3 — schedule rules and the materialized lessons they own.
 *
 * Materialization (not on-the-fly recurrence expansion) is marked SHART by
 * the spec, with the reasons spelled out: conflict control is a DB
 * constraint and needs rows to constrain, every lesson is individually
 * editable, attendance and charges attach to a lesson, and expanding an
 * RRULE on every request is slow.
 */
@Injectable()
export class ScheduleRulesService {
  private readonly logger = new Logger(ScheduleRulesService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly tenantDb: TenantPrismaClient,
    private readonly deps: CrudDeps,
    private readonly audit: AuditService,
    private readonly availability: ScheduleAvailabilityService,
  ) {}

  async list(query: ScheduleRuleListQueryDto): Promise<ScheduleRuleView[]> {
    const rows = await this.tenantDb.scheduleRule.findMany({
      where: {
        ...(query.study_unit_id === undefined ? {} : { studyUnitId: query.study_unit_id }),
        ...(query.is_active === 'all' ? {} : { isActive: query.is_active === 'true' }),
      },
      include: RULE_INCLUDE,
      orderBy: [{ periodStart: 'asc' }, { startTime: 'asc' }],
    });
    return rows.map(toView);
  }

  async get(id: string): Promise<ScheduleRuleView> {
    const record = await this.tenantDb.scheduleRule.findUnique({ where: { id }, include: RULE_INCLUDE });
    if (record === null) {
      throw notFound('schedule_rule', id);
    }
    return toView(record);
  }

  /**
   * TZ M4.3 (SHART): "POST /schedule-rules/:id/preview — saqlashdan oldin
   * natija va konfliktlar roʻyxati". Writes nothing.
   *
   * `replacingRuleId` is the rule this body would overwrite, if any: its
   * own future lessons are about to be deleted by the save, so counting
   * them as conflicts would make every edit look like it collides with
   * itself.
   */
  async preview(dto: PreviewScheduleRuleDto, replacingRuleId?: string): Promise<SchedulePreview> {
    return this.tenantDb.transaction(async (tx) => {
      const context = await this.loadContext(tx, dto.studyUnitId);
      await this.assertReferences(tx, dto);
      return this.buildPreview(tx, dto, context, replacingRuleId ?? null);
    });
  }

  async create(dto: CreateScheduleRuleDto): Promise<ScheduleRuleView> {
    try {
      const record = await this.tenantDb.transaction(async (tx) => {
        const context = await this.loadContext(tx, dto.studyUnitId);
        await this.assertReferences(tx, dto);

        const preview = await this.buildPreview(tx, dto, context, null);
        this.refuseOnConflict(preview);

        const rule = await tx.scheduleRule.create({
          data: {
            id: uuidv7(),
            tenantId: this.deps.tenantId,
            studyUnitId: dto.studyUnitId,
            daysOfWeek: dto.daysOfWeek,
            startTime: dto.startTime,
            endTime: dto.endTime ?? null,
            academicHoursPerDay: dto.academicHoursPerDay ?? null,
            breakMinutes: dto.breakMinutes,
            periodStart: toDate(dto.periodStart),
            periodEnd: dto.periodEnd === undefined || dto.periodEnd === null ? null : toDate(dto.periodEnd),
            totalAcademicHours: dto.totalAcademicHours ?? null,
            classroomId: dto.classroomId ?? null,
            teacherId: dto.teacherId ?? null,
          },
        });

        await this.insertLessons(tx, rule.id, dto.studyUnitId, dto.classroomId ?? null, dto.teacherId ?? null, preview.lessons);

        const created = await this.loadOrThrow(tx, rule.id);
        await this.audit.record(
          {
            action: 'schedule.create',
            entityType: 'schedule_rule',
            entityId: rule.id,
            diff: snapshotOf({ ...auditable(created), lessonsGenerated: preview.lessonCount }),
          },
          tx,
        );
        return created;
      });
      return toView(record);
    } catch (error) {
      throw await this.translateConflict(error, dto);
    }
  }

  /**
   * TZ M4.3: "Qoida oʻzgarganda: oʻtgan darslar tegilmaydi, kelajakdagilar
   * regeneratsiya". The regeneration is in `regenerate`; this is the edit
   * plus the optimistic-lock dance around it.
   */
  async update(
    id: string,
    expectedVersion: number | undefined,
    dto: UpdateScheduleRuleDto,
  ): Promise<ScheduleRuleView> {
    let effective: CreateScheduleRuleDto | null = null;
    try {
      const record = await this.tenantDb.transaction(async (tx) => {
        const before = await this.loadOrThrow(tx, id);
        const context = await this.loadContext(tx, before.studyUnitId);
        effective = assertMergedRuleValid(mergeRule(before, dto));
        await this.assertReferences(tx, effective);

        const version = expectedVersion ?? before.version;
        const { count } = await tx.scheduleRule.updateMany({
          where: { id, version },
          data: {
            ...(dto.daysOfWeek === undefined ? {} : { daysOfWeek: dto.daysOfWeek }),
            ...(dto.startTime === undefined ? {} : { startTime: dto.startTime }),
            ...(dto.endTime === undefined ? {} : { endTime: dto.endTime }),
            ...(dto.academicHoursPerDay === undefined
              ? {}
              : { academicHoursPerDay: dto.academicHoursPerDay }),
            ...(dto.breakMinutes === undefined ? {} : { breakMinutes: dto.breakMinutes }),
            ...(dto.periodStart === undefined ? {} : { periodStart: toDate(dto.periodStart) }),
            ...(dto.periodEnd === undefined
              ? {}
              : { periodEnd: dto.periodEnd === null ? null : toDate(dto.periodEnd) }),
            ...(dto.totalAcademicHours === undefined
              ? {}
              : { totalAcademicHours: dto.totalAcademicHours }),
            ...(dto.classroomId === undefined ? {} : { classroomId: dto.classroomId }),
            ...(dto.teacherId === undefined ? {} : { teacherId: dto.teacherId }),
            ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
            version: { increment: 1 },
          },
        });
        if (count === 0) {
          settleFailedUpdate(
            'schedule_rule',
            id,
            version,
            await tx.scheduleRule.findUnique({ where: { id } }),
            notFound,
          );
        }

        // "Future" is a question about the branch's calendar, not the
        // server's: a rule edit at 02:00 UTC must not treat a lesson later
        // the same Tashkent morning as already past.
        const outcome = await this.regenerate(tx, id, context, todayIn(context.timeZone));

        const after = await this.loadOrThrow(tx, id);
        await this.audit.record(
          {
            action: 'schedule.update',
            entityType: 'schedule_rule',
            entityId: id,
            diff: diffOf(auditable(before), {
              ...auditable(after),
              lessonsCreated: outcome.created,
              lessonsDeleted: outcome.deleted,
            }),
          },
          tx,
        );
        return after;
      });
      return toView(record);
    } catch (error) {
      throw await this.translateConflict(error, effective);
    }
  }

  /**
   * `schedule.delete`. Deactivates the rule and drops the future lessons it
   * owns — it never deletes the rule row, because lessons point at it and a
   * removed rule would make a completed term's lessons unexplainable.
   */
  async deactivate(
    id: string,
    expectedVersion: number | undefined,
  ): Promise<ScheduleRuleView> {
    const record = await this.tenantDb.transaction(async (tx) => {
      const before = await this.loadOrThrow(tx, id);
      const context = await this.loadContext(tx, before.studyUnitId);

      const version = expectedVersion ?? before.version;
      const { count } = await tx.scheduleRule.updateMany({
        where: { id, version },
        data: { isActive: false, version: { increment: 1 } },
      });
      if (count === 0) {
        settleFailedUpdate(
          'schedule_rule',
          id,
          version,
          await tx.scheduleRule.findUnique({ where: { id } }),
          notFound,
        );
      }

      const outcome = await this.regenerate(tx, id, context, todayIn(context.timeZone));

      const after = await this.loadOrThrow(tx, id);
      await this.audit.record(
        {
          action: 'schedule.delete',
          entityType: 'schedule_rule',
          entityId: id,
          diff: diffOf({ isActive: true }, { isActive: false, lessonsDeleted: outcome.deleted }),
        },
        tx,
      );
      return after;
    });
    return toView(record);
  }

  /**
   * TZ M4.3's regeneration contract, in one place because every caller
   * (rule edit, deactivation, the nightly horizon job) must honour exactly
   * the same four protections:
   *
   *   * past lessons are never touched ("oʻtgan darslar tegilmaydi");
   *   * `is_detached` lessons are never overwritten (SHART);
   *   * a lesson with attendance is never auto-deleted (SHART) — see the
   *     `attendance_count` note in the migration;
   *   * a lesson that is already completed, cancelled or moved keeps its
   *     outcome. Re-creating a cancelled lesson would silently un-cancel
   *     it, which is why its date goes into the skip set rather than back
   *     into the generator.
   *
   * Only `planned`, attached, attendance-free, future lessons of this rule
   * are deleted and rebuilt.
   *
   * `mode` is the difference between the two callers:
   *
   *   * `rebuild` (a rule edit or deactivation) drops those lessons and
   *     regenerates them, because their time or room genuinely changed;
   *   * `extend` (the nightly horizon job) deletes nothing and only fills
   *     in dates no lesson covers yet. A nightly rebuild would be
   *     *functionally* identical — the same dates and times come back out —
   *     but it would hand every planned lesson a new id every night, and
   *     lesson ids are what attendance (T09) and charges (T10) hang off,
   *     as well as what any link or cached report refers to.
   */
  async regenerate(
    tx: Tx,
    ruleId: string,
    context: RuleContext,
    today: string,
    mode: 'rebuild' | 'extend' = 'rebuild',
  ): Promise<{ created: number; deleted: number }> {
    const rule = await tx.scheduleRule.findUnique({ where: { id: ruleId } });
    if (rule === null) {
      throw notFound('schedule_rule', ruleId);
    }

    const doomed =
      mode === 'extend'
        ? []
        : await tx.lesson.findMany({
            where: {
              scheduleRuleId: ruleId,
              date: { gte: toDate(today) },
              isDetached: false,
              attendanceCount: 0,
              status: 'planned',
            },
            select: { id: true },
          });
    if (doomed.length > 0) {
      await tx.lesson.deleteMany({ where: { id: { in: doomed.map((row) => row.id) } } });
    }

    // Everything this rule still owns after the delete: the kept lessons.
    // Their dates are off-limits to the generator and their academic hours
    // have already been spent against `totalAcademicHours`.
    const kept = await tx.lesson.findMany({
      where: { scheduleRuleId: ruleId },
      select: { date: true, academicHours: true },
    });
    const keptDates = new Set(kept.map((row) => toDateStr(row.date)));
    const hoursSpent = kept.reduce(
      (sum, row) => sum + (row.academicHours === null ? 0 : Number(row.academicHours)),
      0,
    );

    if (!rule.isActive) {
      return { created: 0, deleted: doomed.length };
    }

    const input = recordToInput(rule);
    const horizon = horizonEnd(today);
    const periodStart = toDateStr(rule.periodStart);
    const from = today > periodStart ? today : periodStart;
    if (from > horizon) {
      return { created: 0, deleted: doomed.length };
    }

    const holidays = await this.availability.holidayDates(tx, context.branchId, from, horizon);
    const skip = new Set([...holidays, ...keptDates]);

    const candidates = generateLessons(input, { from, to: horizon }, skip, context.timeZone, hoursSpent);
    await this.insertLessons(tx, ruleId, rule.studyUnitId, rule.classroomId, rule.teacherId, candidates);

    return { created: candidates.length, deleted: doomed.length };
  }

  /** Loads the branch timezone and group facts generation needs. */
  async loadContext(tx: Tx, studyUnitId: string): Promise<RuleContext> {
    const unit = await tx.studyUnit.findUnique({
      where: { id: studyUnitId },
      select: {
        id: true,
        name: true,
        branchId: true,
        disciplineId: true,
        branch: { select: { timezone: true } },
        enrollments: { where: { status: { in: ['active', 'frozen'] } }, select: { id: true } },
      },
    });
    if (unit === null) {
      throw unknownReference('studyUnitId', studyUnitId);
    }
    return {
      studyUnitId: unit.id,
      studyUnitName: unit.name,
      branchId: unit.branchId,
      disciplineId: unit.disciplineId,
      timeZone: unit.branch.timezone,
      enrolledCount: unit.enrollments.length,
    };
  }

  private async assertReferences(tx: Tx, dto: CreateScheduleRuleDto): Promise<void> {
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
  }

  private async buildPreview(
    tx: Tx,
    dto: CreateScheduleRuleDto,
    context: RuleContext,
    replacingRuleId: string | null,
  ): Promise<SchedulePreview> {
    const input = dtoToInput(dto);
    const today = todayIn(context.timeZone);
    const horizon = horizonEnd(today);
    const from = today > dto.periodStart ? today : dto.periodStart;

    if (from > horizon) {
      return emptyPreview();
    }

    const holidays = await this.availability.holidayDates(tx, context.branchId, from, horizon);
    const candidates = generateLessons(input, { from, to: horizon }, holidays, context.timeZone);

    // The holiday dates that actually fell on one of the rule's weekdays —
    // the UX 4.3 wizard reports "Konflikt: 2 (bayram 1, xona band 1)", so a
    // holiday the group never met on anyway must not be counted.
    const weekdays = new Set(input.daysOfWeek);
    const skippedHolidays = [...holidays]
      .filter((date) => date >= from && date <= horizon)
      .filter((date) => weekdays.has(isoWeekdayOf(date)))
      .sort();

    const checked = await this.availability.checkSlots(tx, candidates, {
      classroomId: dto.classroomId ?? null,
      actualTeacherId: dto.teacherId ?? null,
      excludeScheduleRuleId: replacingRuleId,
    });

    const conflicts = checked
      .filter((slot) => slot.conflicts.length > 0)
      .map((slot) => {
        const first = slot.conflicts[0] as SlotConflict;
        return {
          date: slot.date,
          startAt: slot.startAt.toISOString(),
          endAt: slot.endAt.toISOString(),
          kind: first.kind,
          conflictingLessonId: first.lesson.lessonId,
          conflictingStudyUnitName: first.lesson.studyUnitName,
        };
      });

    const durationMinutes = occurrenceMinutes(input);
    const alternatives =
      conflicts.length === 0
        ? EMPTY_ALTERNATIVES
        : await this.availability.alternativesFor(tx, {
            branchId: context.branchId,
            date: conflicts[0]!.date,
            startTime: input.startTime,
            endTime: formatClockTime(parseClockTime(input.startTime) + durationMinutes),
            timeZone: context.timeZone,
            classroomId: dto.classroomId ?? null,
            actualTeacherId: dto.teacherId ?? null,
            minCapacity: context.enrolledCount,
          });

    return {
      lessonCount: candidates.length,
      firstDate: candidates[0]?.date ?? null,
      lastDate: candidates[candidates.length - 1]?.date ?? null,
      totalAcademicHours:
        Math.round(candidates.reduce((sum, lesson) => sum + lesson.academicHours, 0) * 100) / 100,
      skippedHolidays,
      conflicts,
      alternatives,
      lessons: candidates.map((lesson) => ({
        date: lesson.date,
        startAt: lesson.startAt.toISOString(),
        endAt: lesson.endAt.toISOString(),
      })),
    };
  }

  /**
   * A save with a known conflict is refused rather than silently thinned
   * out: TZ M4.4 makes a classroom/teacher clash a *block*, and skipping
   * the clashing dates would quietly produce a term with holes in it. The
   * preview endpoint exists so the user resolves this before saving.
   */
  private refuseOnConflict(preview: SchedulePreview): void {
    const first = preview.conflicts[0];
    if (first === undefined) {
      return;
    }
    throw scheduleConflict(first.kind, preview.alternatives, {
      lessonId: first.conflictingLessonId,
      studyUnitId: '',
      studyUnitName: first.conflictingStudyUnitName,
      startAt: new Date(first.startAt),
      endAt: new Date(first.endAt),
    });
  }

  private async insertLessons(
    tx: Tx,
    ruleId: string,
    studyUnitId: string,
    classroomId: string | null,
    teacherId: string | null,
    lessons: readonly (GeneratedLesson | { date: string; startAt: string; endAt: string })[],
  ): Promise<void> {
    if (lessons.length === 0) {
      return;
    }
    await tx.lesson.createMany({
      data: lessons.map((lesson) => ({
        id: uuidv7(),
        tenantId: this.deps.tenantId,
        studyUnitId,
        scheduleRuleId: ruleId,
        date: toDate(lesson.date),
        startAt: new Date(lesson.startAt),
        endAt: new Date(lesson.endAt),
        classroomId,
        teacherId,
        // TZ M4.4: `actual_teacher_id` defaults to `teacher_id`, and is what
        // the conflict constraint and payroll both read.
        actualTeacherId: teacherId,
        academicHours:
          'academicHours' in lesson
            ? lesson.academicHours
            : Math.round(((new Date(lesson.endAt).getTime() - new Date(lesson.startAt).getTime()) /
                60_000 /
                45) *
                100) / 100,
      })),
    });
  }

  /**
   * The exclusion constraints are the backstop behind `checkSlots`: two
   * concurrent saves both pass the pre-check and one of them loses here.
   * That loser must still get the SCHEDULE_CONFLICT body with alternatives,
   * not a 500 — so the translation happens outside the transaction, in a
   * fresh one, because the failed transaction can no longer run queries.
   */
  private async translateConflict(error: unknown, dto: CreateScheduleRuleDto | null): Promise<unknown> {
    const kind = conflictKindOf(error);
    if (kind === null) {
      return error;
    }
    if (dto === null) {
      return scheduleConflict(kind, EMPTY_ALTERNATIVES);
    }

    try {
      const alternatives = await this.tenantDb.transaction(async (tx) => {
        const context = await this.loadContext(tx, dto.studyUnitId);
        const input = dtoToInput(dto);
        const duration = occurrenceMinutes(input);
        return this.availability.alternativesFor(tx, {
          branchId: context.branchId,
          date: dto.periodStart,
          startTime: input.startTime,
          endTime: formatClockTime(parseClockTime(input.startTime) + duration),
          timeZone: context.timeZone,
          classroomId: dto.classroomId ?? null,
          actualTeacherId: dto.teacherId ?? null,
          minCapacity: context.enrolledCount,
        });
      });
      return scheduleConflict(kind, alternatives);
    } catch (nested) {
      // Suggestions are a nicety; the conflict itself is the answer.
      this.logger.warn(
        `Could not build schedule alternatives: ${
          nested instanceof Error ? nested.message : String(nested)
        }`,
      );
      return scheduleConflict(kind, EMPTY_ALTERNATIVES);
    }
  }

  private async loadOrThrow(tx: Tx, id: string): Promise<RuleRecord> {
    const record = await tx.scheduleRule.findUnique({ where: { id }, include: RULE_INCLUDE });
    if (record === null) {
      throw notFound('schedule_rule', id);
    }
    return record;
  }
}

function auditable(record: RuleRecord): Record<string, unknown> {
  return {
    studyUnitId: record.studyUnitId,
    daysOfWeek: record.daysOfWeek,
    startTime: record.startTime,
    endTime: record.endTime,
    academicHoursPerDay: decimalToNumber(record.academicHoursPerDay),
    breakMinutes: record.breakMinutes,
    periodStart: record.periodStart,
    periodEnd: record.periodEnd,
    totalAcademicHours: decimalToNumber(record.totalAcademicHours),
    classroomId: record.classroomId,
    teacherId: record.teacherId,
    isActive: record.isActive,
  };
}

function dtoToInput(dto: CreateScheduleRuleDto): ScheduleRuleInput {
  return {
    daysOfWeek: dto.daysOfWeek,
    startTime: dto.startTime,
    endTime: dto.endTime ?? null,
    academicHoursPerDay: dto.academicHoursPerDay ?? null,
    breakMinutes: dto.breakMinutes,
    periodStart: dto.periodStart,
    periodEnd: dto.periodEnd ?? null,
    totalAcademicHours: dto.totalAcademicHours ?? null,
  };
}

function recordToInput(record: {
  daysOfWeek: number[];
  startTime: string;
  endTime: string | null;
  academicHoursPerDay: Prisma.Decimal | null;
  breakMinutes: number;
  periodStart: Date;
  periodEnd: Date | null;
  totalAcademicHours: Prisma.Decimal | null;
}): ScheduleRuleInput {
  return {
    daysOfWeek: record.daysOfWeek,
    startTime: record.startTime,
    endTime: record.endTime,
    academicHoursPerDay: decimalToNumber(record.academicHoursPerDay),
    breakMinutes: record.breakMinutes,
    periodStart: toDateStr(record.periodStart),
    periodEnd: record.periodEnd === null ? null : toDateStr(record.periodEnd),
    totalAcademicHours: decimalToNumber(record.totalAcademicHours),
  };
}

/**
 * A PATCH body merged onto the stored rule, so conflict detection and the
 * alternatives lookup both run against what the rule will actually be
 * rather than against the handful of fields the caller happened to send.
 */
function mergeRule(record: RuleRecord, dto: UpdateScheduleRuleDto): CreateScheduleRuleDto {
  const base = recordToInput(record);
  return {
    studyUnitId: record.studyUnitId,
    daysOfWeek: dto.daysOfWeek ?? base.daysOfWeek,
    startTime: dto.startTime ?? base.startTime,
    endTime: dto.endTime === undefined ? base.endTime : dto.endTime,
    academicHoursPerDay:
      dto.academicHoursPerDay === undefined ? base.academicHoursPerDay : dto.academicHoursPerDay,
    breakMinutes: dto.breakMinutes ?? base.breakMinutes,
    periodStart: dto.periodStart ?? base.periodStart,
    periodEnd: dto.periodEnd === undefined ? base.periodEnd : dto.periodEnd,
    totalAcademicHours:
      dto.totalAcademicHours === undefined ? base.totalAcademicHours : dto.totalAcademicHours,
    classroomId: dto.classroomId === undefined ? record.classroomId : dto.classroomId,
    teacherId: dto.teacherId === undefined ? record.teacherId : dto.teacherId,
  } as CreateScheduleRuleDto;
}

/** Today's local calendar date in a zone — the anchor for "future lessons". */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function isoWeekdayOf(date: string): number {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function emptyPreview(): SchedulePreview {
  return {
    lessonCount: 0,
    firstDate: null,
    lastDate: null,
    totalAcademicHours: 0,
    skippedHolidays: [],
    conflicts: [],
    alternatives: EMPTY_ALTERNATIVES,
    lessons: [],
  };
}

/** Re-exported so the lessons service shares one definition of "an hour". */
export { occurrenceAcademicHours };

/**
 * The two TZ M4.3 "yoki" invariants are properties of the whole rule, so a
 * PATCH can only be judged after its fields are merged onto the stored row
 * (see the note on `updateScheduleRuleSchema`). Validating the merged
 * object here keeps the error in the same TZ 6.2 shape the request pipe
 * produces, so the form attaches it to the right input either way — and
 * keeps the service from handing the database a row its CHECK constraints
 * would reject with an opaque 500.
 */
function assertMergedRuleValid(merged: CreateScheduleRuleDto): CreateScheduleRuleDto {
  const result = createScheduleRuleSchema.safeParse(merged);
  if (!result.success) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: result.error.issues,
    });
  }
  return merged;
}
