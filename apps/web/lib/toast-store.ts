export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  /** Seconds the toast stays up; 0 keeps it until dismissed. */
  durationMs: number;
  /**
   * UX P1: "amaldan keyin 10 soniyalik 'Bekor qilish' toast" — a bulk
   * action's undo lives on the toast, which is why a toast needs to be able
   * to carry an action at all.
   */
  actionLabel?: string;
}

export const DEFAULT_TOAST_MS = 5_000;
/** UX P1's undo window for bulk actions. */
export const UNDO_TOAST_MS = 10_000;

/** Most recent first, and never more than this many on screen at once. */
export const MAX_VISIBLE_TOASTS = 3;

export type ToastAction =
  | { type: 'push'; toast: Toast }
  | { type: 'dismiss'; id: string }
  | { type: 'clear' };

/**
 * Pure reducer so the queue's behaviour — ordering, the cap, idempotent
 * dismissal — is testable without rendering anything.
 */
export function toastReducer(state: readonly Toast[], action: ToastAction): Toast[] {
  switch (action.type) {
    case 'push':
      // Newest first, oldest dropped past the cap: a burst of toasts must
      // not cover the screen or hide the newest message below the fold.
      return [action.toast, ...state.filter((toast) => toast.id !== action.toast.id)].slice(
        0,
        MAX_VISIBLE_TOASTS,
      );
    case 'dismiss':
      return state.filter((toast) => toast.id !== action.id);
    case 'clear':
      return [];
  }
}
