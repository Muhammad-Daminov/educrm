'use client';

import type { JSX } from 'react';
import { useAuth } from '@/components/auth-provider';
import { ResourceScreen, type ColumnDef } from '@/components/resource/resource-screen';
import { hasAnyPermission } from '@/lib/nav';
import type { FieldDef } from '@/lib/resource-form';
import type { ArchivableRow } from '@/lib/resources';

interface BranchRow extends ArchivableRow {
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  timezone: string;
}

const FIELDS: readonly FieldDef[] = [
  { name: 'name', labelKey: 'branches.field.name', kind: 'text', required: true },
  {
    name: 'code',
    labelKey: 'branches.field.code',
    kind: 'text',
    required: true,
    hintKey: 'branches.field.code.hint',
  },
  { name: 'address', labelKey: 'branches.field.address', kind: 'text', nullable: true },
  { name: 'phone', labelKey: 'branches.field.phone', kind: 'text', nullable: true },
  {
    name: 'timezone',
    labelKey: 'branches.field.timezone',
    kind: 'text',
    nullable: true,
    hintKey: 'branches.field.timezone.hint',
  },
];

const COLUMNS: readonly ColumnDef<BranchRow>[] = [
  { key: 'name', labelKey: 'branches.field.name', render: (row) => row.name, primary: true },
  { key: 'code', labelKey: 'branches.field.code', render: (row) => row.code },
  { key: 'phone', labelKey: 'branches.field.phone', render: (row) => row.phone ?? '' },
  { key: 'timezone', labelKey: 'branches.field.timezone', render: (row) => row.timezone },
];

/** TZ M1.1, UX P1/P6. Branches have no parent to filter by, so the generic
 * list screen needs nothing beyond the fields and columns above. */
export default function BranchesPage(): JSX.Element {
  const { me } = useAuth();
  const canWrite = hasAnyPermission(me.permissions, [
    'branch.create',
    'branch.update',
    'branch.archive',
  ]);

  return (
    <ResourceScreen<BranchRow>
      titleKey="branches.title"
      createTitleKey="branches.create"
      editTitleKey="branches.edit"
      path="/api/v1/branches"
      columns={COLUMNS}
      fields={FIELDS}
      canWrite={canWrite}
      emptyDescriptionKey="branches.empty"
    />
  );
}
