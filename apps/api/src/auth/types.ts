import type { PermissionScope } from '@prisma/client';

export interface RequestUser {
  userId: string;
  tenantId: string;
  sessionId: string;
}

export interface EffectivePermissions {
  /** permission code -> widest scope the user holds it at, across all their roles */
  scopes: Record<string, PermissionScope>;
  allowedBranchIds: string[];
}
