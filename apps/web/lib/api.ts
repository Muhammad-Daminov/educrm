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
 * On a 401 from any endpoint other than refresh itself, silently attempts
 * one `/auth/refresh` call and retries the original request exactly once
 * (step 0.3 requirement I). If the refresh also fails, the caller's 401
 * propagates as an ApiError — callers that need a redirect (the protected
 * layout) catch that and send the user to /login themselves.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const first = await rawFetch(path, init);

  if (first.status !== 401 || path === '/api/v1/auth/refresh') {
    return parseOrThrow<T>(first);
  }

  const refreshRes = await rawFetch('/api/v1/auth/refresh', { method: 'POST' });
  if (!refreshRes.ok) {
    return parseOrThrow<T>(first);
  }

  const retried = await rawFetch(path, init);
  return parseOrThrow<T>(retried);
}
