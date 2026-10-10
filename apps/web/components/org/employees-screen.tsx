'use client';

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Table, TableContainer, Td, Th, Tr } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';
import { useToast } from '@/components/toast-provider';
import { useAuth } from '@/components/auth-provider';
import { ResourceFormDrawer } from '@/components/resource/resource-form-drawer';
import { Chip } from '@/components/resource/resource-screen';
import { t } from '@/lib/i18n';
import { ApiError, apiFetch } from '@/lib/api';
import {
  hasActiveFilters,
  listParamsToSearch,
  parseListParams,
  totalPages,
  withExtra,
  withFilter,
  type ListParams,
} from '@/lib/list-params';
import { hasAnyPermission } from '@/lib/nav';
import {
  actionResource,
  createResource,
  fetchActiveOptions,
  fetchPage,
  updateResource,
} from '@/lib/resources';
import type { FieldDef, FormValues } from '@/lib/resource-form';

const EMPLOYEES_PATH = '/api/v1/employees';
const EXTRA_KEYS = ['role_code', 'branch_id'];

interface EmployeeRow {
  [key: string]: unknown;
  id: string;
  isActive: boolean;
  version: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  roles: { code: string; name: string }[];
  branches: { id: string; name: string }[];
  teacherProfile: {
    id: string;
    notes: string | null;
    disciplineIds: string[];
    levelIds: string[];
  } | null;
}

interface NamedOption {
  id: string;
  name: string;
}

interface RoleOption {
  code: string;
  name: string;
}

interface ReferenceData {
  roles: RoleOption[];
  branches: NamedOption[];
  disciplines: NamedOption[];
  levels: NamedOption[];
}

type SubDrawer =
  | { kind: 'roles'; row: EmployeeRow }
  | { kind: 'branches'; row: EmployeeRow }
  | { kind: 'teacher'; row: EmployeeRow };

/**
 * TZ M1.4, UX P1/P6. Not built on `ResourceScreen`: an employee is
 * deactivated/activated rather than archived/restored, and roles, branches
 * and the teacher profile are their own PUT sub-resources rather than form
 * fields — see `EmployeesService`'s comment for why the backend keeps this
 * off the shared CRUD policy. The list, filter row and pagination below
 * are deliberately the same shape as `ResourceScreen`'s so the two screens
 * feel identical to use.
 */
export function EmployeesScreen(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { me } = useAuth();

  const params = useMemo(() => parseListParams(searchParams, EXTRA_KEYS), [searchParams]);

  const [refData, setRefData] = useState<ReferenceData | null>(null);
  const [refDataError, setRefDataError] = useState<unknown>(null);
  const [refDataReloadToken, setRefDataReloadToken] = useState(0);
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [searchDraft, setSearchDraft] = useState(params.q);
  const [drawer, setDrawer] = useState<{ mode: 'create' } | { mode: 'update'; row: EmployeeRow } | null>(
    null,
  );
  const [subDrawer, setSubDrawer] = useState<SubDrawer | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    setRefDataError(null);
    Promise.all([
      apiFetch<RoleOption[]>('/api/v1/roles'),
      fetchActiveOptions<NamedOption>('/api/v1/branches'),
      fetchActiveOptions<NamedOption>('/api/v1/disciplines'),
      fetchActiveOptions<NamedOption>('/api/v1/levels'),
    ])
      .then(([roles, branches, disciplines, levels]) => {
        if (!cancelled) {
          setRefData({ roles, branches, disciplines, levels });
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setRefDataError(caught);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refDataReloadToken]);

  useEffect(() => {
    setSearchDraft(params.q);
  }, [params.q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPage<EmployeeRow>(EMPLOYEES_PATH, params)
      .then((page) => {
        if (cancelled) {
          return;
        }
        setRows(page.rows);
        setTotal(page.total);
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }
        setError(caught instanceof ApiError ? caught : null);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params, reloadToken]);

  const navigate = useCallback(
    (next: ListParams) => {
      router.replace(`${pathname}${listParamsToSearch(next)}`, { scroll: false });
    },
    [router, pathname],
  );

  function submitSearch(): void {
    navigate(withFilter(params, { q: searchDraft.trim() }));
  }

  const canCreate = hasAnyPermission(me.permissions, ['employee.create']);
  const canEdit = hasAnyPermission(me.permissions, ['employee.update']);
  const canDeactivate = hasAnyPermission(me.permissions, ['employee.deactivate']);
  const canManageRoles = hasAnyPermission(me.permissions, ['role.manage']);

  const roleOptions = useMemo(
    () => (refData?.roles ?? []).map((role) => ({ value: role.code, label: role.name })),
    [refData],
  );
  const branchOptions = useMemo(
    () => (refData?.branches ?? []).map((branch) => ({ value: branch.id, label: branch.name })),
    [refData],
  );
  const disciplineOptions = useMemo(
    () => (refData?.disciplines ?? []).map((discipline) => ({ value: discipline.id, label: discipline.name })),
    [refData],
  );
  const levelOptions = useMemo(
    () => (refData?.levels ?? []).map((level) => ({ value: level.id, label: level.name })),
    [refData],
  );
  const roleName = useMemo(
    () => new Map((refData?.roles ?? []).map((role) => [role.code, role.name])),
    [refData],
  );

  const employeeFields = useMemo<FieldDef[]>(
    () => [
      { name: 'fullName', labelKey: 'employees.field.fullName', kind: 'text', required: true },
      {
        name: 'phone',
        labelKey: 'employees.field.phone',
        kind: 'text',
        nullable: true,
        hintKey: 'employees.field.phone.hint',
      },
      { name: 'email', labelKey: 'employees.field.email', kind: 'text', nullable: true },
      {
        name: 'password',
        labelKey: 'employees.field.password',
        kind: 'password',
        required: true,
        createOnly: true,
        hintKey: 'employees.field.password.hint',
      },
      {
        name: 'roleCodes',
        labelKey: 'employees.roles.field',
        kind: 'multiselect',
        createOnly: true,
        options: roleOptions,
      },
      {
        name: 'branchIds',
        labelKey: 'employees.branches.field',
        kind: 'multiselect',
        createOnly: true,
        options: branchOptions,
      },
    ],
    [roleOptions, branchOptions],
  );

  const rolesFields = useMemo<FieldDef[]>(
    () => [{ name: 'roleCodes', labelKey: 'employees.roles.field', kind: 'multiselect', options: roleOptions }],
    [roleOptions],
  );
  const branchesFields = useMemo<FieldDef[]>(
    () => [{ name: 'branchIds', labelKey: 'employees.branches.field', kind: 'multiselect', options: branchOptions }],
    [branchOptions],
  );
  const teacherFields = useMemo<FieldDef[]>(
    () => [
      {
        name: 'disciplineIds',
        labelKey: 'employees.teacher.disciplines',
        kind: 'multiselect',
        options: disciplineOptions,
      },
      { name: 'levelIds', labelKey: 'employees.teacher.levels', kind: 'multiselect', options: levelOptions },
      { name: 'notes', labelKey: 'employees.teacher.notes', kind: 'textarea', nullable: true },
    ],
    [disciplineOptions, levelOptions],
  );

  async function onSubmitEmployeeForm(payload: Record<string, unknown>): Promise<void> {
    if (drawer === null) {
      return;
    }
    if (drawer.mode === 'create') {
      await createResource<EmployeeRow>(EMPLOYEES_PATH, payload);
      showToast({ message: t('toast.created'), variant: 'success' });
    } else {
      await updateResource<EmployeeRow>(EMPLOYEES_PATH, drawer.row.id, drawer.row.version, payload);
      showToast({ message: t('toast.saved'), variant: 'success' });
    }
    setDrawer(null);
    reload();
  }

  async function onSubmitSubDrawer(payload: Record<string, unknown>): Promise<void> {
    if (subDrawer === null) {
      return;
    }
    const suffix =
      subDrawer.kind === 'roles' ? 'roles' : subDrawer.kind === 'branches' ? 'branches' : 'teacher-profile';
    await actionResource<EmployeeRow>(`${EMPLOYEES_PATH}/${subDrawer.row.id}/${suffix}`, 'PUT', payload);
    showToast({ message: t('toast.saved'), variant: 'success' });
    setSubDrawer(null);
    reload();
  }

  async function toggleActive(row: EmployeeRow): Promise<void> {
    if (row.isActive && !window.confirm(t('employees.deactivate.confirm'))) {
      return;
    }
    try {
      const action = row.isActive ? 'deactivate' : 'activate';
      await actionResource<EmployeeRow>(`${EMPLOYEES_PATH}/${row.id}/${action}`, 'POST', undefined, row.version);
      showToast({ message: t(row.isActive ? 'toast.deactivated' : 'toast.activated'), variant: 'success' });
      reload();
    } catch (caught) {
      showToast({ message: employeeErrorMessage(caught), variant: 'error' });
      reload();
    }
  }

  const pages = totalPages(total, params.pageSize);
  const filtered = hasActiveFilters(params);

  if (refDataError !== null) {
    return <ErrorState error={refDataError} onRetry={() => setRefDataReloadToken((token) => token + 1)} />;
  }

  if (refData === null) {
    return <LoadingState rows={5} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold">{t('employees.title')}</h1>
          {!loading && error === null && (
            <span className="text-sm text-muted-foreground">
              {total} {t('list.records')}
            </span>
          )}
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setDrawer({ mode: 'create' })}>
            <Plus className="size-4" aria-hidden="true" />
            {t('list.create')}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="w-64 pl-8"
            type="search"
            value={searchDraft}
            aria-label={t('list.search')}
            placeholder={t('list.search')}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submitSearch();
              }
            }}
            onBlur={submitSearch}
          />
        </div>

        <Select
          className="w-44"
          aria-label={t('list.filter.status')}
          value={params.is_active}
          onChange={(event) =>
            navigate(withFilter(params, { is_active: event.target.value as ListParams['is_active'] }))
          }
        >
          <option value="true">{t('list.filter.active')}</option>
          <option value="false">{t('list.filter.archived')}</option>
          <option value="all">{t('list.filter.all')}</option>
        </Select>

        <Select
          className="w-48"
          aria-label={t('employees.filter.role')}
          value={params.extra.role_code ?? ''}
          onChange={(event) => navigate(withExtra(params, 'role_code', event.target.value))}
        >
          <option value="">{t('employees.filter.role')}</option>
          {roleOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <Select
          className="w-48"
          aria-label={t('employees.filter.branch')}
          value={params.extra.branch_id ?? ''}
          onChange={(event) => navigate(withExtra(params, 'branch_id', event.target.value))}
        >
          <option value="">{t('employees.filter.branch')}</option>
          {branchOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        {filtered && (
          <>
            {params.q !== '' && (
              <Chip
                label={`${t('list.search')}: ${params.q}`}
                onClear={() => navigate(withFilter(params, { q: '' }))}
              />
            )}
            {params.is_active !== 'true' && (
              <Chip
                label={
                  params.is_active === 'false' ? t('list.filter.archived') : t('list.filter.all')
                }
                onClear={() => navigate(withFilter(params, { is_active: 'true' }))}
              />
            )}
            {params.extra.role_code !== undefined && (
              <Chip
                label={`${t('employees.filter.role')}: ${roleName.get(params.extra.role_code) ?? params.extra.role_code}`}
                onClear={() => navigate(withExtra(params, 'role_code', undefined))}
              />
            )}
            {params.extra.branch_id !== undefined && (
              <Chip
                label={`${t('employees.filter.branch')}: ${
                  (refData.branches.find((branch) => branch.id === params.extra.branch_id) ?? {}).name ??
                  params.extra.branch_id
                }`}
                onClear={() => navigate(withExtra(params, 'branch_id', undefined))}
              />
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate(withFilter(params, { q: '', is_active: 'true', extra: {} }))}
            >
              {t('list.filter.clear')}
            </Button>
          </>
        )}
      </div>

      {loading ? (
        <LoadingState rows={5} />
      ) : error !== null ? (
        <ErrorState error={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtered ? t('list.empty.filtered.title') : t('list.empty.title')}
          description={filtered ? t('list.empty.filtered.description') : t('employees.empty')}
          action={
            filtered ? (
              <Button onClick={() => navigate(withFilter(params, { q: '', is_active: 'true', extra: {} }))}>
                {t('list.filter.clear')}
              </Button>
            ) : canCreate ? (
              <Button variant="primary" onClick={() => setDrawer({ mode: 'create' })}>
                {t('list.create')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <TableContainer>
          <Table>
            <thead>
              <tr>
                <Th>{t('employees.field.fullName')}</Th>
                <Th>{t('employees.column.login')}</Th>
                <Th>{t('employees.column.roles')}</Th>
                <Th>{t('employees.column.branches')}</Th>
                <Th>{t('employees.column.status')}</Th>
                <Th className="w-px text-right">{t('list.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td className="font-medium">{row.fullName}</Td>
                  <Td>{row.phone ?? row.email ?? ''}</Td>
                  <Td>{row.roles.map((role) => role.name).join(', ')}</Td>
                  <Td>{row.branches.map((branch) => branch.name).join(', ')}</Td>
                  <Td>
                    <Badge variant={row.isActive ? 'success' : 'outline'}>
                      {t(row.isActive ? 'employees.status.active' : 'employees.status.inactive')}
                    </Badge>
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      {canManageRoles && (
                        <Button size="sm" onClick={() => setSubDrawer({ kind: 'roles', row })}>
                          {t('employees.action.roles')}
                        </Button>
                      )}
                      {canEdit && (
                        <Button size="sm" onClick={() => setSubDrawer({ kind: 'branches', row })}>
                          {t('employees.action.branches')}
                        </Button>
                      )}
                      {canEdit && (
                        <Button size="sm" onClick={() => setSubDrawer({ kind: 'teacher', row })}>
                          {t('employees.action.teacherProfile')}
                        </Button>
                      )}
                      {canEdit && (
                        <Button size="sm" onClick={() => setDrawer({ mode: 'update', row })}>
                          {t('list.edit')}
                        </Button>
                      )}
                      {canDeactivate && (
                        <Button
                          size="sm"
                          variant={row.isActive ? 'danger' : 'secondary'}
                          disabled={row.id === me.user.id}
                          onClick={() => void toggleActive(row)}
                        >
                          {t(row.isActive ? 'employees.action.deactivate' : 'employees.action.activate')}
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableContainer>
      )}

      {pages > 1 && error === null && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button
            size="sm"
            disabled={params.page <= 1}
            onClick={() => navigate({ ...params, page: params.page - 1 })}
          >
            {t('list.previous')}
          </Button>
          <span className="text-muted-foreground">
            {params.page} / {pages}
          </span>
          <Button
            size="sm"
            disabled={params.page >= pages}
            onClick={() => navigate({ ...params, page: params.page + 1 })}
          >
            {t('list.next')}
          </Button>
        </div>
      )}

      {drawer !== null && (
        <ResourceFormDrawer
          open
          mode={drawer.mode}
          titleKey={drawer.mode === 'create' ? 'employees.create' : 'employees.edit'}
          fields={employeeFields}
          row={drawer.mode === 'update' ? drawer.row : undefined}
          onClose={() => setDrawer(null)}
          onSubmit={onSubmitEmployeeForm}
        />
      )}

      {subDrawer !== null && (
        <ResourceFormDrawer
          open
          mode="update"
          titleKey={
            subDrawer.kind === 'roles'
              ? 'employees.roles.title'
              : subDrawer.kind === 'branches'
                ? 'employees.branches.title'
                : 'employees.teacher.title'
          }
          fields={subDrawer.kind === 'roles' ? rolesFields : subDrawer.kind === 'branches' ? branchesFields : teacherFields}
          row={subDrawerRow(subDrawer)}
          onClose={() => setSubDrawer(null)}
          onSubmit={onSubmitSubDrawer}
        />
      )}
    </div>
  );
}

function subDrawerRow(drawer: SubDrawer): FormValues {
  if (drawer.kind === 'roles') {
    return { roleCodes: drawer.row.roles.map((role) => role.code) };
  }
  if (drawer.kind === 'branches') {
    return { branchIds: drawer.row.branches.map((branch) => branch.id) };
  }
  return {
    disciplineIds: drawer.row.teacherProfile?.disciplineIds ?? [],
    levelIds: drawer.row.teacherProfile?.levelIds ?? [],
    notes: drawer.row.teacherProfile?.notes ?? '',
  };
}

function employeeErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.body.code === 'VERSION_CONFLICT') {
    return t('form.error.versionConflict');
  }
  if (error instanceof ApiError && error.status === 403) {
    return t('state.forbidden.title');
  }
  return t('form.error.unknown');
}
