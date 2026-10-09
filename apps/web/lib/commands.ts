import { uzSearchKey } from '@educrm/shared';
import type { NavItem } from '@/lib/nav';
import { t, type TranslationKey } from '@/lib/i18n';

export interface Command {
  id: string;
  labelKey: TranslationKey;
  /** Resolved label, so matching doesn't re-translate on every keystroke. */
  label: string;
  href: string;
  /** Parent section label, shown as context for a child entry. */
  groupLabel?: string;
}

/**
 * Navigation commands for the Ctrl+K palette, derived from the menu the
 * user can actually see. That is what satisfies UX §2.4's "ruxsatsiz
 * amallar koʻrinmaydi" — the palette cannot offer more than the sidebar
 * does, because it is built from the same filtered tree.
 *
 * R0 is navigation only; the action commands UX §2.4 describes ("yangi
 * oʻquvchi", "toʻlov qabul qilish") arrive with the screens that can
 * perform them.
 */
export function buildCommands(menu: readonly NavItem[]): Command[] {
  const commands: Command[] = [];

  for (const section of menu) {
    commands.push({
      id: section.href,
      labelKey: section.labelKey,
      label: t(section.labelKey),
      href: section.href,
    });
    for (const child of section.children ?? []) {
      commands.push({
        id: child.href,
        labelKey: child.labelKey,
        label: t(child.labelKey),
        href: child.href,
        groupLabel: t(section.labelKey),
      });
    }
  }

  return commands;
}

/**
 * Subsequence ("fuzzy") match: every character of the query must appear in
 * order, not necessarily adjacently. "dav" finds "Davomat", and "oqv" finds
 * "Oʻquvchilar" without the mark — `uzSearchKey` (TZ 8.5) folds case,
 * diacritics and every apostrophe variant away first, which matters because
 * the mark in `oʻ`/`gʻ` is the character users are least likely to type
 * (UX §8 wants it *rendered* correctly, not typed).
 */
function fuzzyScore(query: string, label: string): number | null {
  const needle = uzSearchKey(query);
  const haystack = uzSearchKey(label);

  if (needle.length === 0) {
    return 0;
  }

  // A prefix match is what the user almost always means; rank it first.
  if (haystack.startsWith(needle)) {
    return 0;
  }

  let position = 0;
  let firstMatch = -1;
  let gaps = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, position);
    if (found === -1) {
      return null;
    }
    if (firstMatch === -1) {
      firstMatch = found;
    } else {
      gaps += found - position;
    }
    position = found + 1;
  }

  // Lower is better: prefer early, tightly-packed matches.
  return 1 + firstMatch + gaps;
}

/**
 * Filters and ranks commands for a query. An empty query returns everything
 * in menu order, which is the palette's "just opened" state.
 */
export function filterCommands(query: string, commands: readonly Command[]): Command[] {
  const scored: { command: Command; score: number; index: number }[] = [];

  commands.forEach((command, index) => {
    const haystack =
      command.groupLabel === undefined ? command.label : `${command.groupLabel} ${command.label}`;
    const score = fuzzyScore(query, haystack);
    if (score !== null) {
      scored.push({ command, score, index });
    }
  });

  return scored
    // Menu order breaks score ties, so the list never reshuffles arbitrarily.
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map((entry) => entry.command);
}
