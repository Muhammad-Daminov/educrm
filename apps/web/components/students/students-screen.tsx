'use client';

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus, Search, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Table, TableContainer, Td, Th, Tr } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';
import { useAuth } from '@/components/auth-provider';
import { Chip } from '@/components/resource/resource-screen';
import { StudentCreateDrawer } from '@/components/students/student-create-drawer';
import { t } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
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
import { fetchActiveOptions } from '@/lib/resources';
import { fetchStudents, type StudentRow } from '@/lib/students';

const EXTRA_KEYS = ['branch_id'];

interface BranchOption {
  id: string;
  name: string;
}

function statusVariant(status: StudentRow['status']): 'success' | 'outline' | 'default' {
  if (status === 'active') {
    return 'success';
  }
  if (status === 'archived') {
    return 'outline';
  }
  return 'default';
}

/**
 * TZ M3, UX P1. Not built on `ResourceScreen`: a student's "active" is a
 * computed status enum rather than a plain `is_active` flag, and creation
 * runs the UX P6 duplicate-phone check the shared drawer has no room for —
 * the same shape of divergence `EmployeesScreen` already has.
 */
export function StudentsScreen(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { me } = useAuth();

  const params = useMemo(() => parseListParams(searchParams, EXTRA_KEYS), [searchParams]);

  const [branches, setBranches] = useState<BranchOption[] | null>(null);
  const [branchesError, setBranchesError] = useState<unknown>(null);
  const [branchesReloadToken, setBranchesReloadToken] = useState(0);

  const [rows, setRows] = useState<StudentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [searchDraft, setSearchDraft] = useState(params.q);
  const [createOpen, setCreateOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    setBranchesError(null);
    fetchActiveOptions<BranchOption>('/api/v1/branches')
      .then((options) => {
        if (!cancelled) {
          setBranches(options);
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

  useEffect(() => {
    setSearchDraft(params.q);
  }, [params.q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStudents(params)
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

  const canCreate = hasAnyPermission(me.permissions, ['student.create']);
  const canImport = hasAnyPermission(me.permissions, ['import.run']);
  const branchName = useMemo(
    () => new Map((branches ?? []).map((branch) => [branch.id, branch.name])),
    [branches],
  );
  const branchOptions = useMemo(
    () => (branches ?? []).map((branch) => ({ value: branch.id, label: branch.name })),
    [branches],
  );

  const pages = totalPages(total, params.pageSize);
  const filtered = hasActiveFilters(params);

  if (branchesError !== null) {
    return <ErrorState error={branchesError} onRetry={() => setBranchesReloadToken((token) => token + 1)} />;
  }
  if (branches === null) {
    return <LoadingState rows={5} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold">{t('students.title')}</h1>
          {!loading && error === null && (
            <span className="text-sm text-muted-foreground">
              {total} {t('list.records')}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {canImport && (
            <Link href="/students/import">
              <Button variant="secondary">
                <Upload className="size-4" aria-hidden="true" />
                {t('students.import.action')}
              </Button>
            </Link>
          )}
          {canCreate && (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {t('list.create')}
            </Button>
          )}
        </div>
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
          className="w-48"
          aria-label={t('students.filter.branch')}
          value={params.extra.branch_id ?? ''}
          onChange={(event) => navigate(withExtra(params, 'branch_id', event.target.value))}
        >
          <option value="">{t('students.filter.branch')}</option>
          {branchOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

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

        {filtered && (
          <>
            {params.q !== '' && (
              <Chip
                label={`${t('list.search')}: ${params.q}`}
                onClear={() => navigate(withFilter(params, { q: '' }))}
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
          description={filtered ? t('list.empty.filtered.description') : t('students.empty')}
          action={
            filtered ? (
              <Button onClick={() => navigate(withFilter(params, { q: '', is_active: 'true', extra: {} }))}>
                {t('list.filter.clear')}
              </Button>
            ) : canCreate ? (
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
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
                <Th>{t('students.field.fullName')}</Th>
                <Th>{t('students.field.branch')}</Th>
                <Th>{t('students.column.status')}</Th>
                <Th>{t('students.column.balance')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td className="font-medium">
                    <Link className="hover:underline" href={`/students/${row.id}`}>
                      {row.fullName}
                    </Link>
                  </Td>
                  <Td>{branchName.get(row.branchId) ?? ''}</Td>
                  <Td>
                    <Badge variant={statusVariant(row.status)}>{t(`students.status.${row.status}`)}</Badge>
                  </Td>
                  <Td>{row.cachedBalance}</Td>
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

      {createOpen && (
        <StudentCreateDrawer
          branchOptions={branchOptions}
          onClose={() => setCreateOpen(false)}
          onCreated={(student) => {
            setCreateOpen(false);
            reload();
            router.push(`/students/${student.id}`);
          }}
        />
      )}
    </div>
  );
}
