import { Inject, Injectable } from '@nestjs/common';
import { TENANT_PRISMA, type TenantPrismaClient } from '../database/tenant-prisma.provider';
import { compareUzbek } from '@educrm/shared';

export interface RoleView {
  id: string;
  code: string;
  name: string;
  isSystem: boolean;
  /** Permission codes the role grants, for the "what does this mean" hint. */
  permissions: { code: string; scope: string }[];
}

/**
 * The tenant's roles, as the employee form's role picker needs them. Roles
 * themselves are seeded from the TZ 3.1 templates when a tenant is created;
 * editing their permission matrix is the `role.manage` screen R1 adds.
 */
@Injectable()
export class RolesService {
  constructor(@Inject(TENANT_PRISMA) private readonly tenantDb: TenantPrismaClient) {}

  async list(): Promise<RoleView[]> {
    const roles = await this.tenantDb.role.findMany({ include: { rolePermissions: true } });
    return (
      roles
        .map((role) => ({
          id: role.id,
          code: role.code,
          name: role.name,
          isSystem: role.isSystem,
          permissions: role.rolePermissions
            .map((rolePermission) => ({
              code: rolePermission.permissionCode,
              scope: rolePermission.scope,
            }))
            .sort((left, right) => left.code.localeCompare(right.code)),
        }))
        // Sorted through the TZ 8.5 comparator, like every other
        // user-visible list — role names are translated per tenant.
        .sort((left, right) => compareUzbek(left.name, right.name))
    );
  }
}
