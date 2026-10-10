/**
 * List screen state, in the URL — UX P1 lists "URL holatni saqlamaydi"
 * (the URL doesn't keep the state) as a defect to fix: "Filtr, saralash,
 * sahifa — URL query'da; havolani hamkasbga yuborish mumkin". So this
 * module is the single translation between a URL and a list request, and
 * it is deliberately pure so it can be tested without a browser.
 *
 * Parameter names match the API's query contract exactly (`q`,
 * `is_active`, `branch_id`, `limit`, `offset`) so a URL a user copied is
 * also, field for field, the request that produced it.
 */

export const DEFAULT_PAGE_SIZE = 25;

export type ActiveFilter = 'true' | 'false' | 'all';

export interface ListParams {
  q: string;
  is_active: ActiveFilter;
  /** Entity-specific extra filters, e.g. branch_id / discipline_id. */
  extra: Record<string, string>;
  page: number;
  pageSize: number;
}

export const EMPTY_LIST_PARAMS: ListParams = {
  q: '',
  is_active: 'true',
  extra: {},
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
};

/** Anything the URL may carry: Next's ReadonlyURLSearchParams or a plain map. */
export interface ReadableParams {
  get(key: string): string | null;
}

function parseActive(value: string | null): ActiveFilter {
  return value === 'false' || value === 'all' ? value : 'true';
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (value === null) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Reads list state out of a URL. `extraKeys` names the entity's own
 * filters; anything else in the URL is ignored rather than forwarded,
 * because the API rejects unknown query parameters and a stale link should
 * still open.
 */
export function parseListParams(
  search: ReadableParams,
  extraKeys: readonly string[] = [],
): ListParams {
  const extra: Record<string, string> = {};
  for (const key of extraKeys) {
    const value = search.get(key);
    if (value !== null && value !== '') {
      extra[key] = value;
    }
  }

  return {
    q: search.get('q') ?? '',
    is_active: parseActive(search.get('is_active')),
    extra,
    page: parsePositiveInt(search.get('page'), 1),
    pageSize: Math.min(parsePositiveInt(search.get('page_size'), DEFAULT_PAGE_SIZE), 200),
  };
}

/**
 * The URL for a given state. Defaults are omitted so the common case is a
 * clean link (`/org/branches`, not `?q=&is_active=true&page=1`) and so the
 * back button doesn't accumulate identical-looking entries.
 */
export function listParamsToSearch(params: ListParams): string {
  const search = new URLSearchParams();
  if (params.q !== '') {
    search.set('q', params.q);
  }
  if (params.is_active !== 'true') {
    search.set('is_active', params.is_active);
  }
  for (const [key, value] of Object.entries(params.extra)) {
    if (value !== '') {
      search.set(key, value);
    }
  }
  if (params.page > 1) {
    search.set('page', String(params.page));
  }
  if (params.pageSize !== DEFAULT_PAGE_SIZE) {
    search.set('page_size', String(params.pageSize));
  }
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
}

/** The API query string for the same state: page -> limit/offset. */
export function listParamsToApiQuery(params: ListParams): string {
  const search = new URLSearchParams();
  if (params.q !== '') {
    search.set('q', params.q);
  }
  search.set('is_active', params.is_active);
  for (const [key, value] of Object.entries(params.extra)) {
    if (value !== '') {
      search.set(key, value);
    }
  }
  search.set('limit', String(params.pageSize));
  search.set('offset', String((params.page - 1) * params.pageSize));
  return search.toString();
}

/**
 * Changing a filter resets to page 1. Without this, narrowing a filter
 * from page 4 lands on an empty page and reads as "no results".
 */
export function withFilter(params: ListParams, patch: Partial<ListParams>): ListParams {
  const next: ListParams = { ...params, ...patch, page: patch.page ?? 1 };
  return next;
}

export function withExtra(params: ListParams, key: string, value: string | undefined): ListParams {
  const extra = { ...params.extra };
  if (value === undefined || value === '') {
    delete extra[key];
  } else {
    extra[key] = value;
  }
  return { ...params, extra, page: 1 };
}

/** True when anything is narrowing the list — drives the "filtered empty" state. */
export function hasActiveFilters(params: ListParams): boolean {
  return params.q !== '' || params.is_active !== 'true' || Object.keys(params.extra).length > 0;
}

export function totalPages(rowCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(rowCount / pageSize));
}
