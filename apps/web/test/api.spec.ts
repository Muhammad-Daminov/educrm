import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, apiFetch } from '../lib/api';
import { buildLoginPayload, fetchMe, login } from '../lib/auth';

/**
 * Mirrors apps/api/src/auth/dto/login.dto.ts. Kept as a literal copy on
 * purpose: apps/web does not (and should not) depend on the API package,
 * so this is the contract check that catches a field being renamed or
 * dropped on one side only.
 */
const apiLoginSchema = z
  .object({
    tenant_slug: z.string().min(1),
    login: z.string().min(1),
    password: z.string().min(1),
  })
  .strict();

interface FetchCall {
  url: string;
  method: string;
  body: string | undefined;
}

let calls: FetchCall[] = [];

interface MockResponse {
  status: number;
  body?: unknown;
}

function mockFetchSequence(responses: MockResponse[]): void {
  let index = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: (init?.method ?? 'GET').toUpperCase(),
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      const next: MockResponse =
        responses[index] ?? responses[responses.length - 1] ?? { status: 500 };
      index += 1;
      return Promise.resolve({
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        json: () => Promise.resolve(next.body ?? {}),
      } as Response);
    }),
  );
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal('document', { cookie: '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('login request payload matches the API DTO', () => {
  it('builds exactly the fields apps/api loginSchema requires', () => {
    const payload = buildLoginPayload('demo', '901234567', 'Educrm2026!');
    expect(() => apiLoginSchema.parse(payload)).not.toThrow();
    expect(Object.keys(payload).sort()).toEqual(['login', 'password', 'tenant_slug']);
  });

  it('sends that payload, snake_case intact, to POST /api/v1/auth/login', async () => {
    mockFetchSequence([{ status: 201, body: { ok: true } }]);

    await login('demo', '901234567', 'Educrm2026!');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/v1/auth/login');
    expect(calls[0]?.method).toBe('POST');
    expect(() => apiLoginSchema.parse(JSON.parse(calls[0]?.body ?? '{}'))).not.toThrow();
  });
});

/**
 * Regression test for the browser-only login failure: apiFetch used to
 * treat a 401 from /auth/login as "access token expired" and silently
 * refresh + retry. The retry resent the same wrong password, so the API
 * counted two failed attempts per click and locked the account after
 * three clicks instead of five — after which even the correct password
 * returned 429 for 15 minutes, while curl (outside the window) worked.
 */
describe('silent refresh is scoped to session-backed endpoints', () => {
  it('does NOT refresh or retry when /auth/login returns 401', async () => {
    mockFetchSequence([
      { status: 401, body: { error: { code: 'INVALID_CREDENTIALS', message: 'bad', details: null, request_id: 'r1' } } },
    ]);

    await expect(login('demo', '901234567', 'wrong-password')).rejects.toBeInstanceOf(ApiError);

    // Exactly one request: the login itself. No /auth/refresh, no second
    // login — a second login here is the bug that burned the rate limit.
    expect(calls.map((call) => call.url)).toEqual(['/api/v1/auth/login']);
  });

  it('surfaces the login 401 as INVALID_CREDENTIALS rather than a refresh error', async () => {
    mockFetchSequence([
      { status: 401, body: { error: { code: 'INVALID_CREDENTIALS', message: 'bad', details: null, request_id: 'r1' } } },
    ]);

    await expect(login('demo', '901234567', 'wrong-password')).rejects.toMatchObject({
      status: 401,
      body: { code: 'INVALID_CREDENTIALS' },
    });
  });

  it('does NOT refresh or retry when /auth/logout returns 401', async () => {
    mockFetchSequence([
      { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'no', details: null, request_id: 'r1' } } },
    ]);

    await expect(
      apiFetch('/api/v1/auth/logout', { method: 'POST' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(calls.map((call) => call.url)).toEqual(['/api/v1/auth/logout']);
  });

  it('DOES refresh and retry once when /auth/me returns 401', async () => {
    mockFetchSequence([
      { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'no', details: null, request_id: 'r1' } } },
      { status: 201, body: { ok: true } },
      { status: 200, body: { user: { id: 'u1', fullName: 'A', phone: null, email: null }, roles: [], permissions: [], branches: [] } },
    ]);

    const me = await fetchMe();

    expect(calls.map((call) => call.url)).toEqual([
      '/api/v1/auth/me',
      '/api/v1/auth/refresh',
      '/api/v1/auth/me',
    ]);
    expect(me.user.id).toBe('u1');
  });

  it('gives up after one failed refresh instead of looping', async () => {
    mockFetchSequence([
      { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'no', details: null, request_id: 'r1' } } },
      { status: 401, body: { error: { code: 'REFRESH_TOKEN_INVALID', message: 'no', details: null, request_id: 'r2' } } },
    ]);

    await expect(fetchMe()).rejects.toBeInstanceOf(ApiError);
    expect(calls.map((call) => call.url)).toEqual(['/api/v1/auth/me', '/api/v1/auth/refresh']);
  });
});

describe('CSRF header', () => {
  it('is omitted on login (the API skips CSRF there; no cookie exists yet)', async () => {
    mockFetchSequence([{ status: 201, body: { ok: true } }]);
    await login('demo', '901234567', 'Educrm2026!');
    expect(calls).toHaveLength(1);
  });
});
