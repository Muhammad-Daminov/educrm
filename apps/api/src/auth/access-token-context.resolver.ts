import type { Request } from 'express';
import type { ClsService } from 'nestjs-cls';
import { ACCESS_TOKEN_COOKIE, REQUEST_USER_KEY } from './auth.constants';
import { getCookie } from './cookie.util';
import { decodeAccessTokenClaims } from './token.service';
import { TENANT_ID_KEY } from '../tenant/tenant-context.constants';
import type { RequestUser } from './types';

/**
 * Replaces the old X-Tenant-Id header resolver (step 0.3, requirement D):
 * tenant_id now comes ONLY from a verified access token, never a header.
 *
 * Deliberately never throws — an absent/invalid/expired access token just
 * means the request proceeds unauthenticated (requestUser left unset).
 * Enforcing 401 for protected routes is PermissionsGuard's job, not this
 * resolver's; that split is what lets `@Public()` routes (including
 * /auth/refresh, which exists precisely because the access token expired)
 * work without special-casing them here.
 */
export function resolveAuthFromAccessToken(cls: ClsService, req: Request): void {
  const token = getCookie(req, ACCESS_TOKEN_COOKIE);
  if (!token) {
    return;
  }

  const claims = decodeAccessTokenClaims(token, process.env.JWT_SECRET ?? '');
  if (!claims) {
    return;
  }

  const user: RequestUser = {
    userId: claims.sub,
    tenantId: claims.tenant_id,
    sessionId: claims.session_id,
  };
  cls.set(TENANT_ID_KEY, user.tenantId);
  cls.set(REQUEST_USER_KEY, user);
}
