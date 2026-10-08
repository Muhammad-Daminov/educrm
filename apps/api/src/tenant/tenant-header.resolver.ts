import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import type { ClsService } from 'nestjs-cls';
import { isUuid } from '@educrm/shared';
import { TENANT_HEADER, TENANT_ID_KEY } from './tenant-context.constants';

/**
 * TODO(0.3): replace with tenant resolution from the authenticated
 * session/JWT once auth ships. This header-based resolver only exists so
 * step 0.2 can exercise the RLS data layer before auth exists, and it is
 * hard-disabled outside development/test so it can never become a backdoor
 * in a deployed environment.
 */
export function resolveTenantFromHeader(cls: ClsService, req: Request): void {
  if (process.env.NODE_ENV === 'production') {
    throw new ForbiddenException({
      code: 'TENANT_HEADER_DISABLED',
      message:
        'Tenant resolution via X-Tenant-Id is disabled in production. TODO(0.3): resolve tenant from authenticated session.',
      details: null,
    });
  }

  const header = req.headers[TENANT_HEADER];
  const tenantId = Array.isArray(header) ? header[0] : header;
  if (!tenantId) {
    return;
  }

  if (!isUuid(tenantId)) {
    throw new BadRequestException({
      code: 'INVALID_TENANT_HEADER',
      message: `${TENANT_HEADER} must be a valid UUID`,
      details: null,
    });
  }

  cls.set(TENANT_ID_KEY, tenantId);
}
