'use client';

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Table, TableContainer, Td, Th, Tr } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';
import { useAuth } from '@/components/auth-provider';
import { UnitCreateDrawer } from '@/components/units/unit-create-drawer';
import { t, type TranslationKey } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import {
  listParamsToSearch,
  parseListParams,
  totalPages,
  withExtra,
  withFilter,
  type ListParams,
} from '@/lib/list-params';
import { hasAnyPermission } from '@/lib/nav';
import { fetchActiveOptions } from '@/lib/resources';
import { fetchStudyUnits, type StudyUnitRow, type StudyUnitStatus } from '@/lib/units';

const EXTRA_KEYS = ['branch_id', 'discipline_id', 'status', 'below_min_size'];

interface BranchOption {
  id: string;
  name: string;
}
interface DisciplineOption {
  id: string;
  name: string;
}

const STATUS_CHIPS: { value: StudyUnitStatus | ''; labelKey: TranslationKey }[] = [
  { value: '', labelKey: 'units.filter.all' },
  { value: 'active', labelKey: 'units.status.active' },
  { value: 'forming', labelKey: 'units.status.forming' },
  { value: 'paused', labelKey: 'units.status.paused' },
  { value: 'finished', labelKey: 'units.status.finished' },
];

function statusVariant(status: StudyUnitStatus): 'success' | 'outline' | 'destructive' | 'default' {
  if (status === 'active') {
    return 'success';
  }
  if (status === 'cancelled') {
    return 'destructive';
  }
  if (status === 'finished') {
    return 'outline';
  }
  return 'default';
}

function fillVariant(unit: StudyUnitRow): 'success' | 'warning' | 'destructive' {
  if (unit.overCapacity) {
    return 'destructive';
  }
  if (unit.belowMinSize) {
    return 'warning';
  }
  return 'success';
}

/**
 * TZ M4.1, UX 4.3. "Jadval"/"Xona" are "—" for every row — schedule_rules
 * and lessons are T08 and do not exist yet. "Qarzdorlar" is "—" for the
 * same reason on the finance side (T11). See docs/QUESTIONS.md.
 */
export function UnitsScreen(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { me } = useAuth();

  const params = useMemo(() => parseListParams(searchParams, EXTRA_KEYS), [searchParams]);

  const [branches, setBranches] = useState<BranchOption[] | null>(null);
  const [disciplines, setDisciplines] = useState<DisciplineOption[] | null>(null);
  const [refError, setRefError] = useState<unknown>(null);
  const [refReloadToken, setRefReloadToken] = useState(0);

  const [rows, setRows] = useState<StudyUnitRow[]>([]);
  const [total, setTotal] = useState(0);
  const [belowMinSizeCount, setBelowMinSizeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    setRefError(null);
    Promise.all([
      fetchActiveOptions<BranchOption>('/api/v1/branches'),
      fetchActiveOptions<DisciplineOption>('/api/v1/disciplines'),
    ])
      .then(([branchOptions, disciplineOptions]) => {
        if (!cancelled) {
          setBranches(branchOptions);
          setDisciplines(disciplineOptions);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setRefError(caught);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refReloadToken]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStudyUnits(params)
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

  // A second, unfiltered count just for the "N tasi kam toʻldirilgan"
  // header (UX 4.3) — the main query may itself be filtered to
  // below_min_size=true, in which case `total` already is that count.
  useEffect(() => {
    if (params.extra.below_min_size === 'true') {
      setBelowMinSizeCount(total);
      return;
    }
    let cancelled = false;
    fetchStudyUnits({ ...params, extra: { ...params.extra, below_min_size: 'true' }, page: 1, pageSize: 1 })
      .then((page) => {
        if (!cancelled) {
          setBelowMinSizeCount(page.total);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [params, total]);

  const navigate = useCallback(
    (next: ListParams) => {
      router.replace(`${pathname}${listParamsToSearch(next)}`, { scroll: false });
    },
    [router, pathname],
  );

  const canCreate = hasAnyPermission(me.permissions, ['study_unit.create']);
  const branchName = useMemo(
    () => new Map((branches ?? []).map((branch) => [branch.id, branch.name])),
    [branches],
  );
  const branchOptions = useMemo(
    () => (branches ?? []).map((branch) => ({ value: branch.id, label: branch.name })),
    [branches],
  );
  const disciplineOptions = useMemo(
    () => (disciplines ?? []).map((discipline) => ({ value: discipline.id, label: discipline.name })),
    [disciplines],
  );

  const pages = totalPages(total, params.pageSize);
  const statusValue = (params.extra.status ?? '') as StudyUnitStatus | '';
  const belowMinSizeOnly = params.extra.below_min_size === 'true';

  if (refError !== null) {
    return <ErrorState error={refError} onRetry={() => setRefReloadToken((token) => token + 1)} />;
  }
  if (branches === null || disciplines === null) {
    return <LoadingState rows={5} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold">{t('units.title')}</h1>
          {!loading && error === null && (
            <span className="text-sm text-muted-foreground">
              {total} {t('units.records')}
              {belowMinSizeCount > 0 && ` · ${belowMinSizeCount} ${t('units.records.belowMinSize')}`}
            </span>
          )}
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t('units.create')}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_CHIPS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            onClick={() => navigate(withExtra(params, 'status', chip.value === '' ? undefined : chip.value))}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              statusValue === chip.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(chip.labelKey)}
          </button>
        ))}

        <Select
          className="w-44"
          aria-label={t('units.field.branch')}
          value={params.extra.branch_id ?? ''}
          onChange={(event) => navigate(withExtra(params, 'branch_id', event.target.value))}
        >
          <option value="">{t('units.field.branch')}</option>
          {branchOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <Select
          className="w-44"
          aria-label={t('units.filter.discipline')}
          value={params.extra.discipline_id ?? ''}
          onChange={(event) => navigate(withExtra(params, 'discipline_id', event.target.value))}
        >
          <option value="">{t('units.filter.discipline')}</option>
          {disciplineOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <button
          type="button"
          onClick={() =>
            navigate(withExtra(params, 'below_min_size', belowMinSizeOnly ? undefined : 'true'))
          }
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            belowMinSizeOnly
              ? 'border-amber-500 bg-amber-500 text-white'
              : 'border-border bg-background text-muted-foreground hover:text-foreground'
          }`}
        >
          {t('units.filter.belowMinSize')}
        </button>

        {(statusValue !== '' || params.extra.branch_id !== undefined || params.extra.discipline_id !== undefined || belowMinSizeOnly) && (
          <Button size="sm" variant="ghost" onClick={() => navigate(withFilter(params, { extra: {} }))}>
            {t('list.filter.clear')}
          </Button>
        )}
      </div>

      {loading ? (
        <LoadingState rows={5} />
      ) : error !== null ? (
        <ErrorState error={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('list.empty.title')}
          description={t('units.empty')}
          action={
            canCreate ? (
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                {t('units.create')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <TableContainer>
          <Table>
            <thead>
              <tr>
                <Th>{t('units.column.name')}</Th>
                <Th>{t('units.column.schedule')}</Th>
                <Th>{t('units.column.teacher')}</Th>
                <Th>{t('units.column.classroom')}</Th>
                <Th>{t('units.column.fill')}</Th>
                <Th>{t('units.column.debtors')}</Th>
                <Th>{t('units.column.status')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td className="font-medium">
                    <Link className="hover:underline" href={`/units/${row.id}`}>
                      {row.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{branchName.get(row.branchId) ?? ''}</div>
                  </Td>
                  {/* T08 owns schedule_rules/lessons — nothing to show yet. */}
                  <Td>—</Td>
                  {/* responsibleId -> employee name lookup is skipped here
                      for list performance; shown on the detail page. */}
                  <Td>—</Td>
                  <Td>—</Td>
                  <Td>
                    <Badge variant={fillVariant(row)}>
                      {row.enrolledCount}/{row.capacity}
                    </Badge>
                  </Td>
                  {/* T11 owns debtors — no finance data exists yet. */}
                  <Td>0</Td>
                  <Td>
                    <Badge variant={statusVariant(row.status)}>{t(`units.status.${row.status}`)}</Badge>
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

      {createOpen && (
        <UnitCreateDrawer
          branchOptions={branchOptions}
          disciplineOptions={disciplineOptions}
          onClose={() => setCreateOpen(false)}
          onCreated={(unit) => {
            setCreateOpen(false);
            reload();
            router.push(`/units/${unit.id}`);
          }}
        />
      )}
    </div>
  );
}
