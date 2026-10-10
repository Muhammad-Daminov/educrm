import { apiFetch, apiFetchEnveloped, type ResponseMeta } from '@/lib/api';
import { listParamsToApiQuery, type ListParams } from '@/lib/list-params';

/**
 * Client for TZ M3 students. Not built on the T05 `resources.ts` helpers:
 * a student's "active" state is a computed status enum rather than a plain
 * `isActive` flag, and create/duplicate-check/contact-persons are shapes
 * `resources.ts` has no room for.
 */

export type StudentStatus = 'active' | 'frozen' | 'finished' | 'no_enrollment' | 'archived';

export interface PhoneRow {
  id: string;
  phone: string;
  isPrimary: boolean;
}

export interface ContactPersonRow {
  id: string;
  fullName: string;
  relation: string;
  phone: string | null;
  email: string | null;
  isBillRecipient: boolean;
  receivesNotifications: boolean;
  version: number;
}

export interface StudentRow {
  id: string;
  clientId: string;
  branchId: string;
  fullName: string;
  birthDate: string | null;
  gender: 'male' | 'female' | null;
  status: StudentStatus;
  isActive: boolean;
  ownerId: string | null;
  cachedBalance: string;
  churnScore: number | null;
  blacklisted: boolean;
  blacklistReason: string | null;
  version: number;
  createdAt: string;
  /** Present only for a caller with `student.view_contacts` (TZ M11.2). */
  phones?: PhoneRow[];
  contactPersons?: ContactPersonRow[];
}

export interface DuplicateMatch {
  clientId: string;
  studentId: string | null;
  fullName: string;
}

export interface Page<T> {
  rows: T[];
  total: number;
}

function metaTotal(meta: ResponseMeta | undefined, fallback: number): number {
  return typeof meta?.total === 'number' ? meta.total : fallback;
}

export async function fetchStudents(params: ListParams): Promise<Page<StudentRow>> {
  const { data, meta } = await apiFetchEnveloped<StudentRow[]>(
    `/api/v1/students?${listParamsToApiQuery(params)}`,
  );
  return { rows: data, total: metaTotal(meta, data.length) };
}

export function fetchStudent(id: string): Promise<StudentRow> {
  return apiFetch<StudentRow>(`/api/v1/students/${id}`);
}

export function checkPhone(phone: string): Promise<DuplicateMatch | null> {
  return apiFetch<DuplicateMatch | null>(`/api/v1/students/check-phone?phone=${encodeURIComponent(phone)}`);
}

export interface CreateStudentInput {
  fullName: string;
  phone: string;
  branchId: string;
  birthDate?: string | null;
  gender?: 'male' | 'female' | null;
  force?: boolean;
}

export function createStudent(input: CreateStudentInput): Promise<StudentRow> {
  return apiFetch<StudentRow>('/api/v1/students', { method: 'POST', body: JSON.stringify(input) });
}

export function updateStudent(
  id: string,
  version: number,
  body: Record<string, unknown>,
): Promise<StudentRow> {
  return apiFetch<StudentRow>(`/api/v1/students/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'if-match': String(version) },
  });
}

export function archiveStudent(id: string, version: number): Promise<StudentRow> {
  return apiFetch<StudentRow>(`/api/v1/students/${id}/archive`, {
    method: 'POST',
    headers: { 'if-match': String(version) },
  });
}

export function restoreStudent(id: string, version: number): Promise<StudentRow> {
  return apiFetch<StudentRow>(`/api/v1/students/${id}/restore`, {
    method: 'POST',
    headers: { 'if-match': String(version) },
  });
}

export function setPhones(
  id: string,
  phones: { phone: string; isPrimary?: boolean }[],
): Promise<StudentRow> {
  return apiFetch<StudentRow>(`/api/v1/students/${id}/phones`, {
    method: 'PUT',
    body: JSON.stringify({ phones }),
  });
}

export function createContactPerson(
  studentId: string,
  body: Record<string, unknown>,
): Promise<ContactPersonRow> {
  return apiFetch<ContactPersonRow>(`/api/v1/students/${studentId}/contact-persons`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateContactPerson(
  studentId: string,
  contactId: string,
  version: number,
  body: Record<string, unknown>,
): Promise<ContactPersonRow> {
  return apiFetch<ContactPersonRow>(`/api/v1/students/${studentId}/contact-persons/${contactId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'if-match': String(version) },
  });
}

export async function deleteContactPerson(studentId: string, contactId: string): Promise<void> {
  await apiFetch<{ deleted: true }>(`/api/v1/students/${studentId}/contact-persons/${contactId}`, {
    method: 'DELETE',
  });
}

export interface ImportRowError {
  row: number;
  field: string;
  code: string;
  value: string;
}

export interface ImportDryRunResult {
  totalRows: number;
  validCount: number;
  errors: ImportRowError[];
}

export interface ImportConfirmResult {
  batchId: string;
  totalRows: number;
  importedCount: number;
  errorCount: number;
  errors: ImportRowError[];
}

export interface StudentImportMapping {
  fullName: string;
  phone: string;
  branchCode: string;
  birthDate?: string;
  gender?: string;
}

function importFormData(file: File, mapping: StudentImportMapping): FormData {
  const form = new FormData();
  form.append('file', file);
  form.append('mapping', JSON.stringify(mapping));
  return form;
}

export function importDryRun(file: File, mapping: StudentImportMapping): Promise<ImportDryRunResult> {
  return apiFetch<ImportDryRunResult>('/api/v1/students/import/dry-run', {
    method: 'POST',
    body: importFormData(file, mapping),
  });
}

export function importConfirm(file: File, mapping: StudentImportMapping): Promise<ImportConfirmResult> {
  return apiFetch<ImportConfirmResult>('/api/v1/students/import/confirm', {
    method: 'POST',
    body: importFormData(file, mapping),
  });
}

export function importRollback(batchId: string): Promise<{ archivedCount: number }> {
  return apiFetch<{ archivedCount: number }>(`/api/v1/students/import/${batchId}/rollback`, {
    method: 'POST',
  });
}
