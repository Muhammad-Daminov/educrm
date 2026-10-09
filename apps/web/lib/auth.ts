import { apiFetch } from '@/lib/api';

export interface MeResponse {
  user: { id: string; fullName: string; phone: string | null; email: string | null };
  roles: { code: string; name: string }[];
  permissions: { code: string; scope: 'own' | 'branch' | 'all' }[];
  branches: { id: string; name: string }[];
}

/**
 * The one place the login payload is built. Key names here must match the
 * API's `loginSchema` (apps/api/src/auth/dto/login.dto.ts) exactly —
 * snake_case `tenant_slug`, plus `login` and `password`. Centralized so
 * test/api.spec.ts can assert the wire shape in a single place rather
 * than relying on the login page's JSX being eyeballed.
 */
export interface LoginPayload {
  tenant_slug: string;
  login: string;
  password: string;
}

export function buildLoginPayload(
  tenantSlug: string,
  loginId: string,
  password: string,
): LoginPayload {
  return { tenant_slug: tenantSlug, login: loginId, password };
}

export function login(tenantSlug: string, loginId: string, password: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(buildLoginPayload(tenantSlug, loginId, password)),
  });
}

export function fetchMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>('/api/v1/auth/me');
}

export function logout(): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/api/v1/auth/logout', { method: 'POST' });
}
