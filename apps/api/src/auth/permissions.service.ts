import { Inject, Injectable } from '@nestjs/common';
import type { PermissionScope } from '@prisma/client';
import { RedisService } from '../redis/redis.service';
import { PERMISSIONS_CACHE_TTL_SECONDS } from './auth.constants';
import { TENANT_PRISMA, type TenantPrismaClient } from '../database/tenant-prisma.provider';
import type { EffectivePermissions } from './types';

const SCOPE_RANK: Record<PermissionScope, number> = { own: 0, branch: 1, all: 2 };

/**
 * Effective permissions = union of every role the user has, cached in
 * Redis for 60s (TZ requirement E) keyed by (tenant, user) so two tenants'
 * caches never collide even if user ids were ever reused across tenants.
 */
@Injectable()
export class PermissionsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly tenantDb: TenantPrismaClient,
    private readonly redis: RedisService,
  ) {}

  private cacheKey(tenantId: string, userId: string): string {
    return `perms:${tenantId}:${userId}`;
  }

  async getEffectivePermissions(tenantId: string, userId: string): Promise<EffectivePermissions> {
    const cached = await this.redis.client.get(this.cacheKey(tenantId, userId));
    if (cached) {
      return JSON.parse(cached) as EffectivePermissions;
    }

    const computed = await this.computeEffectivePermissions(userId);
    await this.redis.client.set(
      this.cacheKey(tenantId, userId),
      JSON.stringify(computed),
      'EX',
      PERMISSIONS_CACHE_TTL_SECONDS,
    );
    return computed;
  }

  /** Call whenever a user's roles/role_permissions change. */
  async invalidate(tenantId: string, userId: string): Promise<void> {
    await this.redis.client.del(this.cacheKey(tenantId, userId));
  }

  hasPermission(effective: EffectivePermissions, code: string): boolean {
    return code in effective.scopes;
  }

  private async computeEffectivePermissions(userId: string): Promise<EffectivePermissions> {
    const [userRoles, userBranches] = await Promise.all([
      this.tenantDb.userRole.findMany({
        where: { userId },
        include: { role: { include: { rolePermissions: true } } },
      }),
      this.tenantDb.userBranch.findMany({ where: { userId } }),
    ]);

    const scopes: Record<string, PermissionScope> = {};
    for (const userRole of userRoles) {
      for (const rolePermission of userRole.role.rolePermissions) {
        const existing = scopes[rolePermission.permissionCode];
        if (!existing || SCOPE_RANK[rolePermission.scope] > SCOPE_RANK[existing]) {
          scopes[rolePermission.permissionCode] = rolePermission.scope;
        }
      }
    }

    return {
      scopes,
      allowedBranchIds: userBranches.map((userBranch) => userBranch.branchId),
    };
  }
}
