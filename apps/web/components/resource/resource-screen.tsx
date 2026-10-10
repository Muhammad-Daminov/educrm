'use client';

import { useCallback, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Table, TableContainer, Td, Th, Tr } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';
import { useToast } from '@/components/toast-provider';
import { ResourceFormDrawer } from '@/components/resource/resource-form-drawer';
import { t, type TranslationKey } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import {
  hasActiveFilters,
  listParamsToSearch,
  parseListParams,
  totalPages,
  withExtra,
  withFilter,
  type ActiveFilter,
  type ListParams,
} from '@/lib/list-params';
import {
  archiveResource,
  createResource,
  fetchPage,
  restoreResource,
  updateResource,
  type ArchivableRow,
} from '@/lib/resources';
import type { FieldDef, SelectOption } from '@/lib/resource-form';

export interface ColumnDef<T> {
  key: string;
  labelKey: TranslationKey;
  render: (row: T) => ReactNode;
  /** The first column, shown emphasized — UX P1 "birinchi ustun — havola". */
  primary?: boolean;
}

export interface ExtraFilterDef {
  key: string;
  labelKey: TranslationKey;
  options: readonly SelectOption[];
}

export interface ResourceScreenProps<T extends ArchivableRow> {
  titleKey: TranslationKey;
  createTitleKey: TranslationKey;
  editTitleKey: TranslationKey;
  /** API path, e.g. `/api/v1/disciplines`. */
  path: string;
  columns: readonly ColumnDef<T>[];
  fields: readonly FieldDef[];
  extraFilters?: readonly ExtraFilterDef[];
  /** False for a user who may read but not change (checked server side too). */
  canWrite: boolean;
  emptyDescriptionKey?: TranslationKey;
  /** Extra per-row actions, rendered before archive/restore. */
  rowActions?: (row: T, reload: () => void) => ReactNode;
}

/**
 * The UX P1 list screen, assembled once and reused by every T05 entity:
 * header with the record count and the primary action, a filter row whose
 * state lives in the URL, the result table with a sticky header, the §3.8
 * loading/empty/filtered-empty/error states, and pagination. Creating and
 * editing happen in the P6 drawer so the list stays in context.
 *
 * Permissions only decide what is *rendered* — every one of these calls is
 * checked again on the server (CLAUDE.md: permission checks in backend
 * only). A hidden button is a courtesy, not a control.
 */
export function ResourceScreen<T extends ArchivableRow>({
  titleKey,
  createTitleKey,
  editTitleKey,
  path,
  columns,
  fields,
  extraFilters = [],
  canWrite,
  emptyDescriptionKey,
  rowActions,
}: ResourceScreenProps<T>): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  const extraKeys = useMemo(() => extraFilters.map((filter) => filter.key), [extraFilters]);
  const params = useMemo(
    () => parseListParams(searchParams, extraKeys),
    [searchParams, extraKeys],
  );

  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [searchDraft, setSearchDraft] = useState(params.q);
  const [drawer, setDrawer] = useState<{ mode: 'create' } | { mode: 'update'; row: T } | null>(
    null,
  );
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    setSearchDraft(params.q);
  }, [params.q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPage<T>(path, params)
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
  }, [path, params, reloadToken]);

  const navigate = useCallback(
    (next: ListParams) => {
      router.replace(`${pathname}${listParamsToSearch(next)}`, { scroll: false });
    },
    [router, pathname],
  );

  function submitSearch(): void {
    navigate(withFilter(params, { q: searchDraft.trim() }));
  }

  async function onSubmitForm(payload: Record<string, unknown>): Promise<void> {
    if (drawer === null) {
      return;
    }
    if (drawer.mode === 'create') {
      await createResource<T>(path, payload);
      showToast({ message: t('toast.created'), variant: 'success' });
    } else {
      await updateResource<T>(path, drawer.row.id, drawer.row.version, payload);
      showToast({ message: t('toast.saved'), variant: 'success' });
    }
    setDrawer(null);
    reload();
  }

  async function toggleArchive(row: T): Promise<void> {
    try {
      if (row.isActive) {
        await archiveResource(path, row.id, row.version);
        showToast({ message: t('toast.archived'), variant: 'success' });
      } else {
        await restoreResource(path, row.id, row.version);
        showToast({ message: t('toast.restored'), variant: 'success' });
      }
      reload();
    } catch (caught) {
      showToast({ message: archiveErrorMessage(caught), variant: 'error' });
      // A version conflict means someone else changed this row; reloading
      // is the "farqni koʻrsatish" half of UX §3.8's conflict state that a
      // list screen can offer.
      reload();
    }
  }

  const pages = totalPages(total, params.pageSize);
  const filtered = hasActiveFilters(params);

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Header: name + record count + primary action (UX P1). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold">{t(titleKey)}</h1>
          {!loading && error === null && (
            <span className="text-sm text-muted-foreground">
              {total} {t('list.records')}
            </span>
          )}
        </div>
        {canWrite && (
          <Button variant="primary" onClick={() => setDrawer({ mode: 'create' })}>
            <Plus className="size-4" aria-hidden="true" />
            {t('list.create')}
          </Button>
        )}
      </div>

      {/* 2. Filter row: chips + controls, all of it in the URL. */}
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
            navigate(withFilter(params, { is_active: event.target.value as ActiveFilter }))
          }
        >
          <option value="true">{t('list.filter.active')}</option>
          <option value="false">{t('list.filter.archived')}</option>
          <option value="all">{t('list.filter.all')}</option>
        </Select>

        {extraFilters.map((filter) => (
          <Select
            key={filter.key}
            className="w-56"
            aria-label={t(filter.labelKey)}
            value={params.extra[filter.key] ?? ''}
            onChange={(event) => navigate(withExtra(params, filter.key, event.target.value))}
          >
            <option value="">{t(filter.labelKey)}</option>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        ))}

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
            {Object.entries(params.extra).map(([key, value]) => (
              <Chip
                key={key}
                label={extraFilterLabel(extraFilters, key, value)}
                onClear={() => navigate(withExtra(params, key, undefined))}
              />
            ))}
            <Button size="sm" variant="ghost" onClick={() => navigate(withFilter(params, {
              q: '',
              is_active: 'true',
              extra: {},
            }))}>
              {t('list.filter.clear')}
            </Button>
          </>
        )}
      </div>

      {/* 3. Results, with the §3.8 states. */}
      {loading ? (
        <LoadingState rows={5} />
      ) : error !== null ? (
        <ErrorState error={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtered ? t('list.empty.filtered.title') : t('list.empty.title')}
          description={
            filtered
              ? t('list.empty.filtered.description')
              : emptyDescriptionKey === undefined
                ? undefined
                : t(emptyDescriptionKey)
          }
          action={
            filtered ? (
              <Button
                onClick={() => navigate(withFilter(params, { q: '', is_active: 'true', extra: {} }))}
              >
                {t('list.filter.clear')}
              </Button>
            ) : canWrite ? (
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
                {columns.map((column) => (
                  <Th key={column.key}>{t(column.labelKey)}</Th>
                ))}
                <Th className="w-px text-right">{t('list.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  {columns.map((column) => (
                    <Td key={column.key} className={column.primary === true ? 'font-medium' : ''}>
                      {column.render(row)}
                      {column.primary === true && !row.isActive && (
                        <Badge className="ml-2" variant="outline">
                          {t('list.badge.archived')}
                        </Badge>
                      )}
                    </Td>
                  ))}
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      {rowActions?.(row, reload)}
                      {canWrite && (
                        <>
                          <Button size="sm" onClick={() => setDrawer({ mode: 'update', row })}>
                            {t('list.edit')}
                          </Button>
                          <Button
                            size="sm"
                            variant={row.isActive ? 'danger' : 'secondary'}
                            onClick={() => void toggleArchive(row)}
                          >
                            {row.isActive ? t('list.archive') : t('list.restore')}
                          </Button>
                        </>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableContainer>
      )}

      {/* 4. Pagination. */}
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
          titleKey={drawer.mode === 'create' ? createTitleKey : editTitleKey}
          fields={fields}
          row={drawer.mode === 'update' ? drawer.row : undefined}
          onClose={() => setDrawer(null)}
          onSubmit={onSubmitForm}
        />
      )}
    </div>
  );
}

export function Chip({ label, onClear }: { label: string; onClear: () => void }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`${label} — ${t('list.filter.remove')}`}
        className="rounded-full p-0.5 hover:bg-background"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </span>
  );
}

function extraFilterLabel(
  filters: readonly ExtraFilterDef[],
  key: string,
  value: string,
): string {
  const filter = filters.find((candidate) => candidate.key === key);
  if (filter === undefined) {
    return `${key}: ${value}`;
  }
  const option = filter.options.find((candidate) => candidate.value === value);
  return `${t(filter.labelKey)}: ${option?.label ?? value}`;
}

function archiveErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.body.code === 'VERSION_CONFLICT') {
    return t('form.error.versionConflict');
  }
  if (error instanceof ApiError && error.status === 403) {
    return t('state.forbidden.title');
  }
  return t('form.error.unknown');
}
