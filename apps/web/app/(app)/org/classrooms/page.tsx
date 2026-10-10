'use client';

import { useEffect, useMemo, useState, type JSX } from 'react';
import { useAuth } from '@/components/auth-provider';
import { ResourceScreen, type ColumnDef, type ExtraFilterDef } from '@/components/resource/resource-screen';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';
import { hasAnyPermission } from '@/lib/nav';
import type { FieldDef } from '@/lib/resource-form';
import { fetchActiveOptions, type ArchivableRow } from '@/lib/resources';

interface ClassroomRow extends ArchivableRow {
  branchId: string;
  name: string;
  capacity: number | null;
  equipment: string | null;
}

interface BranchOption {
  id: string;
  name: string;
}

/**
 * TZ M1.2, UX P1/P6. `branchId` is createOnly — see the API's
 * `updateClassroomSchema` comment: moving a room between branches would
 * relocate every lesson ever taught in it.
 */
export default function ClassroomsPage(): JSX.Element {
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

  const canWrite = hasAnyPermission(me.permissions, ['classroom.manage']);
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
      {
        name: 'branchId',
        labelKey: 'classrooms.field.branch',
        kind: 'select',
        required: true,
        createOnly: true,
        hintKey: 'classrooms.field.branch.hint',
        options: branchOptions,
      },
      { name: 'name', labelKey: 'classrooms.field.name', kind: 'text', required: true },
      {
        name: 'capacity',
        labelKey: 'classrooms.field.capacity',
        kind: 'number',
        nullable: true,
        hintKey: 'classrooms.field.capacity.hint',
      },
      { name: 'equipment', labelKey: 'classrooms.field.equipment', kind: 'textarea', nullable: true },
    ],
    [branchOptions],
  );

  const columns = useMemo<ColumnDef<ClassroomRow>[]>(
    () => [
      { key: 'name', labelKey: 'classrooms.field.name', render: (row) => row.name, primary: true },
      {
        key: 'branch',
        labelKey: 'classrooms.field.branch',
        render: (row) => branchName.get(row.branchId) ?? '',
      },
      {
        key: 'capacity',
        labelKey: 'classrooms.field.capacity',
        render: (row) => (row.capacity === null ? '' : String(row.capacity)),
      },
      { key: 'equipment', labelKey: 'classrooms.field.equipment', render: (row) => row.equipment ?? '' },
    ],
    [branchName],
  );

  const extraFilters = useMemo<ExtraFilterDef[]>(
    () => [{ key: 'branch_id', labelKey: 'classrooms.field.branch', options: branchOptions }],
    [branchOptions],
  );

  if (branchesError !== null) {
    return <ErrorState error={branchesError} onRetry={() => setBranchesReloadToken((token) => token + 1)} />;
  }

  if (branches === null) {
    return <LoadingState rows={5} />;
  }

  return (
    <ResourceScreen<ClassroomRow>
      titleKey="classrooms.title"
      createTitleKey="classrooms.create"
      editTitleKey="classrooms.edit"
      path="/api/v1/classrooms"
      columns={columns}
      fields={fields}
      extraFilters={extraFilters}
      canWrite={canWrite}
      emptyDescriptionKey="classrooms.empty"
    />
  );
}
