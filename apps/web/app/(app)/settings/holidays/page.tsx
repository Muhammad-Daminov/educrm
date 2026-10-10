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

interface HolidayRow extends ArchivableRow {
  name: string;
  date: string;
  branchId: string | null;
}

interface BranchOption {
  id: string;
  name: string;
}

/** TZ M1.3 "bayramlar". `branchId` null means the whole organization is
 * closed that day — see the API's `dto/holiday.dto.ts` comment. */
export default function HolidaysPage(): JSX.Element {
  const { me } = useAuth();
  const [branches, setBranches] = useState<BranchOption[] | null>(null);
  const [branchesError, setBranchesError] = useState<unknown>(null);
  const [branchesReloadToken, setBranchesReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setBranchesError(null);
    fetchActiveOptions<BranchOption>('/api/v1/branches')
      .then((rows) => {
        if (!cancelled) {
          setBranches(rows);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setBranchesError(caught);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [branchesReloadToken]);

  const canWrite = hasAnyPermission(me.permissions, ['settings.manage']);
  const branchName = useMemo(
    () => new Map((branches ?? []).map((branch) => [branch.id, branch.name])),
    [branches],
  );
  const branchOptions = useMemo(
    () => (branches ?? []).map((branch) => ({ value: branch.id, label: branch.name })),
    [branches],
  );

  const fields = useMemo<FieldDef[]>(
    () => [
      { name: 'name', labelKey: 'holidays.field.name', kind: 'text', required: true },
      { name: 'date', labelKey: 'holidays.field.date', kind: 'date', required: true },
      {
        name: 'branchId',
        labelKey: 'holidays.field.branch',
        kind: 'select',
        nullable: true,
        hintKey: 'holidays.field.branch.hint',
        options: branchOptions,
      },
    ],
    [branchOptions],
  );

  const columns = useMemo<ColumnDef<HolidayRow>[]>(
    () => [
      { key: 'name', labelKey: 'holidays.field.name', render: (row) => row.name, primary: true },
      { key: 'date', labelKey: 'holidays.column.date', render: (row) => row.date.slice(0, 10) },
      {
        key: 'branch',
        labelKey: 'holidays.column.branch',
        render: (row) =>
          row.branchId === null ? t('holidays.allBranches') : branchName.get(row.branchId) ?? '',
      },
    ],
    [branchName],
  );

  const extraFilters = useMemo<ExtraFilterDef[]>(
    () => [
      {
        key: 'branch_id',
        labelKey: 'holidays.field.branch',
        options: [{ value: 'none', label: t('holidays.allBranches') }, ...branchOptions],
      },
    ],
    [branchOptions],
  );

  if (branchesError !== null) {
    return <ErrorState error={branchesError} onRetry={() => setBranchesReloadToken((token) => token + 1)} />;
  }

  if (branches === null) {
    return <LoadingState rows={5} />;
  }

  return (
    <ResourceScreen<HolidayRow>
      titleKey="holidays.title"
      createTitleKey="holidays.create"
      editTitleKey="holidays.edit"
      path="/api/v1/holidays"
      columns={columns}
      fields={fields}
      extraFilters={extraFilters}
      canWrite={canWrite}
      emptyDescriptionKey="holidays.empty"
    />
  );
}
