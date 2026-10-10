'use client';

import type { JSX } from 'react';
import { useAuth } from '@/components/auth-provider';
import { ResourceScreen, type ColumnDef } from '@/components/resource/resource-screen';
import { hasAnyPermission } from '@/lib/nav';
import type { FieldDef } from '@/lib/resource-form';
import type { ArchivableRow } from '@/lib/resources';

interface AgeCategoryRow extends ArchivableRow {
  name: string;
  minAge: number;
  maxAge: number | null;
}

const FIELDS: readonly FieldDef[] = [
  { name: 'name', labelKey: 'reference.field.name', kind: 'text', required: true },
  { name: 'minAge', labelKey: 'ageCategories.field.minAge', kind: 'number', required: true },
  {
    name: 'maxAge',
    labelKey: 'ageCategories.field.maxAge',
    kind: 'number',
    nullable: true,
    hintKey: 'ageCategories.field.maxAge.hint',
  },
  {
    name: 'sortOrder',
    labelKey: 'reference.field.sortOrder',
    kind: 'number',
    hintKey: 'reference.field.sortOrder.hint',
  },
];

const COLUMNS: readonly ColumnDef<AgeCategoryRow>[] = [
  { key: 'name', labelKey: 'reference.field.name', render: (row) => row.name, primary: true },
  {
    key: 'range',
    labelKey: 'ageCategories.column.range',
    render: (row) => (row.maxAge === null ? `${row.minAge}+` : `${row.minAge}–${row.maxAge}`),
  },
];

export default function AgeCategoriesPage(): JSX.Element {
  const { me } = useAuth();
  const canWrite = hasAnyPermission(me.permissions, ['settings.manage']);

  return (
    <ResourceScreen<AgeCategoryRow>
      titleKey="ageCategories.title"
      createTitleKey="ageCategories.create"
      editTitleKey="ageCategories.edit"
      path="/api/v1/age-categories"
      columns={COLUMNS}
      fields={FIELDS}
      canWrite={canWrite}
      emptyDescriptionKey="ageCategories.empty"
    />
  );
}
