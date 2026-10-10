'use client';

import { useEffect, useMemo, useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { t, type TranslationKey } from '@/lib/i18n';
import {
  buildPayload,
  initialValues,
  isDirty,
  missingRequired,
  valuesFromRow,
  type FieldDef,
  type FormValues,
} from '@/lib/resource-form';
import { fieldErrorsFrom } from '@/lib/resources';
import { ApiError } from '@/lib/api';

/**
 * The UX P6 form, in a drawer:
 *
 *  - validation on blur, and on save the first offending field is focused
 *    and scrolled to ("saqlashda xatoli birinchi maydonga scroll")
 *  - server errors land on the field they name, by `code` not by message
 *    (TZ 6.2 SHART: the frontend keys off codes so it can translate)
 *  - Ctrl+Enter saves
 *  - closing with unsaved changes asks first
 *
 * Only required-ness is checked client side. Lengths, ranges, uniqueness
 * and references are the server's answer — re-implementing them here is
 * how the two definitions drift.
 */
export function ResourceFormDrawer({
  open,
  mode,
  titleKey,
  fields,
  row,
  defaults,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: 'create' | 'update';
  titleKey: TranslationKey;
  fields: readonly FieldDef[];
  /** The row being edited, for `mode === 'update'`. */
  row?: Record<string, unknown>;
  defaults?: FormValues;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}): JSX.Element {
  const startValues = useMemo<FormValues>(
    () =>
      mode === 'update' && row !== undefined
        ? valuesFromRow(fields, row)
        : initialValues(fields, defaults),
    [mode, row, fields, defaults],
  );

  const [values, setValues] = useState<FormValues>(startValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reopening the drawer for a different row must not show the previous
  // one's values or its errors.
  useEffect(() => {
    setValues(startValues);
    setErrors({});
    setFormError(null);
  }, [startValues, open]);

  const visibleFields = fields.filter(
    (field) => mode === 'create' || field.createOnly !== true,
  );

  function setValue(name: string, value: string | string[]): void {
    setValues((previous) => ({ ...previous, [name]: value }));
    // Clearing the error as the user types is what makes blur validation
    // feel like help rather than nagging.
    setErrors((previous) => {
      if (previous[name] === undefined) {
        return previous;
      }
      const next = { ...previous };
      delete next[name];
      return next;
    });
  }

  function validateOnBlur(field: FieldDef): void {
    if (field.required !== true) {
      return;
    }
    const value = values[field.name];
    const empty = Array.isArray(value) ? value.length === 0 : (value ?? '').trim() === '';
    if (empty) {
      setErrors((previous) => ({ ...previous, [field.name]: 'REQUIRED' }));
    }
  }

  async function save(): Promise<void> {
    const missing = missingRequired(visibleFields, values);
    if (missing.length > 0) {
      setErrors(Object.fromEntries(missing.map((name) => [name, 'REQUIRED'])));
      focusField(missing[0]);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await onSubmit(buildPayload(visibleFields, values, mode));
    } catch (error) {
      const fieldErrors = fieldErrorsFrom(error);
      setErrors(fieldErrors);
      const firstField = Object.keys(fieldErrors)[0];
      if (firstField !== undefined) {
        focusField(firstField);
      } else if (error instanceof ApiError) {
        // No field to blame: show it once, at the top of the form, with the
        // request id the §3.8 error state would have shown.
        setFormError(errorText(error));
      } else {
        setFormError(t('form.error.unknown'));
      }
    } finally {
      setSaving(false);
    }
  }

  const dirty = isDirty(startValues, values);

  function requestClose(): void {
    // UX P6: "saqlanmagan oʻzgarish bilan yopishda ogohlantirish".
    if (dirty && !window.confirm(t('form.confirmDiscard'))) {
      return;
    }
    onClose();
  }

  return (
    <Drawer
      open={open}
      title={t(titleKey)}
      onClose={requestClose}
      footer={
        <>
          <Button onClick={requestClose} disabled={saving}>
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
        onKeyDown={(event) => {
          // UX P6: "Saqlash Ctrl+Enter".
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            void save();
          }
        }}
      >
        {formError !== null && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}

        {visibleFields.map((field) => {
          const id = `field-${field.name}`;
          const error = errors[field.name];
          const value = values[field.name] ?? '';
          return (
            <Field
              key={field.name}
              id={id}
              label={t(field.labelKey)}
              required={field.required}
              hint={field.hintKey === undefined ? undefined : t(field.hintKey)}
              error={error === undefined ? undefined : fieldErrorText(error)}
            >
              {field.kind === 'textarea' ? (
                <Textarea
                  id={id}
                  value={typeof value === 'string' ? value : ''}
                  aria-invalid={error !== undefined}
                  onChange={(event) => setValue(field.name, event.target.value)}
                  onBlur={() => validateOnBlur(field)}
                />
              ) : field.kind === 'select' ? (
                <Select
                  id={id}
                  value={typeof value === 'string' ? value : ''}
                  aria-invalid={error !== undefined}
                  onChange={(event) => setValue(field.name, event.target.value)}
                  onBlur={() => validateOnBlur(field)}
                >
                  <option value="">{t('form.select.empty')}</option>
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              ) : field.kind === 'multiselect' ? (
                <CheckboxGroup
                  name={field.name}
                  options={field.options ?? []}
                  selected={Array.isArray(value) ? value : []}
                  onChange={(next) => setValue(field.name, next)}
                />
              ) : (
                <Input
                  id={id}
                  type={inputType(field)}
                  value={typeof value === 'string' ? value : ''}
                  placeholder={field.placeholder}
                  aria-invalid={error !== undefined}
                  onChange={(event) => setValue(field.name, event.target.value)}
                  onBlur={() => validateOnBlur(field)}
                />
              )}
            </Field>
          );
        })}
      </form>
    </Drawer>
  );
}

function CheckboxGroup({
  name,
  options,
  selected,
  onChange,
}: {
  name: string;
  options: readonly { value: string; label: string }[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}): JSX.Element {
  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('form.multiselect.empty')}</p>;
  }
  return (
    <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-md border border-input p-2">
      {options.map((option) => {
        const checked = selected.includes(option.value);
        return (
          <label key={option.value} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={name}
              value={option.value}
              checked={checked}
              className="size-4 rounded border-input"
              onChange={() =>
                onChange(
                  checked
                    ? selected.filter((value) => value !== option.value)
                    : [...selected, option.value],
                )
              }
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

function inputType(field: FieldDef): string {
  switch (field.kind) {
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'password':
      return 'password';
    default:
      return 'text';
  }
}

/**
 * Error codes, translated. Anything unrecognized falls back to a generic
 * message rather than showing a bare code to a user — but the mapping is
 * by code, never by server text (TZ 6.2).
 */
function fieldErrorText(code: string): string {
  switch (code) {
    case 'REQUIRED':
      return t('form.error.required');
    case 'DUPLICATE':
      return t('form.error.duplicate');
    case 'NOT_FOUND':
      return t('form.error.notFound');
    case 'OUT_OF_RANGE':
      return t('form.error.outOfRange');
    case 'INVALID':
      return t('form.error.invalid');
    case 'SELF':
      return t('form.error.self');
    default:
      return t('form.error.field');
  }
}

function errorText(error: ApiError): string {
  if (error.body.code === 'VERSION_CONFLICT') {
    return t('form.error.versionConflict');
  }
  if (error.status === 403) {
    return t('state.forbidden.title');
  }
  const requestId = error.body.request_id;
  return requestId === ''
    ? t('form.error.unknown')
    : `${t('form.error.unknown')} (${t('state.error.requestId')}: ${requestId})`;
}

function focusField(name: string | undefined): void {
  if (name === undefined) {
    return;
  }
  const element = document.getElementById(`field-${name}`);
  if (element instanceof HTMLElement) {
    element.scrollIntoView({ block: 'center' });
    element.focus();
  }
}
