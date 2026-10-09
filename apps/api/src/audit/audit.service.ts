import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { TENANT_PRISMA, type TenantPrismaClient } from '../database/tenant-prisma.provider';
import { TenantContextService } from '../tenant/tenant-context.service';
import { RequestUserService } from '../auth/request-user.service';
import { RequestMetaService } from '../common/request-meta';

/**
 * One audited event. `actorId`, `ip`, `userAgent` and `requestId` are filled
 * in from the request context, so callers only describe *what happened*.
 */
export interface AuditEntry {
  /** `resource.action`, matching the permission that gated it where one exists. */
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Use `diffOf()` for updates, `snapshotOf()` for create/archive. */
  diff?: Prisma.InputJsonValue | null;
  /** Overrides the request user — for jobs acting on someone's behalf. */
  actorId?: string | null;
  occurredAt?: Date;
}

/**
 * Writes the TZ M11.3 audit trail. Mandatory for: financial operations,
 * role/permission changes, viewing contacts, retroactive attendance, payroll
 * approve/reopen, bulk actions, exports, merges and support sessions.
 *
 * **Pass the `tx` whenever the audited change is itself a write.** An audit
 * row that commits separately from the thing it describes is a lie in both
 * directions: it can survive a rolled-back operation, or go missing for one
 * that succeeded. Opening a second transaction for it would also violate
 * CLAUDE.md's rule on multi-statement writes:
 *
 * ```ts
 * await tenantDb.transaction(async (tx) => {
 *   const payment = await tx.payment.create({ ... });
 *   await audit.record({ action: 'payment.create', entityType: 'payment',
 *                        entityId: payment.id, diff: snapshotOf(payment) }, tx);
 * });
 * ```
 */
@Injectable()
export class AuditService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly tenantDb: TenantPrismaClient,
    private readonly tenantContext: TenantContextService,
    private readonly requestUser: RequestUserService,
    private readonly requestMeta: RequestMetaService,
  ) {}

  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const tenantId = this.tenantContext.currentTenantId;
    if (!tenantId) {
      // Same stance as the tenant-scoped Prisma client: refuse rather than
      // write an unattributable audit row.
      throw new ForbiddenException({
        code: 'TENANT_CONTEXT_MISSING',
        message: 'No tenant in request context; refusing to write an audit entry.',
        details: null,
      });
    }

    const meta = this.requestMeta.current;
    const data: Prisma.AuditLogCreateInput = {
      id: uuidv7(),
      tenantId,
      actorId: entry.actorId ?? this.requestUser.current?.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      diff: entry.diff ?? undefined,
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
      requestId: meta?.requestId ?? null,
      occurredAt: entry.occurredAt ?? new Date(),
    };

    if (tx) {
      await tx.auditLog.create({ data });
      return;
    }
    await this.tenantDb.auditLog.create({ data });
  }
}
