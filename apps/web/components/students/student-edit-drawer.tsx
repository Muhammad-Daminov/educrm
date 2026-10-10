'use client';

import { useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { t } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import { updateStudent, type StudentRow } from '@/lib/students';

/** The student-card edit form: name, birth date, gender, blacklist — the
 * fields `students.dto.ts`'s `updateStudentSchema` accepts beyond branch
 * (branch has no UI path to change yet; nothing in T06 needs moving a
 * student between branches). */
export function StudentEditDrawer({
  student,
  onClose,
  onSaved,
}: {
  student: StudentRow;
  onClose: () => void;
  onSaved: (updated: StudentRow) => void;
}): JSX.Element {
  const [fullName, setFullName] = useState(student.fullName);
  const [birthDate, setBirthDate] = useState(student.birthDate?.slice(0, 10) ?? '');
  const [gender, setGender] = useState(student.gender ?? '');
  const [blacklisted, setBlacklisted] = useState(student.blacklisted);
  const [blacklistReason, setBlacklistReason] = useState(student.blacklistReason ?? '');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setSaving(true);
    setFormError(null);
    try {
      const updated = await updateStudent(student.id, student.version, {
        fullName: fullName.trim(),
        birthDate: birthDate === '' ? null : birthDate,
        gender: gender === '' ? null : gender,
        blacklisted,
        blacklistReason: blacklistReason.trim() === '' ? null : blacklistReason.trim(),
      });
      onSaved(updated);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.body.message : t('form.error.unknown'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      title={t('list.edit')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t('form.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? t('form.saving') : t('form.save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {formError !== null && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}

        <Field id="edit-fullName" label={t('students.field.fullName')} required>
          <Input id="edit-fullName" value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </Field>

        <Field id="edit-birthDate" label={t('students.field.birthDate')}>
          <Input
            id="edit-birthDate"
            type="date"
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
          />
        </Field>

        <Field id="edit-gender" label={t('students.field.gender')}>
          <Select id="edit-gender" value={gender} onChange={(event) => setGender(event.target.value)}>
            <option value="">{t('form.select.empty')}</option>
            <option value="male">{t('students.field.gender.male')}</option>
            <option value="female">{t('students.field.gender.female')}</option>
          </Select>
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={blacklisted}
            onChange={(event) => setBlacklisted(event.target.checked)}
          />
          {t('students.blacklist.field')}
        </label>

        {blacklisted && (
          <Field id="edit-blacklistReason" label={t('students.blacklist.reason')}>
            <Textarea
              id="edit-blacklistReason"
              value={blacklistReason}
              onChange={(event) => setBlacklistReason(event.target.value)}
            />
          </Field>
        )}
      </form>
    </Drawer>
  );
}
