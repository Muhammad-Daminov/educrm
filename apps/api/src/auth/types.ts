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
  /**
   * Whether the account is still active. Part of the cached permission
   * payload rather than a separate per-request query: TZ M1.4 SHART says
   * deactivating an employee revokes their sessions, but an access token
   * already issued stays cryptographically valid for up to its 15-minute
   * TTL. Carrying `is_active` here means the guard rejects the very next
   * request after `PermissionsService.invalidate`, instead of leaving a
   * window in which a dismissed employee keeps working.
   */
  isActive: boolean;
}
