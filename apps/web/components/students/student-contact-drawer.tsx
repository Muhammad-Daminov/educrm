'use client';

import { useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { t } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import {
  createContactPerson,
  updateContactPerson,
  type ContactPersonRow,
} from '@/lib/students';

/** Create or edit one contact person (TZ M3.1 "aloqa shaxslari"). Small
 * enough, and different enough from the generic resource form (no
 * archive/restore, a plain hard delete lives on the row instead), that it
 * isn't built on `ResourceFormDrawer`. */
export function StudentContactDrawer({
  studentId,
  contact,
  onClose,
  onSaved,
}: {
  studentId: string;
  contact?: ContactPersonRow;
  onClose: () => void;
  onSaved: (row: ContactPersonRow) => void;
}): JSX.Element {
  const [fullName, setFullName] = useState(contact?.fullName ?? '');
  const [relation, setRelation] = useState(contact?.relation ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [isBillRecipient, setIsBillRecipient] = useState(contact?.isBillRecipient ?? false);
  const [receivesNotifications, setReceivesNotifications] = useState(
    contact?.receivesNotifications ?? true,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function save(): Promise<void> {
    const missing: Record<string, string> = {};
    if (fullName.trim() === '') {
      missing.fullName = 'REQUIRED';
    }
    if (relation.trim() === '') {
      missing.relation = 'REQUIRED';
    }
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return;
    }

    setSaving(true);
    setFormError(null);
    const body = {
      fullName: fullName.trim(),
      relation: relation.trim(),
      phone: phone.trim() === '' ? null : phone.trim(),
      email: email.trim() === '' ? null : email.trim(),
      isBillRecipient,
      receivesNotifications,
    };
    try {
      const saved =
        contact === undefined
          ? await createContactPerson(studentId, body)
          : await updateContactPerson(studentId, contact.id, contact.version, body);
      onSaved(saved);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.body.message : t('form.error.unknown'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      title={t('students.contacts.add')}
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

        <Field
          id="contact-fullName"
          label={t('students.contacts.field.fullName')}
          required
          error={errors.fullName === undefined ? undefined : t('form.error.required')}
        >
          <Input
            id="contact-fullName"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </Field>

        <Field
          id="contact-relation"
          label={t('students.contacts.field.relation')}
          required
          error={errors.relation === undefined ? undefined : t('form.error.required')}
        >
          <Input
            id="contact-relation"
            value={relation}
            onChange={(event) => setRelation(event.target.value)}
          />
        </Field>

        <Field id="contact-phone" label={t('students.contacts.field.phone')}>
          <Input id="contact-phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
        </Field>

        <Field id="contact-email" label={t('students.contacts.field.email')}>
          <Input
            id="contact-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isBillRecipient}
            onChange={(event) => setIsBillRecipient(event.target.checked)}
          />
          {t('students.contacts.field.isBillRecipient')}
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={receivesNotifications}
            onChange={(event) => setReceivesNotifications(event.target.checked)}
          />
          {t('students.contacts.field.receivesNotifications')}
        </label>
      </form>
    </Drawer>
  );
}
