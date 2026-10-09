import type { Server } from 'node:http';
import request from 'supertest';

/**
 * A logged-in HTTP client for the integration tests: keeps the cookie jar,
 * replays the CSRF cookie as the `x-csrf-token` header on every non-GET
 * (the double-submit check CsrfGuard enforces), and unwraps the TZ 6.2
 * envelope.
 *
 * Extracted from auth.spec.ts's inline helpers because T05 adds several
 * suites that all need the same three things, and because a test that
 * forgets the CSRF header fails with a confusing 403 that looks like a
 * permission bug.
 */

interface CookieJar {
  access_token?: string;
  refresh_token?: string;
  csrf_token?: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details: unknown;
  request_id: string;
}

export interface ApiResponse<T> {
  status: number;
  /** `data` from the envelope; `undefined` on an error response. */
  data: T;
  meta?: { total?: number; limit?: number; offset?: number; next_cursor?: string | null };
  error?: ApiErrorBody;
  headers: Record<string, string | string[] | undefined>;
}

export class ApiClient {
  private jar: CookieJar = {};

  constructor(private readonly server: Server) {}

  private absorb(res: request.Response): void {
    const header = res.headers['set-cookie'] as string[] | undefined;
    for (const raw of header ?? []) {
      const [pair] = raw.split(';');
      const separator = pair?.indexOf('=') ?? -1;
      if (!pair || separator === -1) {
        continue;
      }
      const key = pair.slice(0, separator).trim();
      const value = decodeURIComponent(pair.slice(separator + 1).trim());
      if (key === 'access_token' || key === 'refresh_token' || key === 'csrf_token') {
        this.jar[key] = value;
      }
    }
  }

  private cookieHeader(): string {
    return Object.entries(this.jar)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('; ');
  }

  private wrap<T>(res: request.Response): ApiResponse<T> {
    const body = res.body as { data?: T; meta?: ApiResponse<T>['meta']; error?: ApiErrorBody };
    return {
      status: res.status,
      data: body.data as T,
      meta: body.meta,
      error: body.error,
      headers: res.headers,
    };
  }

  async login(tenantSlug: string, login: string, password: string): Promise<number> {
    const res = await request(this.server)
      .post('/api/v1/auth/login')
      .send({ tenant_slug: tenantSlug, login, password });
    this.absorb(res);
    return res.status;
  }

  async get<T>(path: string): Promise<ApiResponse<T>> {
    const res = await request(this.server).get(path).set('Cookie', this.cookieHeader());
    return this.wrap<T>(res);
  }

  async post<T>(
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<ApiResponse<T>> {
    let req = request(this.server)
      .post(path)
      .set('Cookie', this.cookieHeader())
      .set('x-csrf-token', this.jar.csrf_token ?? '');
    for (const [key, value] of Object.entries(headers)) {
      req = req.set(key, value);
    }
    const res = await (body === undefined ? req : req.send(body as object));
    return this.wrap<T>(res);
  }

  async patch<T>(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<ApiResponse<T>> {
    let req = request(this.server)
      .patch(path)
      .set('Cookie', this.cookieHeader())
      .set('x-csrf-token', this.jar.csrf_token ?? '');
    for (const [key, value] of Object.entries(headers)) {
      req = req.set(key, value);
    }
    const res = await req.send(body as object);
    return this.wrap<T>(res);
  }
}
