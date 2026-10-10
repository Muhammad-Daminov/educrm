import { ApiError, apiFetch, apiFetchEnveloped, type ResponseMeta } from '@/lib/api';
import { listParamsToApiQuery, type ListParams } from '@/lib/list-params';

const MAX_OPTIONS = 200;

/**
 * Client for the T05 archivable resources. Every one of them has the same
 * endpoints (`GET /x`, `GET /x/:id`, `POST /x`, `PATCH /x/:id`,
 * `POST /x/:id/archive|restore`), so the screens share one client rather
 * than hand-rolling fetches — which is also what keeps `If-Match` from
 * being forgotten on a screen nobody looked at twice.
 */

/** Minimum every list row has; screens extend it. */
export interface ArchivableRow {
  id: string;
  isActive: boolean;
  version: number;
}

export interface Page<T> {
  rows: T[];
  total: number;
}

export async function fetchPage<T>(path: string, params: ListParams): Promise<Page<T>> {
  const { data, meta } = await apiFetchEnveloped<T[]>(`${path}?${listParamsToApiQuery(params)}`);
  return { rows: data, total: metaTotal(meta, data.length) };
}

function metaTotal(meta: ResponseMeta | undefined, fallback: number): number {
  return typeof meta?.total === 'number' ? meta.total : fallback;
}

/**
 * Every active row of a reference list, for a form's picker rather than a
 * paged table — a branch or discipline select needs the whole set, not
 * page 1 of it. `MAX_OPTIONS` matches the API's own list cap, so a tenant
 * with more rows than that silently truncates the picker rather than
 * erroring it.
 */
export async function fetchActiveOptions<T>(path: string): Promise<T[]> {
  const { rows } = await fetchPage<T>(path, {
    q: '',
    is_active: 'true',
    extra: {},
    page: 1,
    pageSize: MAX_OPTIONS,
  });
  return rows;
}

export function createResource<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

/**
 * `version` goes out as `If-Match` (TZ 6.1). It is a required argument, not
 * an option: the server treats a missing header as last-write-wins, and
 * silently overwriting a colleague's edit is exactly what UX §3.8's
 * version-conflict state exists to prevent.
 */
export function updateResource<T>(
  path: string,
  id: string,
  version: number,
  body: unknown,
): Promise<T> {
  return apiFetch<T>(`${path}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'if-match': String(version) },
  });
}

export function archiveResource<T>(path: string, id: string, version: number): Promise<T> {
  return apiFetch<T>(`${path}/${id}/archive`, {
    method: 'POST',
    headers: { 'if-match': String(version) },
  });
}

export function restoreResource<T>(path: string, id: string, version: number): Promise<T> {
  return apiFetch<T>(`${path}/${id}/restore`, {
    method: 'POST',
    headers: { 'if-match': String(version) },
  });
}

/** POST to an action sub-resource (deactivate/activate, roles, branches). */
export function actionResource<T>(
  path: string,
  method: 'POST' | 'PUT',
  body?: unknown,
  version?: number,
): Promise<T> {
  return apiFetch<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(version === undefined ? {} : { headers: { 'if-match': String(version) } }),
  });
}

/**
 * One `details` entry of a TZ 6.2 error body. The API always names the
 * field it is complaining about, which is what lets UX P6 put the message
 * on the input rather than in a banner.
 */
interface ErrorDetail {
  field?: unknown;
  code?: unknown;
  message?: unknown;
  /** zod issues arrive as `path: ['maxAge']` rather than `field`. */
  path?: unknown;
}

/**
 * Maps an ApiError onto `{ field: code }`, for the form to render next to
 * the offending input. The *code* is returned rather than the message
 * because TZ 6.2 SHART says the frontend keys off codes for i18n, never
 * off server text.
 */
export function fieldErrorsFrom(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) {
    return {};
  }
  const details = error.body.details;
  if (!Array.isArray(details)) {
    return {};
  }

  const errors: Record<string, string> = {};
  for (const entry of details as ErrorDetail[]) {
    const field = fieldOf(entry);
    if (field === undefined) {
      continue;
    }
    errors[field] = typeof entry.code === 'string' ? entry.code : error.body.code;
  }
  return errors;
}

function fieldOf(entry: ErrorDetail): string | undefined {
  if (typeof entry.field === 'string') {
    return entry.field;
  }
  if (Array.isArray(entry.path)) {
    const path: unknown[] = entry.path;
    const last = path[path.length - 1];
    return typeof last === 'string' ? last : undefined;
  }
  return undefined;
}

export function isVersionConflict(error: unknown): boolean {
  return error instanceof ApiError && error.body.code === 'VERSION_CONFLICT';
}

export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}
