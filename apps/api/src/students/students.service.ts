import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Money, uuidv7, uzSearchKey } from '@educrm/shared';
import { TENANT_PRISMA, type TenantPrismaClient } from '../database/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { diffOf, snapshotOf } from '../audit/audit-diff';
import { normalizePhone } from '../auth/phone.util';
import { CrudDeps } from '../common/crud/crud.deps';
import type { Tx } from '../common/crud/archivable-crud.service';
import { Enveloped } from '../common/http/response-envelope';
import type { ListQueryDto } from '../common/crud/list-query.dto';
import { notFound, unknownReference } from '../common/crud/crud.errors';
import { settleFailedUpdate } from '../common/crud/optimistic-lock';
import type {
  CreateContactPersonDto,
  CreateStudentDto,
  SetPhonesDto,
  StudentListQueryDto,
  UpdateContactPersonDto,
  UpdateStudentDto,
} from './dto/student.dto';

const STUDENT_INCLUDE = {
  client: { include: { phones: true } },
  contactPersons: true,
} satisfies Prisma.StudentInclude;

type StudentRecord = Prisma.StudentGetPayload<{ include: typeof STUDENT_INCLUDE }>;

export interface ContactPersonView {
  id: string;
  fullName: string;
  relation: string;
  phone: string | null;
  email: string | null;
  isBillRecipient: boolean;
  receivesNotifications: boolean;
  version: number;
}

export interface PhoneView {
  id: string;
  phone: string;
  isPrimary: boolean;
}

/**
 * A student as the API returns it. `phones` and `contactPersons` are
 * omitted entirely (not sent as `null`/`[]`) for a caller without
 * `student.view_contacts` — TZ M11.2 "kontakt maydonlari *.view_contacts
 * siz yashiriladi" — so a response shape difference is the only signal,
 * never a field a client could read anyway by trusting its own UI.
 */
export interface StudentView {
  id: string;
  clientId: string;
  branchId: string;
  fullName: string;
  birthDate: string | null;
  gender: 'male' | 'female' | null;
  status: string;
  isActive: boolean;
  ownerId: string | null;
  /** TZ 6.1 money-on-the-wire: tiyin as a string. Not yet computed by
   * anything (T10/T11 own that) — carried at its default of 0 until then. */
  cachedBalance: string;
  churnScore: number | null;
  blacklisted: boolean;
  blacklistReason: string | null;
  version: number;
  createdAt: Date;
  phones?: PhoneView[];
  contactPersons?: ContactPersonView[];
}

function toContactPersonView(row: StudentRecord['contactPersons'][number]): ContactPersonView {
  return {
    id: row.id,
    fullName: row.fullName,
    relation: row.relation,
    phone: row.phoneE164,
    email: row.email,
    isBillRecipient: row.isBillRecipient,
    receivesNotifications: row.receivesNotifications,
    version: row.version,
  };
}

function toView(record: StudentRecord, canViewContacts: boolean): StudentView {
  return {
    id: record.id,
    clientId: record.clientId,
    branchId: record.branchId,
    fullName: record.client.fullName,
    birthDate: record.client.birthDate === null ? null : record.client.birthDate.toISOString(),
    gender: record.client.gender,
    status: record.status,
    isActive: record.status !== 'archived',
    ownerId: record.ownerId,
    cachedBalance: Money.fromTiyin(record.cachedBalance).toJSON(),
    churnScore: record.churnScore,
    blacklisted: record.blacklisted,
    blacklistReason: record.blacklistReason,
    version: record.version,
    createdAt: record.createdAt,
    ...(canViewContacts
      ? {
          phones: record.client.phones.map((p) => ({ id: p.id, phone: p.phoneE164, isPrimary: p.isPrimary })),
          contactPersons: record.contactPersons.map(toContactPersonView),
        }
      : {}),
  };
}

/** What the audit diff is allowed to see — contact fields included, since
 * audit.view is a separate, narrower-granted permission than the request
 * that produced the change. */
function auditable(record: StudentRecord): Record<string, unknown> {
  return {
    fullName: record.client.fullName,
    birthDate: record.client.birthDate,
    gender: record.client.gender,
    branchId: record.branchId,
    status: record.status,
    ownerId: record.ownerId,
    blacklisted: record.blacklisted,
    blacklistReason: record.blacklistReason,
    phones: record.client.phones.map((p) => p.phoneE164).sort(),
  };
}

export function duplicatePhone(
  phone: string,
  existing: { clientId: string; studentId: string | null; fullName: string },
): ConflictException {
  return new ConflictException({
    code: 'DUPLICATE_PHONE',
    message: `A client with this phone already exists: ${existing.fullName}`,
    details: [
      {
        field: 'phone',
        code: 'DUPLICATE',
        value: phone,
        client_id: existing.clientId,
        student_id: existing.studentId,
      },
    ],
  });
}

function invalidPhone(field: string, value: string): ConflictException {
  throw new ConflictException({
    code: 'INVALID_PHONE',
    message: 'phone is not a valid Uzbek number',
    details: [{ field, code: 'INVALID', value }],
  });
}

/**
 * TZ M3. Deliberately not built on ArchivableCrudService: a student's
 * "active" state is a computed enum (BR-S3), the record is split across
 * `clients` + `students`, and create/update both touch the `ClientPhone`
 * side-table — all three are the same shape of special case
 * `EmployeesService` already carries, so this follows that pattern.
 */
@Injectable()
export class StudentsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly tenantDb: TenantPrismaClient,
    private readonly deps: CrudDeps,
    private readonly audit: AuditService,
  ) {}

  async list(query: StudentListQueryDto, canViewContacts: boolean): Promise<Enveloped<StudentView[]>> {
    const statusWhere = statusFilter(query.is_active, query.status);
    const needle = query.q === undefined ? '' : uzSearchKey(query.q);
    const digits = query.q === undefined ? '' : query.q.replace(/[^\d+]/g, '');

    const where: Prisma.StudentWhereInput = {
      ...statusWhere,
      ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
      ...(needle === ''
        ? {}
        : {
            OR: [
              { client: { fullNameKey: { contains: needle } } },
              ...(digits.length >= 3
                ? [{ client: { phones: { some: { phoneE164: { contains: digits } } } } }]
                : []),
            ],
          }),
    };

    const [rows, total] = await Promise.all([
      this.tenantDb.student.findMany({
        where,
        include: STUDENT_INCLUDE,
        orderBy: [{ client: { fullNameKey: 'asc' } }],
        take: query.limit,
        skip: query.offset,
      }),
      this.tenantDb.student.count({ where }),
    ]);

    return new Enveloped(rows.map((row) => toView(row, canViewContacts)), {
      total,
      limit: query.limit,
      offset: query.offset,
    });
  }

  async get(id: string, canViewContacts: boolean): Promise<StudentView> {
    const record = await this.tenantDb.student.findUnique({ where: { id }, include: STUDENT_INCLUDE });
    if (record === null) {
      throw notFound('student', id);
    }
    return toView(record, canViewContacts);
  }

  /** TZ M3.2 SHART: normalized-phone duplicate check, not blurred into the
   * create transaction — the drawer calls this on blur (UX P6). */
  async checkPhone(phone: string): Promise<{ clientId: string; studentId: string | null; fullName: string } | null> {
    const normalized = normalizePhone(phone);
    if (normalized === null) {
      return null;
    }
    const existing = await this.tenantDb.clientPhone.findFirst({
      where: { phoneE164: normalized },
      include: { client: { include: { student: true } } },
    });
    if (existing === null) {
      return null;
    }
    return {
      clientId: existing.clientId,
      studentId: existing.client.student?.id ?? null,
      fullName: existing.client.fullName,
    };
  }

  /**
   * Creates the client, its phone and the student in one transaction — a
   * student without a client is meaningless and a client with no phone is a
   * dead end for every contact flow built on top of it.
   */
  async create(dto: CreateStudentDto, canViewContacts: boolean): Promise<StudentView> {
    const normalized = normalizePhone(dto.phone);
    if (normalized === null) {
      throw invalidPhone('phone', dto.phone);
    }

    if (dto.force !== true) {
      const duplicate = await this.checkPhone(normalized);
      if (duplicate !== null) {
        throw duplicatePhone(normalized, duplicate);
      }
    }

    const record = await this.tenantDb.transaction(async (tx) => {
      const branch = await tx.branch.findUnique({ where: { id: dto.branchId } });
      if (branch === null) {
        throw unknownReference('branchId', dto.branchId);
      }

      const clientId = uuidv7();
      await tx.client.create({
        data: {
          id: clientId,
          tenantId: this.deps.tenantId,
          fullName: dto.fullName,
          birthDate: dto.birthDate ?? null,
          gender: dto.gender ?? null,
        },
      });
      await tx.clientPhone.create({
        data: {
          id: uuidv7(),
          tenantId: this.deps.tenantId,
          clientId,
          phoneE164: normalized,
          isPrimary: true,
        },
      });

      const student = await tx.student.create({
        data: {
          id: uuidv7(),
          tenantId: this.deps.tenantId,
          clientId,
          branchId: dto.branchId,
        },
      });

      const created = await this.loadTxOrThrow(tx, student.id);
      await this.audit.record(
        {
          action: 'student.create',
          entityType: 'student',
          entityId: student.id,
          diff: snapshotOf(auditable(created)),
        },
        tx,
      );
      return created;
    });

    return toView(record, canViewContacts);
  }

  async update(
    id: string,
    expectedVersion: number | undefined,
    dto: UpdateStudentDto,
    canViewContacts: boolean,
  ): Promise<StudentView> {
    const record = await this.tenantDb.transaction(async (tx) => {
      const before = await this.loadTxOrThrow(tx, id);

      if (dto.branchId !== undefined) {
        const branch = await tx.branch.findUnique({ where: { id: dto.branchId } });
        if (branch === null) {
          throw unknownReference('branchId', dto.branchId);
        }
      }
      if (dto.ownerId !== undefined && dto.ownerId !== null) {
        const owner = await tx.user.findUnique({ where: { id: dto.ownerId } });
        if (owner === null) {
          throw unknownReference('ownerId', dto.ownerId);
        }
      }

      const version = expectedVersion ?? before.version;
      const { count } = await tx.student.updateMany({
        where: { id, version },
        data: {
          ...(dto.branchId === undefined ? {} : { branchId: dto.branchId }),
          ...(dto.ownerId === undefined ? {} : { ownerId: dto.ownerId }),
          ...(dto.blacklisted === undefined ? {} : { blacklisted: dto.blacklisted }),
          ...('blacklistReason' in dto ? { blacklistReason: dto.blacklistReason ?? null } : {}),
          version: { increment: 1 },
        },
      });
      if (count === 0) {
        settleFailedUpdate('student', id, version, await this.loadTx(tx, id), notFound);
      }

      if (dto.fullName !== undefined || 'birthDate' in dto || 'gender' in dto) {
        await tx.client.update({
          where: { id: before.clientId },
          data: {
            ...(dto.fullName === undefined ? {} : { fullName: dto.fullName }),
            ...('birthDate' in dto ? { birthDate: dto.birthDate ?? null } : {}),
            ...('gender' in dto ? { gender: dto.gender ?? null } : {}),
            version: { increment: 1 },
          },
        });
      }

      const after = await this.loadTxOrThrow(tx, id);
      await this.audit.record(
        {
          action: 'student.update',
          entityType: 'student',
          entityId: id,
          diff: diffOf(auditable(before), auditable(after)),
        },
        tx,
      );
      return after;
    });

    return toView(record, canViewContacts);
  }

  /** TZ BR-S2: never deleted, only archived — manual, per BR-S3. */
  async archive(id: string, expectedVersion: number | undefined, canViewContacts: boolean): Promise<StudentView> {
    return this.setArchived(id, expectedVersion, true, canViewContacts);
  }

  /** Back to `no_enrollment`: BR-S3 would recompute `active`/`frozen`/
   * `finished` from enrollments once T07 exists, so restoring can't guess
   * which of those applied before archiving. */
  async restore(id: string, expectedVersion: number | undefined, canViewContacts: boolean): Promise<StudentView> {
    return this.setArchived(id, expectedVersion, false, canViewContacts);
  }

  private async setArchived(
    id: string,
    expectedVersion: number | undefined,
    archived: boolean,
    canViewContacts: boolean,
  ): Promise<StudentView> {
    const record = await this.tenantDb.transaction(async (tx) => {
      const before = await this.loadTxOrThrow(tx, id);
      const alreadyThere = archived ? before.status === 'archived' : before.status !== 'archived';
      if (alreadyThere) {
        return before;
      }

      const version = expectedVersion ?? before.version;
      const { count } = await tx.student.updateMany({
        where: { id, version },
        data: {
          status: archived ? 'archived' : 'no_enrollment',
          archivedAt: archived ? new Date() : null,
          version: { increment: 1 },
        },
      });
      if (count === 0) {
        settleFailedUpdate('student', id, version, await this.loadTx(tx, id), notFound);
      }

      const after = await this.loadTxOrThrow(tx, id);
      await this.audit.record(
        {
          action: archived ? 'student.archive' : 'student.restore',
          entityType: 'student',
          entityId: id,
          diff: diffOf(auditable(before), auditable(after)),
        },
        tx,
      );
      return after;
    });

    return toView(record, canViewContacts);
  }

  /** Full replacement of the client's phone set, with the same duplicate
   * check `create` runs — otherwise this endpoint is how two students end
   * up sharing a phone silently. */
  async setPhones(id: string, dto: SetPhonesDto, canViewContacts: boolean): Promise<StudentView> {
    const normalizedList = dto.phones.map((entry) => {
      const normalized = normalizePhone(entry.phone);
      if (normalized === null) {
        throw invalidPhone('phones', entry.phone);
      }
      return { phone: normalized, isPrimary: entry.isPrimary ?? false };
    });
    if (!normalizedList.some((entry) => entry.isPrimary)) {
      normalizedList[0]!.isPrimary = true;
    }

    const record = await this.tenantDb.transaction(async (tx) => {
      const before = await this.loadTxOrThrow(tx, id);

      for (const entry of normalizedList) {
        const existing = await tx.clientPhone.findFirst({
          where: { phoneE164: entry.phone, clientId: { not: before.clientId } },
          include: { client: { include: { student: true } } },
        });
        if (existing !== null) {
          throw duplicatePhone(entry.phone, {
            clientId: existing.clientId,
            studentId: existing.client.student?.id ?? null,
            fullName: existing.client.fullName,
          });
        }
      }

      await tx.clientPhone.deleteMany({ where: { clientId: before.clientId } });
      await tx.clientPhone.createMany({
        data: normalizedList.map((entry) => ({
          id: uuidv7(),
          tenantId: this.deps.tenantId,
          clientId: before.clientId,
          phoneE164: entry.phone,
          isPrimary: entry.isPrimary,
        })),
      });

      const after = await this.loadTxOrThrow(tx, id);
      await this.audit.record(
        {
          action: 'student.set_phones',
          entityType: 'student',
          entityId: id,
          diff: diffOf(auditable(before), auditable(after)),
        },
        tx,
      );
      return after;
    });

    return toView(record, canViewContacts);
  }

  async createContactPerson(studentId: string, dto: CreateContactPersonDto): Promise<ContactPersonView> {
    return this.tenantDb.transaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { id: studentId } });
      if (student === null) {
        throw notFound('student', studentId);
      }
      const row = await tx.contactPerson.create({
        data: {
          id: uuidv7(),
          tenantId: this.deps.tenantId,
          studentId,
          fullName: dto.fullName,
          relation: dto.relation,
          phoneE164: dto.phone === undefined || dto.phone === null ? null : (normalizePhone(dto.phone) ?? dto.phone),
          email: dto.email ?? null,
          isBillRecipient: dto.isBillRecipient ?? false,
          receivesNotifications: dto.receivesNotifications ?? true,
        },
      });
      await this.audit.record(
        {
          action: 'student.contact_person.create',
          entityType: 'student',
          entityId: studentId,
          diff: snapshotOf({ contactPersonId: row.id, fullName: row.fullName, relation: row.relation }),
        },
        tx,
      );
      return toContactPersonView(row);
    });
  }

  async updateContactPerson(
    studentId: string,
    contactId: string,
    expectedVersion: number | undefined,
    dto: UpdateContactPersonDto,
  ): Promise<ContactPersonView> {
    return this.tenantDb.transaction(async (tx) => {
      const before = await tx.contactPerson.findFirst({ where: { id: contactId, studentId } });
      if (before === null) {
        throw notFound('contact_person', contactId);
      }
      const version = expectedVersion ?? before.version;
      const { count } = await tx.contactPerson.updateMany({
        where: { id: contactId, version },
        data: {
          ...(dto.fullName === undefined ? {} : { fullName: dto.fullName }),
          ...(dto.relation === undefined ? {} : { relation: dto.relation }),
          ...(dto.phone === undefined
            ? {}
            : { phoneE164: dto.phone === null ? null : (normalizePhone(dto.phone) ?? dto.phone) }),
          ...('email' in dto ? { email: dto.email ?? null } : {}),
          ...(dto.isBillRecipient === undefined ? {} : { isBillRecipient: dto.isBillRecipient }),
          ...(dto.receivesNotifications === undefined
            ? {}
            : { receivesNotifications: dto.receivesNotifications }),
          version: { increment: 1 },
        },
      });
      if (count === 0) {
        settleFailedUpdate(
          'contact_person',
          contactId,
          version,
          await tx.contactPerson.findUnique({ where: { id: contactId } }),
          notFound,
        );
      }
      const after = await tx.contactPerson.findUniqueOrThrow({ where: { id: contactId } });
      await this.audit.record(
        {
          action: 'student.contact_person.update',
          entityType: 'student',
          entityId: studentId,
          diff: diffOf(
            { fullName: before.fullName, relation: before.relation, phoneE164: before.phoneE164 },
            { fullName: after.fullName, relation: after.relation, phoneE164: after.phoneE164 },
          ),
        },
        tx,
      );
      return toContactPersonView(after);
    });
  }

  async deleteContactPerson(studentId: string, contactId: string): Promise<void> {
    await this.tenantDb.transaction(async (tx) => {
      const existing = await tx.contactPerson.findFirst({ where: { id: contactId, studentId } });
      if (existing === null) {
        throw notFound('contact_person', contactId);
      }
      await tx.contactPerson.delete({ where: { id: contactId } });
      await this.audit.record(
        {
          action: 'student.contact_person.delete',
          entityType: 'student',
          entityId: studentId,
          diff: snapshotOf({ contactPersonId: contactId, fullName: existing.fullName }),
        },
        tx,
      );
    });
  }

  private loadTx(tx: Tx, id: string): Promise<StudentRecord | null> {
    return tx.student.findUnique({ where: { id }, include: STUDENT_INCLUDE });
  }

  private async loadTxOrThrow(tx: Tx, id: string): Promise<StudentRecord> {
    const record = await this.loadTx(tx, id);
    if (record === null) {
      throw notFound('student', id);
    }
    return record;
  }
}

/** `is_active` tri-state mapped onto the status enum, same contract every
 * other T05 list uses — plus an optional exact `status` filter on top. */
function statusFilter(
  isActive: ListQueryDto['is_active'],
  status: StudentListQueryDto['status'],
): Prisma.StudentWhereInput {
  if (status !== undefined) {
    return { status };
  }
  if (isActive === 'all') {
    return {};
  }
  return isActive === 'true' ? { status: { not: 'archived' } } : { status: 'archived' };
}
