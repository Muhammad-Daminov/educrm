import { apiFetch } from '@/lib/api';

export interface MeResponse {
  user: { id: string; fullName: string; phone: string | null; email: string | null };
  roles: { code: string; name: string }[];
  permissions: { code: string; scope: 'own' | 'branch' | 'all' }[];
  branches: { id: string; name: string }[];
}

export function fetchMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>('/api/v1/auth/me');
}

export function logout(): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/api/v1/auth/logout', { method: 'POST' });
}
