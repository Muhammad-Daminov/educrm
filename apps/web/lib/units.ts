import { apiFetch, apiFetchEnveloped, type ResponseMeta } from '@/lib/api';
import { listParamsToApiQuery, type ListParams } from '@/lib/list-params';

/**
 * Client for TZ M4.1/M4.2 study_units + enrollments. Not built on the T05
 * `resources.ts` helpers: a study unit has a five-state status machine
 * instead of a plain `is_active` flag, and members are a nested collection
 * with their own add/transfer/cancel/freeze endpoints `resources.ts` has no
 * room for — the same divergence `students.ts` already has.
 */

export type StudyUnitType = 'group' | 'mini_group' | 'individual';
export type StudyUnitStatus = 'forming' | 'active' | 'paused' | 'finished' | 'cancelled';
export type EnrollmentStatus = 'active' | 'frozen' | 'finished' | 'transferred' | 'cancelled';

export interface EnrollmentRow {
  id: string;
  studentId: string;
  studentName: string;
  studyUnitId: string;
  startDate: string;
  endDate: string | null;
  status: EnrollmentStatus;
  version: number;
}

export interface StudyUnitRow {
  id: string;
  branchId: string;
  disciplineId: string;
  levelId: string | null;
  ageCategoryId: string | null;
  type: StudyUnitType;
  status: StudyUnitStatus;
  name: string;
  capacity: number;
  minSize: number;
  responsibleId: string | null;
  color: string | null;
  startDate: string | null;
  endDate: string | null;
  version: number;
  createdAt: string;
  enrolledCount: number;
  overCapacity: boolean;
  belowMinSize: boolean;
  enrollments: EnrollmentRow[];
}

export interface Page<T> {
  rows: T[];
  total: number;
}

function metaTotal(meta: ResponseMeta | undefined, fallback: number): number {
  return typeof meta?.total === 'number' ? meta.total : fallback;
}

export async function fetchStudyUnits(params: ListParams): Promise<Page<StudyUnitRow>> {
  const { data, meta } = await apiFetchEnveloped<StudyUnitRow[]>(
    `/api/v1/study-units?${listParamsToApiQuery(params)}`,
  );
  return { rows: data, total: metaTotal(meta, data.length) };
}

export function fetchStudyUnit(id: string): Promise<StudyUnitRow> {
  return apiFetch<StudyUnitRow>(`/api/v1/study-units/${id}`);
}

export interface CreateStudyUnitInput {
  branchId: string;
  disciplineId: string;
  levelId?: string | null;
  ageCategoryId?: string | null;
  type: StudyUnitType;
  name?: string | null;
  capacity: number;
  minSize: number;
  responsibleId?: string | null;
  color?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export function createStudyUnit(input: CreateStudyUnitInput): Promise<StudyUnitRow> {
  return apiFetch<StudyUnitRow>('/api/v1/study-units', { method: 'POST', body: JSON.stringify(input) });
}

export function updateStudyUnit(
  id: string,
  version: number,
  body: Record<string, unknown>,
): Promise<StudyUnitRow> {
  return apiFetch<StudyUnitRow>(`/api/v1/study-units/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'if-match': String(version) },
  });
}

export function changeStudyUnitStatus(
  id: string,
  version: number,
  status: StudyUnitStatus,
): Promise<StudyUnitRow> {
  return apiFetch<StudyUnitRow>(`/api/v1/study-units/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
    headers: { 'if-match': String(version) },
  });
}

export function addEnrollment(
  studyUnitId: string,
  input: { studentId: string; startDate: string; endDate?: string | null },
): Promise<EnrollmentRow> {
  return apiFetch<EnrollmentRow>(`/api/v1/study-units/${studyUnitId}/enrollments`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function transferEnrollment(
  studyUnitId: string,
  enrollmentId: string,
  version: number,
  input: { toStudyUnitId: string; transferDate: string },
): Promise<EnrollmentRow> {
  return apiFetch<EnrollmentRow>(
    `/api/v1/study-units/${studyUnitId}/enrollments/${enrollmentId}/transfer`,
    { method: 'POST', body: JSON.stringify(input), headers: { 'if-match': String(version) } },
  );
}

export function cancelEnrollment(
  studyUnitId: string,
  enrollmentId: string,
  version: number,
  input: { endDate?: string; reason?: string } = {},
): Promise<EnrollmentRow> {
  return apiFetch<EnrollmentRow>(`/api/v1/study-units/${studyUnitId}/enrollments/${enrollmentId}/cancel`, {
    method: 'POST',
    body: JSON.stringify(input),
    headers: { 'if-match': String(version) },
  });
}

export function finishEnrollment(
  studyUnitId: string,
  enrollmentId: string,
  version: number,
  input: { endDate?: string } = {},
): Promise<EnrollmentRow> {
  return apiFetch<EnrollmentRow>(`/api/v1/study-units/${studyUnitId}/enrollments/${enrollmentId}/finish`, {
    method: 'POST',
    body: JSON.stringify(input),
    headers: { 'if-match': String(version) },
  });
}

export function freezeEnrollment(
  studyUnitId: string,
  enrollmentId: string,
  version: number,
): Promise<EnrollmentRow> {
  return apiFetch<EnrollmentRow>(`/api/v1/study-units/${studyUnitId}/enrollments/${enrollmentId}/freeze`, {
    method: 'POST',
    headers: { 'if-match': String(version) },
  });
}

export function unfreezeEnrollment(
  studyUnitId: string,
  enrollmentId: string,
  version: number,
): Promise<EnrollmentRow> {
  return apiFetch<EnrollmentRow>(
    `/api/v1/study-units/${studyUnitId}/enrollments/${enrollmentId}/unfreeze`,
    { method: 'POST', headers: { 'if-match': String(version) } },
  );
}
