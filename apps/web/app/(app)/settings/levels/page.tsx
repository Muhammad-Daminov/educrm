'use client';

import { useEffect, useMemo, useState, type JSX } from 'react';
import { useAuth } from '@/components/auth-provider';
import { ResourceScreen, type ColumnDef, type ExtraFilterDef } from '@/components/resource/resource-screen';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';
import { hasAnyPermission } from '@/lib/nav';
import { t } from '@/lib/i18n';
import type { FieldDef } from '@/lib/resource-form';
import { fetchActiveOptions, type ArchivableRow } from '@/lib/resources';

interface LevelRow extends ArchivableRow {
  name: string;
  disciplineId: string | null;
}

interface DisciplineOption {
  id: string;
  name: string;
}

/** TZ M1.3 "daraja". `disciplineId` null means the level applies to every
 * discipline — see the API's `dto/level.dto.ts` comment. */
export default function LevelsPage(): JSX.Element {
  const { me } = useAuth();
  const [disciplines, setDisciplines] = useState<DisciplineOption[] | null>(null);
  const [disciplinesError, setDisciplinesError] = useState<unknown>(null);
  const [disciplinesReloadToken, setDisciplinesReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDisciplinesError(null);
    fetchActiveOptions<DisciplineOption>('/api/v1/disciplines')
      .then((rows) => {
        if (!cancelled) {
          setDisciplines(rows);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setDisciplinesError(caught);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [disciplinesReloadToken]);

  const canWrite = hasAnyPermission(me.permissions, ['settings.manage']);
  const disciplineName = useMemo(
    () => new Map((disciplines ?? []).map((discipline) => [discipline.id, discipline.name])),
    [disciplines],
  );
  const disciplineOptions = useMemo(
    () => (disciplines ?? []).map((discipline) => ({ value: discipline.id, label: discipline.name })),
    [disciplines],
  );

  const fields = useMemo<FieldDef[]>(
    () => [
      { name: 'name', labelKey: 'reference.field.name', kind: 'text', required: true },
      {
        name: 'disciplineId',
        labelKey: 'levels.field.discipline',
        kind: 'select',
        nullable: true,
        hintKey: 'levels.field.discipline.hint',
        options: disciplineOptions,
      },
      {
        name: 'sortOrder',
        labelKey: 'reference.field.sortOrder',
        kind: 'number',
        hintKey: 'reference.field.sortOrder.hint',
      },
    ],
    [disciplineOptions],
  );

  const columns = useMemo<ColumnDef<LevelRow>[]>(
    () => [
      { key: 'name', labelKey: 'reference.field.name', render: (row) => row.name, primary: true },
      {
        key: 'discipline',
        labelKey: 'levels.column.discipline',
        render: (row) =>
          row.disciplineId === null
            ? t('levels.allDisciplines')
            : disciplineName.get(row.disciplineId) ?? '',
      },
    ],
    [disciplineName],
  );

  const extraFilters = useMemo<ExtraFilterDef[]>(
    () => [
      {
        key: 'discipline_id',
        labelKey: 'levels.field.discipline',
        options: [{ value: 'none', label: t('levels.allDisciplines') }, ...disciplineOptions],
      },
    ],
    [disciplineOptions],
  );

  if (disciplinesError !== null) {
    return (
      <ErrorState error={disciplinesError} onRetry={() => setDisciplinesReloadToken((token) => token + 1)} />
    );
  }

  if (disciplines === null) {
    return <LoadingState rows={5} />;
  }

  return (
    <ResourceScreen<LevelRow>
      titleKey="levels.title"
      createTitleKey="levels.create"
      editTitleKey="levels.edit"
      path="/api/v1/levels"
      columns={columns}
      fields={fields}
      extraFilters={extraFilters}
      canWrite={canWrite}
      emptyDescriptionKey="levels.empty"
    />
  );
}
