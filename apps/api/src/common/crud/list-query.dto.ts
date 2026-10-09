import { z } from 'zod';
// The same fold `uz_search_key(text)` applies in Postgres — one definition,
// applied here to the *search term* (packages/shared/src/uz-text.ts).
import { uzSearchKey } from '@educrm/shared';

/**
 * Query parameters every T05 list endpoint accepts. Names are snake_case
 * because they are on the wire (TZ 6.1), and the UX P1 list screen puts all
 * of them in the URL ("URL holatni saqlamaydi" is listed as a defect to
 * fix) — so a filtered list is a link a colleague can open.
 *
 * `is_active` is tri-state rather than a boolean because the archive is a
 * first-class view, not an edge case: these entities are never deleted
 * (TZ M1.1/M1.3), so "archived only" is how you find something to restore.
 * The default is `true` — a list screen that shows archived rows mixed in
 * by default is the main way users end up picking a dead discipline.
 */
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;

export const listQuerySchema = z.object({
  /** Free-text name search. Folded through uz_search_key (TZ 8.5). */
  q: z.string().trim().max(200).optional(),
  is_active: z.enum(['true', 'false', 'all']).default('true'),
  limit: z.coerce.number().int().positive().max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListQueryDto = z.infer<typeof listQuerySchema>;

/** Branch filter, for the lists that have a branch dimension. */
export const branchScopedListQuerySchema = listQuerySchema.extend({
  branch_id: z.string().uuid().optional(),
});

export type BranchScopedListQueryDto = z.infer<typeof branchScopedListQuerySchema>;

/**
 * The `is_active` filter as a Prisma where fragment: `{}` for "all", so the
 * caller can spread it unconditionally.
 */
export function activeFilter(isActive: ListQueryDto['is_active']): { isActive?: boolean } {
  if (isActive === 'all') {
    return {};
  }
  return { isActive: isActive === 'true' };
}

/**
 * Name search as a Prisma where fragment over the generated `name_key`
 * column, so "oquvchi" matches "Oʻquvchi" and spacing/case/apostrophe
 * variants all collapse (TZ 8.5). `contains` rather than `startsWith`:
 * users search for the distinctive middle of a name ("204", "ingliz") at
 * least as often as the beginning.
 *
 * Returns `{}` for an empty query so it can always be spread.
 */
export function nameKeyFilter(
  q: string | undefined,
  key: 'nameKey' | 'fullNameKey' = 'nameKey',
): Record<string, { contains: string }> {
  const needle = q === undefined ? '' : uzSearchKey(q);
  if (needle.length === 0) {
    return {};
  }
  return { [key]: { contains: needle } };
}
