'use client';

import type { JSX } from 'react';
import { useAuth } from '@/components/auth-provider';
import { ResourceScreen, type ColumnDef } from '@/components/resource/resource-screen';
import { hasAnyPermission } from '@/lib/nav';
import type { FieldDef } from '@/lib/resource-form';
import type { ArchivableRow } from '@/lib/resources';

interface DisciplineRow extends ArchivableRow {
  name: string;
  sortOrder: number;
}

const FIELDS: readonly FieldDef[] = [
  { name: 'name', labelKey: 'reference.field.name', kind: 'text', required: true },
  {
    name: 'sortOrder',
    labelKey: 'reference.field.sortOrder',
    kind: 'number',
    hintKey: 'reference.field.sortOrder.hint',
  },
];

const COLUMNS: readonly ColumnDef<DisciplineRow>[] = [
  { key: 'name', labelKey: 'reference.field.name', render: (row) => row.name, primary: true },
  { key: 'sortOrder', labelKey: 'reference.field.sortOrder', render: (row) => String(row.sortOrder) },
];

export default function DisciplinesPage(): JSX.Element {
  const { me } = useAuth();
  const canWrite = hasAnyPermission(me.permissions, ['settings.manage']);

  return (
    <ResourceScreen<DisciplineRow>
      titleKey="disciplines.title"
      createTitleKey="disciplines.create"
      editTitleKey="disciplines.edit"
      path="/api/v1/disciplines"
      columns={COLUMNS}
      fields={FIELDS}
      canWrite={canWrite}
      emptyDescriptionKey="disciplines.empty"
    />
  );
}
