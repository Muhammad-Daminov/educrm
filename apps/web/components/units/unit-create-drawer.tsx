'use client';

import { useEffect, useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { t } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import { fetchActiveOptions } from '@/lib/resources';
import { createStudyUnit, type StudyUnitRow, type StudyUnitType } from '@/lib/units';

interface Option {
  id: string;
  name: string;
}

/**
 * Single-step create form (TZ M4.1) — no schedule-preview step: T08 owns
 * schedule_rules/lessons and that step doesn't exist yet in R0 (see the
 * task scope note in docs/QUESTIONS.md). `name` left blank auto-generates
 * from discipline + level, matching the "B1 Backend" style in
 * docs/design/05-groups.png.
 */
export function UnitCreateDrawer({
  branchOptions,
  disciplineOptions,
  onClose,
  onCreated,
}: {
  branchOptions: readonly { value: string; label: string }[];
  disciplineOptions: readonly { value: string; label: string }[];
  onClose: () => void;
  onCreated: (unit: StudyUnitRow) => void;
}): JSX.Element {
  const [branchId, setBranchId] = useState('');
  const [disciplineId, setDisciplineId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [ageCategoryId, setAgeCategoryId] = useState('');
  const [type, setType] = useState<StudyUnitType>('group');
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('12');
  const [minSize, setMinSize] = useState('6');
  const [responsibleId, setResponsibleId] = useState('');
  const [color, setColor] = useState('#2563eb');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [levels, setLevels] = useState<Option[]>([]);
  const [ageCategories, setAgeCategories] = useState<Option[]>([]);
  const [employees, setEmployees] = useState<Option[]>([]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const dirty = disciplineId !== '' || name !== '';

  useEffect(() => {
    Promise.all([
      fetchActiveOptions<Option>('/api/v1/levels'),
      fetchActiveOptions<Option>('/api/v1/age-categories'),
      fetchActiveOptions<{ id: string; fullName: string }>('/api/v1/employees'),
    ])
      .then(([levelRows, ageCategoryRows, employeeRows]) => {
        setLevels(levelRows);
        setAgeCategories(ageCategoryRows);
        setEmployees(employeeRows.map((row) => ({ id: row.id, name: row.fullName })));
      })
      .catch(() => {
        // Reference pickers fail soft — the form still works with free
        // text where possible; branch/discipline are the only hard
        // requirements and are passed in already loaded.
      });
  }, []);

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

  async function save(): Promise<void> {
    const missing: Record<string, string> = {};
    if (branchId === '') {
      missing.branchId = 'REQUIRED';
    }
    if (disciplineId === '') {
      missing.disciplineId = 'REQUIRED';
    }
    const capacityNum = Number.parseInt(capacity, 10);
    const minSizeNum = Number.parseInt(minSize, 10);
    if (!Number.isInteger(capacityNum) || capacityNum <= 0) {
      missing.capacity = 'INVALID';
    }
    if (!Number.isInteger(minSizeNum) || minSizeNum < 0) {
      missing.minSize = 'INVALID';
    }
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const created = await createStudyUnit({
        branchId,
        disciplineId,
        levelId: levelId === '' ? null : levelId,
        ageCategoryId: ageCategoryId === '' ? null : ageCategoryId,
        type,
        name: name.trim() === '' ? null : name.trim(),
        capacity: capacityNum,
        minSize: minSizeNum,
        responsibleId: responsibleId === '' ? null : responsibleId,
        color: color === '' ? null : color,
        startDate: startDate === '' ? null : startDate,
        endDate: endDate === '' ? null : endDate,
      });
      onCreated(created);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.body.message : t('form.error.unknown'));
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
      title={t('units.create')}
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
      >
        {formError !== null && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}

        <Field
          id="field-branchId"
          label={t('units.field.branch')}
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

        <Field
          id="field-disciplineId"
          label={t('units.field.discipline')}
          required
          error={errors.disciplineId === undefined ? undefined : t('form.error.required')}
        >
          <Select
            id="field-disciplineId"
            value={disciplineId}
            aria-invalid={errors.disciplineId !== undefined}
            onChange={(event) => {
              setDisciplineId(event.target.value);
              clearError('disciplineId');
            }}
          >
            <option value="">{t('form.select.empty')}</option>
            {disciplineOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="field-levelId" label={t('units.field.level')}>
          <Select id="field-levelId" value={levelId} onChange={(event) => setLevelId(event.target.value)}>
            <option value="">{t('form.select.empty')}</option>
            {levels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="field-ageCategoryId" label={t('units.field.ageCategory')}>
          <Select
            id="field-ageCategoryId"
            value={ageCategoryId}
            onChange={(event) => setAgeCategoryId(event.target.value)}
          >
            <option value="">{t('form.select.empty')}</option>
            {ageCategories.map((ageCategory) => (
              <option key={ageCategory.id} value={ageCategory.id}>
                {ageCategory.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="field-type" label={t('units.field.type')} required>
          <Select
            id="field-type"
            value={type}
            onChange={(event) => setType(event.target.value as StudyUnitType)}
          >
            <option value="group">{t('units.field.type.group')}</option>
            <option value="mini_group">{t('units.field.type.mini_group')}</option>
            <option value="individual">{t('units.field.type.individual')}</option>
          </Select>
        </Field>

        <Field id="field-name" label={t('units.field.name')} hint={t('units.field.name.hint')}>
          <Input id="field-name" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field
            id="field-capacity"
            label={t('units.field.capacity')}
            required
            error={errors.capacity === undefined ? undefined : t('form.error.outOfRange')}
          >
            <Input
              id="field-capacity"
              type="number"
              min={1}
              value={capacity}
              aria-invalid={errors.capacity !== undefined}
              onChange={(event) => {
                setCapacity(event.target.value);
                clearError('capacity');
              }}
            />
          </Field>
          <Field
            id="field-minSize"
            label={t('units.field.minSize')}
            required
            error={errors.minSize === undefined ? undefined : t('form.error.outOfRange')}
          >
            <Input
              id="field-minSize"
              type="number"
              min={0}
              value={minSize}
              aria-invalid={errors.minSize !== undefined}
              onChange={(event) => {
                setMinSize(event.target.value);
                clearError('minSize');
              }}
            />
          </Field>
        </div>

        <Field id="field-responsibleId" label={t('units.field.responsible')}>
          <Select
            id="field-responsibleId"
            value={responsibleId}
            onChange={(event) => setResponsibleId(event.target.value)}
          >
            <option value="">{t('form.select.empty')}</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="field-color" label={t('units.field.color')}>
          <Input
            id="field-color"
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="h-10 w-20 p-1"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field id="field-startDate" label={t('units.field.startDate')}>
            <Input
              id="field-startDate"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Field>
          <Field id="field-endDate" label={t('units.field.endDate')}>
            <Input
              id="field-endDate"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </Field>
        </div>
      </form>
    </Drawer>
  );
}
