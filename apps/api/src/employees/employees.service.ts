import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { TENANT_PRISMA, type TenantPrismaClient } from '../database/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { diffOf, snapshotOf } from '../audit/audit-diff';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUserService } from '../auth/request-user.service';
import { normalizePhone } from '../auth/phone.util';
import { CrudDeps } from '../common/crud/crud.deps';
import type { Tx } from '../common/crud/archivable-crud.service';
import { Enveloped } from '../common/http/response-envelope';
import { activeFilter, nameKeyFilter } from '../common/crud/list-query.dto';
import { duplicateName, notFound, unknownReference } from '../common/crud/crud.errors';
import { settleFailedUpdate } from '../common/crud/optimistic-lock';
import type {
  CreateEmployeeDto,
  EmployeeListQueryDto,
  SetBranchesDto,
  SetRolesDto,
  SetTeacherProfileDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';

/**
 * An employee as the API returns it. Built by hand rather than returning
 * the Prisma row: `users` carries `password_hash`, and a response shape
 * that happens to exclude it today is one `include` away from leaking it.
 */
export interface EmployeeView {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  version: number;
  createdAt: Date;
  roles: { code: string; name: string }[];
  branches: { id: string; name: string }[];
  teacherProfile: {
    id: string;
    notes: string | null;
    disciplineIds: string[];
    levelIds: string[];
  } | null;
}

const EMPLOYEE_INCLUDE = {
  userRoles: { include: { role: true } },
  userBranches: { include: { branch: true } },
  teacherProfile: { include: { disciplines: true, levels: true } },
} satisfies Prisma.UserInclude;

type EmployeeRecord = Prisma.UserGetPayload<{ include: typeof EMPLOYEE_INCLUDE }>;

function toView(record: EmployeeRecord): EmployeeView {
  return {
    id: record.id,
    fullName: record.fullName,
    phone: record.phone,
    email: record.email,
    isActive: record.isActive,
    version: record.version,
    createdAt: record.createdAt,
    roles: record.userRoles.map((userRole) => ({
      code: userRole.role.code,
      name: userRole.role.name,
    })),
    branches: record.userBranches.map((userBranch) => ({
      id: userBranch.branch.id,
      name: userBranch.branch.name,
    })),
    teacherProfile:
      record.teacherProfile === null
        ? null
        : {
            id: record.teacherProfile.id,
            notes: record.teacherProfile.notes,
            disciplineIds: record.teacherProfile.disciplines.map((row) => row.disciplineId),
            levelIds: record.teacherProfile.levels.map((row) => row.levelId),
          },
  };
}

/** What the audit diff is allowed to see: never the password hash. */
function auditable(record: EmployeeRecord): Record<string, unknown> {
  const view = toView(record);
  return {
    fullName: view.fullName,
    phone: view.phone,
    email: view.email,
    isActive: view.isActive,
    roles: view.roles.map((role) => role.code).sort(),
    branchIds: view.branches.map((branch) => branch.id).sort(),
  };
}

/**
 * TZ M1.4. Deliberately not built on ArchivableCrudService: an employee is
 * not a reference row. It has a login identifier, a password, role and
 * branch assignments with their own endpoints, a teacher profile, and a
 * deactivation that must also kill sessions — the shared policy would be
 * carrying one special case per method.
 */
@Injectable()
export class EmployeesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly tenantDb: TenantPrismaClient,
    private readonly deps: CrudDeps,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly permissions: PermissionsService,
    private readonly requestUser: RequestUserService,
  ) {}

  async list(query: EmployeeListQueryDto): Promise<Enveloped<EmployeeView[]>> {
    const where: Prisma.UserWhereInput = {
      ...activeFilter(query.is_active),
      ...nameKeyFilter(query.q, 'fullNameKey'),
      ...(query.branch_id === undefined
        ? {}
        : { userBranches: { some: { branchId: query.branch_id } } }),
      ...(query.role_code === undefined
        ? {}
        : { userRoles: { some: { role: { code: query.role_code } } } }),
    };

    const [rows, total] = await Promise.all([
      this.tenantDb.user.findMany({
        where,
        include: EMPLOYEE_INCLUDE,
        orderBy: [{ fullNameKey: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.tenantDb.user.count({ where }),
    ]);

    return new Enveloped(rows.map(toView), {
      total,
      limit: query.limit,
      offset: query.offset,
    });
  }

  async get(id: string): Promise<EmployeeView> {
    const record = await this.tenantDb.user.findUnique({
      where: { id },
      include: EMPLOYEE_INCLUDE,
    });
    if (record === null) {
      throw notFound('employee', id);
    }
    return toView(record);
  }

  /**
   * Creates the account, its roles and its branches in one transaction. A
   * user who exists without their roles is a user who can log in and see
   * nothing, which looks like a permissions bug for as long as it takes
   * someone to notice.
   */
  async create(dto: CreateEmployeeDto): Promise<EmployeeView> {
    const phone = dto.phone === undefined || dto.phone === null ? null : normalizePhone(dto.phone);
    if (dto.phone !== undefined && dto.phone !== null && phone === null) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'phone is not a valid Uzbek number',
        details: [{ field: 'phone', code: 'INVALID', value: dto.phone }],
      });
    }
    const email = dto.email ?? null;
    const passwordHash = await this.passwords.hash(dto.password);

    const record = await this.tenantDb.transaction(async (tx) => {
      await this.assertLoginFree(tx, phone, email, undefined);
      const roleIds = await this.resolveRoleIds(tx, dto.roleCodes ?? []);
      await this.assertBranchesExist(tx, dto.branchIds ?? []);

      const user = await tx.user.create({
        data: {
          id: uuidv7(),
          tenantId: this.deps.tenantId,
          fullName: dto.fullName,
          phone,
          email,
          passwordHash,
        },
      });
      await this.writeRoles(tx, user.id, roleIds);
      await this.writeBranches(tx, user.id, dto.branchIds ?? []);

      const created = await this.loadTxOrThrow(tx, user.id);
      await this.audit.record(
        {
          action: 'employee.create',
          entityType: 'employee',
          entityId: user.id,
          diff: snapshotOf(auditable(created)),
        },
        tx,
      );
      return created;
    });

    return toView(record);
  }

  async update(
    id: string,
    expectedVersion: number | undefined,
    dto: UpdateEmployeeDto,
  ): Promise<EmployeeView> {
    const phone =
      dto.phone === undefined || dto.phone === null ? dto.phone : normalizePhone(dto.phone);
    if (dto.phone !== undefined && dto.phone !== null && (phone === null || phone === undefined)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'phone is not a valid Uzbek number',
        details: [{ field: 'phone', code: 'INVALID', value: dto.phone }],
      });
    }

    const record = await this.tenantDb.transaction(async (tx) => {
      const before = await this.loadTxOrThrow(tx, id);
      await this.assertLoginFree(
        tx,
        phone === undefined ? null : phone,
        dto.email === undefined ? null : dto.email,
        id,
      );

      const version = expectedVersion ?? before.version;
      const { count } = await tx.user.updateMany({
        where: { id, version },
        data: {
          fullName: dto.fullName,
          ...('phone' in dto ? { phone: phone ?? null } : {}),
          ...('email' in dto ? { email: dto.email ?? null } : {}),
          version: { increment: 1 },
        },
      });
      if (count === 0) {
        settleFailedUpdate('employee', id, version, await this.loadTx(tx, id), notFound);
      }

      const after = await this.loadTxOrThrow(tx, id);
      await this.audit.record(
        {
          action: 'employee.update',
          entityType: 'employee',
          entityId: id,
          diff: diffOf(auditable(before), auditable(after)),
        },
        tx,
      );
      return after;
    });

    return toView(record);
  }

  /** Replaces the whole role set (TZ M1.4 "rol(lar)"). */
  async setRoles(id: string, dto: SetRolesDto): Promise<EmployeeView> {
    const record = await this.tenantDb.transaction(async (tx) => {
      const before = await this.loadTxOrThrow(tx, id);
      const roleIds = await this.resolveRoleIds(tx, dto.roleCodes);

      await tx.userRole.deleteMany({ where: { userId: id } });
      await this.writeRoles(tx, id, roleIds);

      const after = await this.loadTxOrThrow(tx, id);
      await this.audit.record(
        {
          action: 'employee.set_roles',
          entityType: 'employee',
          entityId: id,
          diff: diffOf(auditable(before), auditable(after)),
        },
        tx,
      );
      return after;
    });

    // The permission cache is keyed by (tenant, user) and lives for 60s;
    // without this a role change would take up to a minute to apply, which
    // is indistinguishable from "it didn't work".
    await this.permissions.invalidate(this.deps.tenantId, id);
    return toView(record);
  }

  /** Replaces the whole branch set (TZ M1.4 "filial(lar)"). */
  async setBranches(id: string, dto: SetBranchesDto): Promise<EmployeeView> {
    const record = await this.tenantDb.transaction(async (tx) => {
      const before = await this.loadTxOrThrow(tx, id);
      await this.assertBranchesExist(tx, dto.branchIds);

      await tx.userBranch.deleteMany({ where: { userId: id } });
      await this.writeBranches(tx, id, dto.branchIds);

      const after = await this.loadTxOrThrow(tx, id);
      await this.audit.record(
        {
          action: 'employee.set_branches',
          entityType: 'employee',
          entityId: id,
          diff: diffOf(auditable(before), auditable(after)),
        },
        tx,
      );
      return after;
    });

    // allowedBranchIds is part of the cached permission payload too.
    await this.permissions.invalidate(this.deps.tenantId, id);
    return toView(record);
  }

  /**
   * TZ M1.4 SHART: "Xodim oʻchirilmaydi — deaktivatsiya. Deaktivatsiyada
   * barcha sessiyalar va refresh token'lar bekor qilinadi."
   *
   * Three things have to happen, and the order matters: flip the flag,
   * revoke every session, then drop the cached permissions. The cache drop
   * is what closes the access-token window — `is_active` is part of the
   * cached payload, so the next request recomputes it and the guard
   * rejects with ACCOUNT_DEACTIVATED even though the JWT is still
   * cryptographically valid.
   */
  async deactivate(id: string, expectedVersion: number | undefined): Promise<EmployeeView> {
    const actor = this.requestUser.current;
    if (actor !== undefined && actor.userId === id) {
      // Not a technical limit — a safety rail. Deactivating yourself logs
      // you out instantly and, for a sole owner, locks the tenant out of
      // its own account with no way back through the UI.
      throw new ConflictException({
        code: 'CANNOT_DEACTIVATE_SELF',
        message: 'You cannot deactivate your own account',
        details: [{ field: 'id', code: 'SELF', value: id }],
      });
    }

    const record = await this.setActive(id, expectedVersion, false);
    await this.sessions.revokeAllForUser(this.deps.tenantId, id);
    await this.permissions.invalidate(this.deps.tenantId, id);
    return toView(record);
  }

  async activate(id: string, expectedVersion: number | undefined): Promise<EmployeeView> {
    const record = await this.setActive(id, expectedVersion, true);
    await this.permissions.invalidate(this.deps.tenantId, id);
    return toView(record);
  }

  /**
   * TZ M1.4 "Oʻqituvchi profili": creates the profile on first use and
   * replaces its qualification sets. Idempotent, so the form can simply
   * PUT whatever the user ticked.
   */
  async setTeacherProfile(id: string, dto: SetTeacherProfileDto): Promise<EmployeeView> {
    const record = await this.tenantDb.transaction(async (tx) => {
      const before = await this.loadTxOrThrow(tx, id);
      await this.assertDisciplinesExist(tx, dto.disciplineIds);
      await this.assertLevelsExist(tx, dto.levelIds);

      const profileId =
        before.teacherProfile?.id ??
        (
          await tx.teacherProfile.create({
            data: { id: uuidv7(), tenantId: this.deps.tenantId, userId: id },
          })
        ).id;

      if ('notes' in dto) {
        await tx.teacherProfile.update({
          where: { id: profileId },
          data: { notes: dto.notes ?? null, version: { increment: 1 } },
        });
      }

      await tx.teacherDiscipline.deleteMany({ where: { teacherProfileId: profileId } });
      await tx.teacherLevel.deleteMany({ where: { teacherProfileId: profileId } });
      if (dto.disciplineIds.length > 0) {
        await tx.teacherDiscipline.createMany({
          data: dto.disciplineIds.map((disciplineId) => ({
            id: uuidv7(),
            tenantId: this.deps.tenantId,
            teacherProfileId: profileId,
            disciplineId,
          })),
        });
      }
      if (dto.levelIds.length > 0) {
        await tx.teacherLevel.createMany({
          data: dto.levelIds.map((levelId) => ({
            id: uuidv7(),
            tenantId: this.deps.tenantId,
            teacherProfileId: profileId,
            levelId,
          })),
        });
      }

      const after = await this.loadTxOrThrow(tx, id);
      await this.audit.record(
        {
          action: 'employee.set_teacher_profile',
          entityType: 'employee',
          entityId: id,
          diff: diffOf(
            { teacherProfile: JSON.stringify(toView(before).teacherProfile) },
            { teacherProfile: JSON.stringify(toView(after).teacherProfile) },
          ),
        },
        tx,
      );
      return after;
    });

    return toView(record);
  }

  private async setActive(
    id: string,
    expectedVersion: number | undefined,
    isActive: boolean,
  ): Promise<EmployeeRecord> {
    return this.tenantDb.transaction(async (tx) => {
      const before = await this.loadTxOrThrow(tx, id);
      if (before.isActive === isActive) {
        return before;
      }

      const version = expectedVersion ?? before.version;
      const { count } = await tx.user.updateMany({
        where: { id, version },
        data: { isActive, version: { increment: 1 } },
      });
      if (count === 0) {
        settleFailedUpdate('employee', id, version, await this.loadTx(tx, id), notFound);
      }

      const after = await this.loadTxOrThrow(tx, id);
      await this.audit.record(
        {
          action: isActive ? 'employee.activate' : 'employee.deactivate',
          entityType: 'employee',
          entityId: id,
          diff: diffOf(auditable(before), auditable(after)),
        },
        tx,
      );
      return after;
    });
  }

  private loadTx(tx: Tx, id: string): Promise<EmployeeRecord | null> {
    return tx.user.findUnique({ where: { id }, include: EMPLOYEE_INCLUDE });
  }

  private async loadTxOrThrow(tx: Tx, id: string): Promise<EmployeeRecord> {
    const record = await this.loadTx(tx, id);
    if (record === null) {
      throw notFound('employee', id);
    }
    return record;
  }

  /**
   * Phone and email are the login identifiers and are unique per tenant.
   * Checked here for a field-level message; the unique indexes are the
   * real guarantee.
   */
  private async assertLoginFree(
    tx: Tx,
    phone: string | null,
    email: string | null,
    selfId: string | undefined,
  ): Promise<void> {
    if (phone !== null) {
      const existing = await tx.user.findFirst({ where: { phone } });
      if (existing !== null && existing.id !== selfId) {
        throw duplicateName('employee', 'phone', phone);
      }
    }
    if (email !== null) {
      const existing = await tx.user.findFirst({ where: { email } });
      if (existing !== null && existing.id !== selfId) {
        throw duplicateName('employee', 'email', email);
      }
    }
  }

  private async resolveRoleIds(tx: Tx, roleCodes: string[]): Promise<string[]> {
    if (roleCodes.length === 0) {
      return [];
    }
    const roles = await tx.role.findMany({ where: { code: { in: roleCodes } } });
    const found = new Set(roles.map((role) => role.code));
    const missing = roleCodes.filter((code) => !found.has(code));
    if (missing.length > 0) {
      throw unknownReference('roleCodes', missing.join(', '));
    }
    return roles.map((role) => role.id);
  }

  private async assertBranchesExist(tx: Tx, branchIds: string[]): Promise<void> {
    if (branchIds.length === 0) {
      return;
    }
    const branches = await tx.branch.findMany({ where: { id: { in: branchIds } } });
    if (branches.length !== new Set(branchIds).size) {
      const found = new Set(branches.map((branch) => branch.id));
      throw unknownReference('branchIds', branchIds.filter((id) => !found.has(id)).join(', '));
    }
  }

  private async assertDisciplinesExist(tx: Tx, disciplineIds: string[]): Promise<void> {
    if (disciplineIds.length === 0) {
      return;
    }
    const rows = await tx.discipline.findMany({ where: { id: { in: disciplineIds } } });
    if (rows.length !== new Set(disciplineIds).size) {
      const found = new Set(rows.map((row) => row.id));
      throw unknownReference(
        'disciplineIds',
        disciplineIds.filter((id) => !found.has(id)).join(', '),
      );
    }
  }

  private async assertLevelsExist(tx: Tx, levelIds: string[]): Promise<void> {
    if (levelIds.length === 0) {
      return;
    }
    const rows = await tx.level.findMany({ where: { id: { in: levelIds } } });
    if (rows.length !== new Set(levelIds).size) {
      const found = new Set(rows.map((row) => row.id));
      throw unknownReference('levelIds', levelIds.filter((id) => !found.has(id)).join(', '));
    }
  }

  private async writeRoles(tx: Tx, userId: string, roleIds: string[]): Promise<void> {
    if (roleIds.length === 0) {
      return;
    }
    await tx.userRole.createMany({
      data: roleIds.map((roleId) => ({
        id: uuidv7(),
        tenantId: this.deps.tenantId,
        userId,
        roleId,
      })),
    });
  }

  private async writeBranches(tx: Tx, userId: string, branchIds: string[]): Promise<void> {
    if (branchIds.length === 0) {
      return;
    }
    await tx.userBranch.createMany({
      data: [...new Set(branchIds)].map((branchId) => ({
        id: uuidv7(),
        tenantId: this.deps.tenantId,
        userId,
        branchId,
      })),
    });
  }
}
