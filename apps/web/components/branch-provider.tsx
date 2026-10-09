'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

/** `null` means "Barcha filiallar" (UX §2.2). */
export type SelectedBranch = string | null;

interface BranchContextValue {
  branches: { id: string; name: string }[];
  selectedBranchId: SelectedBranch;
  selectBranch: (branchId: SelectedBranch) => void;
}

const BranchContext = createContext<BranchContextValue | null>(null);

export function useBranch(): BranchContextValue {
  const context = useContext(BranchContext);
  if (context === null) {
    throw new Error('useBranch must be used inside <BranchProvider>');
  }
  return context;
}

/** Scoped per user so switching accounts on one machine can't inherit it. */
function storageKey(userId: string): string {
  return `educrm.branch.${userId}`;
}

/**
 * The global branch context UX §2.2 introduces: every list and schedule
 * obeys it, which is what makes "working in the wrong branch" a mistake
 * worth designing against.
 *
 * Persisted in localStorage, not on the server. UX §2.2 wants it on the
 * user profile so it follows them across devices, but there is no settings
 * API until T05 — recorded in docs/QUESTIONS.md rather than left implicit.
 */
export function BranchProvider({
  userId,
  branches,
  children,
}: {
  userId: string;
  branches: { id: string; name: string }[];
  children: ReactNode;
}): JSX.Element {
  const [selectedBranchId, setSelectedBranchId] = useState<SelectedBranch>(null);

  // Read after mount, never during render: localStorage does not exist on
  // the server and reading it while rendering would desync hydration.
  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey(userId));
    // A stored branch the user no longer has access to must not stick —
    // their assignment may have been revoked since.
    if (stored !== null && branches.some((branch) => branch.id === stored)) {
      setSelectedBranchId(stored);
    }
  }, [userId, branches]);

  const selectBranch = useCallback(
    (branchId: SelectedBranch) => {
      setSelectedBranchId(branchId);
      if (branchId === null) {
        window.localStorage.removeItem(storageKey(userId));
        return;
      }
      window.localStorage.setItem(storageKey(userId), branchId);
    },
    [userId],
  );

  const value = useMemo(
    () => ({ branches, selectedBranchId, selectBranch }),
    [branches, selectedBranchId, selectBranch],
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}
