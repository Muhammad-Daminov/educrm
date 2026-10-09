import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { TENANT_PRISMA, type TenantPrismaClient } from '../../database/tenant-prisma.provider';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { AuditService } from '../../audit/audit.service';

/**
 * The three collaborators every archivable CRUD service needs, bundled so
 * each one's constructor stays `constructor(deps: CrudDeps) { super(deps); }`
 * instead of repeating the same three injections seven times.
 */
@Injectable()
export class CrudDeps {
  constructor(
    @Inject(TENANT_PRISMA) readonly tenantDb: TenantPrismaClient,
    readonly tenantContext: TenantContextService,
    readonly audit: AuditService,
  ) {}

  /**
   * The tenant every write must stamp. Refusing is the same stance the
   * tenant-scoped Prisma client takes: a row with no tenant is worse than
   * a failed request.
   */
  get tenantId(): string {
    const tenantId = this.tenantContext.currentTenantId;
    if (!tenantId) {
      throw new ForbiddenException({
        code: 'TENANT_CONTEXT_MISSING',
        message: 'No tenant in request context',
        details: null,
      });
    }
    return tenantId;
  }
}
