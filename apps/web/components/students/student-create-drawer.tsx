'use client';

import { useState, type JSX } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { t } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import { checkPhone, createStudent, type DuplicateMatch, type StudentRow } from '@/lib/students';

/**
 * UX P6 "Minimal + keyin toʻldirish": three fields (ism, telefon, filial) —
 * discipline/source (TZ P6's other two) belong to the enrollment/lead this
 * student doesn't have yet (T07/M2), so they aren't here. The duplicate
 * check runs on phone blur ("kiritilganda dublikat tekshiruvi — 'Bu raqam
 * bilan ... bor. Ochish / Shunga bogʻlash'") rather than only on submit.
 */
export function StudentCreateDrawer({
  branchOptions,
  onClose,
  onCreated,
}: {
  branchOptions: readonly { value: string; label: string }[];
  onClose: () => void;
  onCreated: (student: StudentRow) => void;
}): JSX.Element {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [branchId, setBranchId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);
  const [checkingPhone, setCheckingPhone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const dirty = fullName !== '' || phone !== '' || branchId !== '';

  function clearError(field: string): void {
    setErrors((previous) => {
      if (previous[field] === undefined) {
        return previous;
      }
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }

  async function onPhoneBlur(): Promise<void> {
    const trimmed = phone.trim();
    if (trimmed === '') {
      setDuplicate(null);
      return;
    }
    setCheckingPhone(true);
    try {
      setDuplicate(await checkPhone(trimmed));
    } catch {
      // A failed duplicate check must not block the form — it's a hint,
      // not a validation the server still enforces on submit.
      setDuplicate(null);
    } finally {
      setCheckingPhone(false);
    }
  }

  async function save(force: boolean): Promise<void> {
    const missing: Record<string, string> = {};
    if (fullName.trim() === '') {
      missing.fullName = 'REQUIRED';
    }
    if (phone.trim() === '') {
      missing.phone = 'REQUIRED';
    }
    if (branchId === '') {
      missing.branchId = 'REQUIRED';
    }
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const created = await createStudent({
        fullName: fullName.trim(),
        phone: phone.trim(),
        branchId,
        force,
      });
      onCreated(created);
    } catch (error) {
      if (error instanceof ApiError && error.body.code === 'DUPLICATE_PHONE') {
        const details: unknown = error.body.details;
        const detail: unknown = Array.isArray(details) ? (details as unknown[])[0] : undefined;
        setDuplicate({
          clientId: (detail as { client_id?: string } | undefined)?.client_id ?? '',
          studentId: (detail as { student_id?: string | null } | undefined)?.student_id ?? null,
          fullName: error.body.message.replace(/^.*: /, ''),
        });
      } else if (error instanceof ApiError) {
        setFormError(error.body.message);
      } else {
        setFormError(t('form.error.unknown'));
      }
    } finally {
      setSaving(false);
    }
  }

  function requestClose(): void {
    if (dirty && !window.confirm(t('form.confirmDiscard'))) {
      return;
    }
    onClose();
  }

  return (
    <Drawer
      open
      title={t('students.create')}
      onClose={requestClose}
      footer={
        <>
          <Button onClick={requestClose} disabled={saving}>
            {t('form.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save(false)} disabled={saving}>
            {saving ? t('form.saving') : t('form.save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save(false);
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            void save(false);
          }
        }}
      >
        {formError !== null && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}

        <Field
          id="field-fullName"
          label={t('students.field.fullName')}
          required
          error={errors.fullName === undefined ? undefined : t('form.error.required')}
        >
          <Input
            id="field-fullName"
            value={fullName}
            aria-invalid={errors.fullName !== undefined}
            onChange={(event) => {
              setFullName(event.target.value);
              clearError('fullName');
            }}
          />
        </Field>

        <Field
          id="field-phone"
          label={t('students.field.phone')}
          required
          hint={checkingPhone ? t('common.loading') : undefined}
          error={errors.phone === undefined ? undefined : t('form.error.required')}
        >
          <Input
            id="field-phone"
            type="tel"
            placeholder="+998 __ ___-__-__"
            value={phone}
            aria-invalid={errors.phone !== undefined}
            onChange={(event) => {
              setPhone(event.target.value);
              clearError('phone');
              setDuplicate(null);
            }}
            onBlur={() => void onPhoneBlur()}
          />
        </Field>

        {duplicate !== null && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            <p>
              {t('students.duplicate.title')}: <strong>{duplicate.fullName}</strong>
            </p>
            <div className="flex gap-3">
              {duplicate.studentId !== null && (
                <Link
                  className="underline"
                  href={`/students/${duplicate.studentId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('students.duplicate.open')}
                </Link>
              )}
              <button
                type="button"
                className="underline"
                onClick={() => void save(true)}
                disabled={saving}
              >
                {t('students.duplicate.createAnyway')}
              </button>
            </div>
          </div>
        )}

        <Field
          id="field-branchId"
          label={t('students.field.branch')}
          required
          error={errors.branchId === undefined ? undefined : t('form.error.required')}
        >
          <Select
            id="field-branchId"
            value={branchId}
            aria-invalid={errors.branchId !== undefined}
            onChange={(event) => {
              setBranchId(event.target.value);
              clearError('branchId');
            }}
          >
            <option value="">{t('form.select.empty')}</option>
            {branchOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Drawer>
  );
}
