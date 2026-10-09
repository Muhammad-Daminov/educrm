/**
 * All calls go through Next's own `/api/v1/*` rewrite (see next.config.ts)
 * so the browser only ever talks to one origin — no CORS, and cookies set
 * by the API (access/refresh/CSRF) land on this origin automatically.
 */
const CSRF_COOKIE = 'csrf_token';

export interface ApiErrorBody {
  code: string;
  message: string;
  details: unknown;
  request_id: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

function getCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1] ?? '') : undefined;
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);

  if (method !== 'GET' && method !== 'HEAD') {
    const csrfToken = getCookie(CSRF_COOKIE);
    if (csrfToken) {
      headers.set('x-csrf-token', csrfToken);
    }
  }
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return fetch(path, { ...init, headers, credentials: 'same-origin' });
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const errorBody = (body as { error?: ApiErrorBody } | null)?.error ?? {
      code: 'UNKNOWN_ERROR',
      message: 'Unexpected error',
      details: null,
      request_id: '',
    };
    throw new ApiError(res.status, errorBody);
  }
  return body as T;
}

/**
 * Endpoints where a 401 is a verdict about the *credentials in the
 * request*, not a sign of an expired access token — so silently refreshing
 * and retrying is both pointless and harmful.
 *
 * `/auth/login` is the important one: retrying it sends the same wrong
 * password a second time, which the API counts as a second failed attempt
 * against its 5-per-15-min limit (TZ 6.5). That halves the real lockout
 * threshold — three clicks lock the account, and for the next 15 minutes
 * even the *correct* password fails with 429, while the same credentials
 * still work over curl. See the regression tests in test/api.spec.ts.
 *
 * `/auth/me` is deliberately NOT in this set: that one's 401 genuinely
 * does mean "access token expired", and refreshing it is the whole point
 * of the silent-refresh requirement.
 */
const NO_SILENT_REFRESH = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/logout',
  '/api/v1/auth/logout-all',
]);

/**
 * On a 401 from a session-backed endpoint, silently attempts one
 * `/auth/refresh` call and retries the original request exactly once
 * (step 0.3 requirement I). If the refresh also fails, the caller's 401
 * propagates as an ApiError — callers that need a redirect (the protected
 * layout) catch that and send the user to /login themselves.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const first = await rawFetch(path, init);

  if (first.status !== 401 || NO_SILENT_REFRESH.has(path)) {
    return parseOrThrow<T>(first);
  }

  const refreshRes = await rawFetch('/api/v1/auth/refresh', { method: 'POST' });
  if (!refreshRes.ok) {
    return parseOrThrow<T>(first);
  }

  const retried = await rawFetch(path, init);
  return parseOrThrow<T>(retried);
}
