import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { uuidv7, uzSearchKey } from '@educrm/shared';
import { TENANT_PRISMA, type TenantPrismaClient } from '../database/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { diffOf, snapshotOf } from '../audit/audit-diff';
import { CrudDeps } from '../common/crud/crud.deps';
import type { Tx } from '../common/crud/archivable-crud.service';
import { Enveloped } from '../common/http/response-envelope';
import { notFound, unknownReference } from '../common/crud/crud.errors';
import { settleFailedUpdate } from '../common/crud/optimistic-lock';
import { recomputeStudentStatus } from './student-status.util';
import type {
  CancelEnrollmentDto,
  ChangeStudyUnitStatusDto,
  CreateEnrollmentDto,
  CreateStudyUnitDto,
  FinishEnrollmentDto,
  StudyUnitListQueryDto,
  TransferEnrollmentDto,
  UpdateStudyUnitDto,
} from './dto/study-unit.dto';

const STUDY_UNIT_INCLUDE = {
  enrollments: { include: { student: { include: { client: true } } } },
} satisfies Prisma.StudyUnitInclude;

type StudyUnitRecord = Prisma.StudyUnitGetPayload<{ include: typeof STUDY_UNIT_INCLUDE }>;
type EnrollmentRecord = StudyUnitRecord['enrollments'][number];

/** Enrollment statuses that occupy a seat towards capacity/min_size (BR-U3/BR-U4). */
const OCCUPYING_STATUSES = new Set(['active', 'frozen']);

export interface EnrollmentView {
  id: string;
  studentId: string;
  studentName: string;
  studyUnitId: string;
  startDate: string;
  endDate: string | null;
  status: string;
  version: number;
  createdAt: Date;
}

export interface StudyUnitView {
  id: string;
  branchId: string;
  disciplineId: string;
  levelId: string | null;
  ageCategoryId: string | null;
  type: string;
  status: string;
  name: string;
  capacity: number;
  minSize: number;
  responsibleId: string | null;
  color: string | null;
  startDate: string | null;
  endDate: string | null;
  version: number;
  createdAt: Date;
  enrolledCount: number;
  /** BR-U3: capacity exceeded is a warning, never a block. */
  overCapacity: boolean;
  /** BR-U4: below min_size is a warning (profitability risk), never a block. */
  belowMinSize: boolean;
  enrollments: EnrollmentView[];
}

function toDateStr(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

/**
 * Prisma Client's `DateTime` scalar (what `@db.Date` still maps to at the
 * client level) rejects a bare `"YYYY-MM-DD"` string — it wants a `Date` or
 * a full ISO-8601 datetime. Every write below goes through this rather than
 * passing a DTO's date string straight to `tx.*.create`/`update`.
 */
function toDate(value: string): Date;
function toDate(value: string | null | undefined): Date | null | undefined;
function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return new Date(`${value}T00:00:00.000Z`);
}

function toEnrollmentView(row: EnrollmentRecord): EnrollmentView {
  return {
    id: row.id,
    studentId: row.studentId,
    studentName: row.student.client.fullName,
    studyUnitId: row.studyUnitId,
    startDate: toDateStr(row.startDate) as string,
    endDate: toDateStr(row.endDate),
    status: row.status,
    version: row.version,
    createdAt: row.createdAt,
  };
}

function toView(record: StudyUnitRecord): StudyUnitView {
  const enrolledCount = record.enrollments.filter((e) => OCCUPYING_STATUSES.has(e.status)).length;
  return {
    id: record.id,
    branchId: record.branchId,
    disciplineId: record.disciplineId,
    levelId: record.levelId,
    ageCategoryId: record.ageCategoryId,
    type: record.type,
    status: record.status,
    name: record.name,
    capacity: record.capacity,
    minSize: record.minSize,
    responsibleId: record.responsibleId,
    color: record.color,
    startDate: toDateStr(record.startDate),
    endDate: toDateStr(record.endDate),
    version: record.version,
    createdAt: record.createdAt,
    enrolledCount,
    overCapacity: enrolledCount > record.capacity,
    belowMinSize: enrolledCount < record.minSize,
    enrollments: record.enrollments.map(toEnrollmentView),
  };
}

function auditable(record: StudyUnitRecord): Record<string, unknown> {
  return {
    branchId: record.branchId,
    disciplineId: record.disciplineId,
    levelId: record.levelId,
    ageCategoryId: record.ageCategoryId,
    type: record.type,
    status: record.status,
    name: record.name,
    capacity: record.capacity,
    minSize: record.minSize,
    responsibleId: record.responsibleId,
    startDate: record.startDate,
    endDate: record.endDate,
  };
}

/**
 * BR-U2 relaxed for R0 (docs/QUESTIONS.md): schedule_rules don't exist yet
 * (T08), so forming->active is allowed unconditionally rather than blocked
 * on a check that has nothing to check against. The rest of the graph is
 * this task's own judgment call, also recorded in docs/QUESTIONS.md:
 * forming->active, active<->paused, active/paused->finished, and any
 * non-terminal status -> cancelled. finished/cancelled are terminal.
 */
const ALLOWED_STUDY_UNIT_TRANSITIONS: Record<string, readonly string[]> = {
  forming: ['active', 'cancelled'],
  active: ['paused', 'finished', 'cancelled'],
  paused: ['active', 'finished', 'cancelled'],
  finished: [],
  cancelled: [],
};

export function invalidStatusTransition(from: string, to: string): ConflictException {
  return new ConflictException({
    code: 'INVALID_STATUS_TRANSITION',
    message: `study_unit cannot move from ${from} to ${to}`,
    details: [{ field: 'status', code: 'INVALID_TRANSITION', from, to }],
  });
}

const ENROLLMENT_OVERLAP_MARKERS = ['enrollments_no_overlap', 'exclusion', 'conflicting key value'];

export function enrollmentOverlap(studentId: string, studyUnitId: string): ConflictException {
  return new ConflictException({
    code: 'ENROLLMENT_OVERLAP',
    message: 'BR-E1: this student already has an overlapping enrollment in this study unit',
    details: [{ field: 'startDate', code: 'OVERLAP', student_id: studentId, study_unit_id: studyUnitId }],
  });
}

/** Maps the Postgres EXCLUDE constraint violation (BR-E1) onto a proper app error. */
function rethrowAsOverlap(error: unknown, studentId: string, studyUnitId: string): never {
  const message = error instanceof Error ? error.message : String(error);
  if (ENROLLMENT_OVERLAP_MARKERS.some((marker) => message.includes(marker))) {
    throw enrollmentOverlap(studentId, studyUnitId);
  }
  throw error;
}

/**
 * TZ M4.1/M4.2. Not built on `ArchivableCrudService`: a study unit has a
 * five-state status machine rather than a plain `isActive` flag, and
 * members (enrollments) are a nested collection with their own BR-E1/BR-E2
 * transaction shapes — the same divergence `StudentsService` already has.
 */
@Injectable()
export class StudyUnitsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly tenantDb: TenantPrismaClient,
    private readonly deps: CrudDeps,
    private readonly audit: AuditService,
  ) {}

  async list(query: StudyUnitListQueryDto): Promise<Enveloped<StudyUnitView[]>> {
    const needle = query.q === undefined ? '' : uzSearchKey(query.q);

    const where: Prisma.StudyUnitWhereInput = {
      ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
      ...(query.discipline_id === undefined ? {} : { disciplineId: query.discipline_id }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(needle === '' ? {} : { nameKey: { contains: needle } }),
    };

    const [rows, total] = await Promise.all([
      this.tenantDb.studyUnit.findMany({
        where,
        include: STUDY_UNIT_INCLUDE,
        orderBy: [{ nameKey: 'asc' }],
      }),
      this.tenantDb.studyUnit.count({ where }),
    ]);

    let views = rows.map(toView);
    // `below_min_size` depends on the computed enrolled count, which Prisma
    // cannot filter on in SQL — filtered in JS, after the list is already
    // small (a tenant's groups, not its lessons).
    const belowMinSizeOnly = query.below_min_size === 'true';
    if (belowMinSizeOnly) {
      views = views.filter((view) => view.belowMinSize);
    }
    const page = views.slice(query.offset, query.offset + query.limit);

    return new Enveloped(page, {
      total: belowMinSizeOnly ? views.length : total,
      limit: query.limit,
      offset: query.offset,
    });
  }

  async get(id: string): Promise<StudyUnitView> {
    const record = await this.tenantDb.studyUnit.findUnique({ where: { id }, include: STUDY_UNIT_INCLUDE });
    if (record === null) {
      throw notFound('study_unit', id);
    }
    return toView(record);
  }

  async create(dto: CreateStudyUnitDto): Promise<StudyUnitView> {
    const record = await this.tenantDb.transaction(async (tx) => {
      const branch = await tx.branch.findUnique({ where: { id: dto.branchId } });
      if (branch === null) {
        throw unknownReference('branchId', dto.branchId);
      }
      const discipline = await tx.discipline.findUnique({ where: { id: dto.disciplineId } });
      if (discipline === null) {
        throw unknownReference('disciplineId', dto.disciplineId);
      }
      let levelName: string | null = null;
      if (dto.levelId !== undefined && dto.levelId !== null) {
        const level = await tx.level.findUnique({ where: { id: dto.levelId } });
        if (level === null) {
          throw unknownReference('levelId', dto.levelId);
        }
        levelName = level.name;
      }
      if (dto.ageCategoryId !== undefined && dto.ageCategoryId !== null) {
        const ageCategory = await tx.ageCategory.findUnique({ where: { id: dto.ageCategoryId } });
        if (ageCategory === null) {
          throw unknownReference('ageCategoryId', dto.ageCategoryId);
        }
      }
      if (dto.responsibleId !== undefined && dto.responsibleId !== null) {
        const responsible = await tx.user.findUnique({ where: { id: dto.responsibleId } });
        if (responsible === null) {
          throw unknownReference('responsibleId', dto.responsibleId);
        }
      }

      const name =
        dto.name === undefined || dto.name === null || dto.name.trim() === ''
          ? autoStudyUnitName(discipline.name, levelName)
          : dto.name.trim();

      const studyUnit = await tx.studyUnit.create({
        data: {
          id: uuidv7(),
          tenantId: this.deps.tenantId,
          branchId: dto.branchId,
          disciplineId: dto.disciplineId,
          levelId: dto.levelId ?? null,
          ageCategoryId: dto.ageCategoryId ?? null,
          type: dto.type,
          name,
          capacity: dto.capacity,
          minSize: dto.minSize,
          responsibleId: dto.responsibleId ?? null,
          color: dto.color ?? null,
          startDate: toDate(dto.startDate ?? null),
          endDate: toDate(dto.endDate ?? null),
        },
      });

      const created = await this.loadTxOrThrow(tx, studyUnit.id);
      await this.audit.record(
        {
          action: 'study_unit.create',
          entityType: 'study_unit',
          entityId: studyUnit.id,
          diff: snapshotOf(auditable(created)),
        },
        tx,
      );
      return created;
    });

    return toView(record);
  }

  async update(id: string, expectedVersion: number | undefined, dto: UpdateStudyUnitDto): Promise<StudyUnitView> {
    const record = await this.tenantDb.transaction(async (tx) => {
      const before = await this.loadTxOrThrow(tx, id);

      if (dto.levelId !== undefined && dto.levelId !== null) {
        const level = await tx.level.findUnique({ where: { id: dto.levelId } });
        if (level === null) {
          throw unknownReference('levelId', dto.levelId);
        }
      }
      if (dto.ageCategoryId !== undefined && dto.ageCategoryId !== null) {
        const ageCategory = await tx.ageCategory.findUnique({ where: { id: dto.ageCategoryId } });
        if (ageCategory === null) {
          throw unknownReference('ageCategoryId', dto.ageCategoryId);
        }
      }
      if (dto.responsibleId !== undefined && dto.responsibleId !== null) {
        const responsible = await tx.user.findUnique({ where: { id: dto.responsibleId } });
        if (responsible === null) {
          throw unknownReference('responsibleId', dto.responsibleId);
        }
      }

      const version = expectedVersion ?? before.version;
      const { count } = await tx.studyUnit.updateMany({
        where: { id, version },
        data: {
          ...(dto.levelId === undefined ? {} : { levelId: dto.levelId }),
          ...(dto.ageCategoryId === undefined ? {} : { ageCategoryId: dto.ageCategoryId }),
          ...(dto.name === undefined ? {} : { name: dto.name }),
          ...(dto.capacity === undefined ? {} : { capacity: dto.capacity }),
          ...(dto.minSize === undefined ? {} : { minSize: dto.minSize }),
          ...(dto.responsibleId === undefined ? {} : { responsibleId: dto.responsibleId }),
          ...(dto.color === undefined ? {} : { color: dto.color }),
          ...(dto.startDate === undefined ? {} : { startDate: toDate(dto.startDate) }),
          ...(dto.endDate === undefined ? {} : { endDate: toDate(dto.endDate) }),
          version: { increment: 1 },
        },
      });
      if (count === 0) {
        settleFailedUpdate('study_unit', id, version, await this.loadTx(tx, id), notFound);
      }

      const after = await this.loadTxOrThrow(tx, id);
      await this.audit.record(
        {
          action: 'study_unit.update',
          entityType: 'study_unit',
          entityId: id,
          diff: diffOf(auditable(before), auditable(after)),
        },
        tx,
      );
      return after;
    });

    return toView(record);
  }

  async changeStatus(
    id: string,
    expectedVersion: number | undefined,
    dto: ChangeStudyUnitStatusDto,
  ): Promise<StudyUnitView> {
    const record = await this.tenantDb.transaction(async (tx) => {
      const before = await this.loadTxOrThrow(tx, id);
      if (before.status === dto.status) {
        return before;
      }
      const allowed = ALLOWED_STUDY_UNIT_TRANSITIONS[before.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw invalidStatusTransition(before.status, dto.status);
      }

      const version = expectedVersion ?? before.version;
      const { count } = await tx.studyUnit.updateMany({
        where: { id, version },
        data: { status: dto.status, version: { increment: 1 } },
      });
      if (count === 0) {
        settleFailedUpdate('study_unit', id, version, await this.loadTx(tx, id), notFound);
      }

      const after = await this.loadTxOrThrow(tx, id);
      await this.audit.record(
        {
          action: 'study_unit.change_status',
          entityType: 'study_unit',
          entityId: id,
          diff: diffOf({ status: before.status }, { status: after.status }),
        },
        tx,
      );
      return after;
    });

    return toView(record);
  }

  /** Add a member (TZ M4.2). BR-E1 overlap is mapped from the DB constraint. */
  async addEnrollment(studyUnitId: string, dto: CreateEnrollmentDto): Promise<EnrollmentView> {
    try {
      return await this.tenantDb.transaction(async (tx) => {
        const studyUnit = await tx.studyUnit.findUnique({ where: { id: studyUnitId } });
        if (studyUnit === null) {
          throw notFound('study_unit', studyUnitId);
        }
        const student = await tx.student.findUnique({ where: { id: dto.studentId } });
        if (student === null) {
          throw unknownReference('studentId', dto.studentId);
        }

        const enrollment = await tx.enrollment.create({
          data: {
            id: uuidv7(),
            tenantId: this.deps.tenantId,
            studentId: dto.studentId,
            studyUnitId,
            startDate: toDate(dto.startDate),
            endDate: toDate(dto.endDate ?? null),
            status: 'active',
          },
        });

        await recomputeStudentStatus(tx, dto.studentId);

        const loaded = await this.loadEnrollmentTxOrThrow(tx, enrollment.id);
        await this.audit.record(
          {
            action: 'enrollment.create',
            entityType: 'study_unit',
            entityId: studyUnitId,
            diff: snapshotOf({ enrollmentId: enrollment.id, studentId: dto.studentId }),
          },
          tx,
        );
        return toEnrollmentView(loaded);
      });
    } catch (error) {
      rethrowAsOverlap(error, dto.studentId, studyUnitId);
    }
  }

  /** BR-E2: closes the old enrollment and opens a new one atomically. */
  async transferEnrollment(
    studyUnitId: string,
    enrollmentId: string,
    expectedVersion: number | undefined,
    dto: TransferEnrollmentDto,
  ): Promise<EnrollmentView> {
    let studentIdForError = 'unknown';
    try {
      return await this.tenantDb.transaction(async (tx) => {
        const before = await this.findEnrollmentOrThrow(tx, studyUnitId, enrollmentId);
        studentIdForError = before.studentId;
        if (before.status !== 'active' && before.status !== 'frozen') {
          throw invalidEnrollmentTransition(before.status, 'transferred');
        }
        const destination = await tx.studyUnit.findUnique({ where: { id: dto.toStudyUnitId } });
        if (destination === null) {
          throw unknownReference('toStudyUnitId', dto.toStudyUnitId);
        }

        const version = expectedVersion ?? before.version;
        const { count } = await tx.enrollment.updateMany({
          where: { id: enrollmentId, version },
          data: { status: 'transferred', endDate: toDate(dto.transferDate), version: { increment: 1 } },
        });
        if (count === 0) {
          settleFailedUpdate(
            'enrollment',
            enrollmentId,
            version,
            await tx.enrollment.findUnique({ where: { id: enrollmentId } }),
            notFound,
          );
        }

        const created = await tx.enrollment.create({
          data: {
            id: uuidv7(),
            tenantId: this.deps.tenantId,
            studentId: before.studentId,
            studyUnitId: dto.toStudyUnitId,
            startDate: toDate(dto.transferDate),
            status: 'active',
          },
        });

        await recomputeStudentStatus(tx, before.studentId);

        const loaded = await this.loadEnrollmentTxOrThrow(tx, created.id);
        await this.audit.record(
          {
            action: 'enrollment.transfer',
            entityType: 'study_unit',
            entityId: studyUnitId,
            diff: snapshotOf({
              enrollmentId,
              fromStudyUnitId: studyUnitId,
              toStudyUnitId: dto.toStudyUnitId,
              studentId: before.studentId,
              transferDate: dto.transferDate,
            }),
          },
          tx,
        );
        return toEnrollmentView(loaded);
      });
    } catch (error) {
      rethrowAsOverlap(error, studentIdForError, dto.toStudyUnitId);
    }
  }

  /** BR-E3: the "remove member" action — cancel, never hard-delete. */
  async cancelEnrollment(
    studyUnitId: string,
    enrollmentId: string,
    expectedVersion: number | undefined,
    dto: CancelEnrollmentDto,
  ): Promise<EnrollmentView> {
    return this.setEnrollmentStatus(studyUnitId, enrollmentId, expectedVersion, 'cancelled', dto.endDate, {
      reason: dto.reason,
    });
  }

  /** The "end" action — a natural finish. */
  async finishEnrollment(
    studyUnitId: string,
    enrollmentId: string,
    expectedVersion: number | undefined,
    dto: FinishEnrollmentDto,
  ): Promise<EnrollmentView> {
    return this.setEnrollmentStatus(studyUnitId, enrollmentId, expectedVersion, 'finished', dto.endDate);
  }

  /** `enrollment.freeze` permission guards both directions in the controller. */
  async freezeEnrollment(
    studyUnitId: string,
    enrollmentId: string,
    expectedVersion: number | undefined,
  ): Promise<EnrollmentView> {
    return this.setEnrollmentStatus(studyUnitId, enrollmentId, expectedVersion, 'frozen');
  }

  async unfreezeEnrollment(
    studyUnitId: string,
    enrollmentId: string,
    expectedVersion: number | undefined,
  ): Promise<EnrollmentView> {
    return this.setEnrollmentStatus(studyUnitId, enrollmentId, expectedVersion, 'active');
  }

  private async setEnrollmentStatus(
    studyUnitId: string,
    enrollmentId: string,
    expectedVersion: number | undefined,
    status: 'finished' | 'cancelled' | 'frozen' | 'active',
    endDate?: string,
    auditExtra?: Record<string, unknown>,
  ): Promise<EnrollmentView> {
    return this.tenantDb.transaction(async (tx) => {
      const before = await this.findEnrollmentOrThrow(tx, studyUnitId, enrollmentId);
      assertEnrollmentTransition(before.status, status);

      const version = expectedVersion ?? before.version;
      const { count } = await tx.enrollment.updateMany({
        where: { id: enrollmentId, version },
        data: {
          status,
          // Cancelling/finishing closes the range so BR-E1's EXCLUDE
          // constraint doesn't keep blocking a future re-enrollment
          // indefinitely (docs/QUESTIONS.md).
          ...(status === 'cancelled' || status === 'finished'
            ? { endDate: toDate(endDate) ?? new Date() }
            : {}),
          version: { increment: 1 },
        },
      });
      if (count === 0) {
        settleFailedUpdate(
          'enrollment',
          enrollmentId,
          version,
          await tx.enrollment.findUnique({ where: { id: enrollmentId } }),
          notFound,
        );
      }

      await recomputeStudentStatus(tx, before.studentId);

      const loaded = await this.loadEnrollmentTxOrThrow(tx, enrollmentId);
      await this.audit.record(
        {
          action: `enrollment.${status === 'active' ? 'unfreeze' : status === 'frozen' ? 'freeze' : status}`,
          entityType: 'study_unit',
          entityId: studyUnitId,
          diff: diffOf({ status: before.status }, { status, ...auditExtra }),
        },
        tx,
      );
      return toEnrollmentView(loaded);
    });
  }

  private async findEnrollmentOrThrow(
    tx: Tx,
    studyUnitId: string,
    enrollmentId: string,
  ): Promise<{ id: string; studentId: string; status: string; version: number }> {
    const row = await tx.enrollment.findFirst({ where: { id: enrollmentId, studyUnitId } });
    if (row === null) {
      throw notFound('enrollment', enrollmentId);
    }
    return row;
  }

  private loadTx(tx: Tx, id: string): Promise<StudyUnitRecord | null> {
    return tx.studyUnit.findUnique({ where: { id }, include: STUDY_UNIT_INCLUDE });
  }

  private async loadTxOrThrow(tx: Tx, id: string): Promise<StudyUnitRecord> {
    const record = await this.loadTx(tx, id);
    if (record === null) {
      throw notFound('study_unit', id);
    }
    return record;
  }

  private async loadEnrollmentTxOrThrow(tx: Tx, id: string): Promise<EnrollmentRecord> {
    const row = await tx.enrollment.findUnique({
      where: { id },
      include: { student: { include: { client: true } } },
    });
    if (row === null) {
      throw notFound('enrollment', id);
    }
    return row;
  }
}

/**
 * The enrollment status machine (this task's own call, docs/QUESTIONS.md):
 * active <-> frozen; active/frozen -> finished/cancelled; `transferred` is
 * only ever set by the transfer flow above, never by a direct status call;
 * finished/cancelled/transferred are terminal.
 */
const ALLOWED_ENROLLMENT_TRANSITIONS: Record<string, readonly string[]> = {
  active: ['frozen', 'finished', 'cancelled'],
  frozen: ['active', 'finished', 'cancelled'],
  finished: [],
  cancelled: [],
  transferred: [],
};

export function invalidEnrollmentTransition(from: string, to: string): ConflictException {
  return new ConflictException({
    code: 'INVALID_STATUS_TRANSITION',
    message: `enrollment cannot move from ${from} to ${to}`,
    details: [{ field: 'status', code: 'INVALID_TRANSITION', from, to }],
  });
}

function assertEnrollmentTransition(from: string, to: string): void {
  if (from === to) {
    return;
  }
  const allowed = ALLOWED_ENROLLMENT_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw invalidEnrollmentTransition(from, to);
  }
}

/**
 * This task's own call (docs/QUESTIONS.md): "<Discipline> <Level>", e.g.
 * "Ingliz tili B1" / "Ingliz tili" when there is no level — matching the
 * "B1 Backend" / "Ingliz A2" style in docs/design/05-groups.png.
 */
export function autoStudyUnitName(disciplineName: string, levelName: string | null): string {
  return levelName === null ? disciplineName : `${disciplineName} ${levelName}`;
}
