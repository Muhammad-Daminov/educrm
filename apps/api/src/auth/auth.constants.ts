export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';
export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';

export const AUTH_COOKIE_PATH = '/api/v1/auth';
export const ROOT_COOKIE_PATH = '/';

export const MIN_PASSWORD_LENGTH = 10;

export const LOGIN_RATE_LIMIT = {
  maxAttempts: 5,
  windowSeconds: 15 * 60,
};

export const ACCOUNT_LOCKOUT_SECONDS = 15 * 60;

export const PERMISSIONS_CACHE_TTL_SECONDS = 60;

/**
 * Permission "codes" that are not in the TZ 3.2 catalog and are not backed
 * by a `permissions` row — any authenticated, active user has them. Used
 * for endpoints like `/auth/me` that need *a* logged-in user but have no
 * natural resource.action (see PermissionsGuard).
 */
export const SELF_SERVICE_PERMISSIONS = new Set(['auth.me', 'auth.logout_all']);

/** CLS key the request's verified {userId, tenantId, sessionId} is stored under. */
export const REQUEST_USER_KEY = 'requestUser';
