/**
 * UX §2.2 asks the branch selector to carry a colour marker, explicitly to
 * reduce the "working in the wrong branch" error. Deriving the colour from
 * the branch id (rather than storing one) means it is stable for a given
 * branch forever, with nothing to configure.
 *
 * The palette is for recognition only, never the sole carrier of meaning —
 * the branch name is always shown next to it.
 */
const BRANCH_COLORS = [
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-teal-500',
] as const;

export function branchColorClass(branchId: string): string {
  let hash = 0;
  for (const character of branchId) {
    hash = (hash * 31 + character.charCodeAt(0)) % 100_000;
  }
  return BRANCH_COLORS[hash % BRANCH_COLORS.length] ?? BRANCH_COLORS[0];
}
