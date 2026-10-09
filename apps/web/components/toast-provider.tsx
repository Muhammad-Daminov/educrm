'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type JSX,
  type ReactNode,
} from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  DEFAULT_TOAST_MS,
  toastReducer,
  type Toast,
  type ToastVariant,
} from '@/lib/toast-store';

export interface ShowToastInput {
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastContextValue {
  showToast: (input: ShowToastInput) => string;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return context;
}

const VARIANT_CLASS: Record<ToastVariant, string> = {
  success: 'border-emerald-500/40 bg-emerald-500/10',
  error: 'border-destructive/40 bg-destructive/10',
  info: 'border-border bg-background',
};

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, dispatch] = useReducer(toastReducer, [] as Toast[]);
  const actions = useRef(new Map<string, () => void>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    actions.current.delete(id);
    dispatch({ type: 'dismiss', id });
  }, []);

  const showToast = useCallback(
    (input: ShowToastInput): string => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const durationMs = input.durationMs ?? DEFAULT_TOAST_MS;

      if (input.onAction !== undefined) {
        actions.current.set(id, input.onAction);
      }
      dispatch({
        type: 'push',
        toast: {
          id,
          message: input.message,
          variant: input.variant ?? 'info',
          durationMs,
          actionLabel: input.actionLabel,
        },
      });

      if (durationMs > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismissToast(id), durationMs),
        );
      }
      return id;
    },
    [dismissToast],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) {
        clearTimeout(timer);
      }
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        aria-live="polite" rather than "assertive": a toast reports what
        already happened, so it should wait for a pause in the screen
        reader rather than interrupt what the user is reading.
      */}
      <div
        aria-live="polite"
        aria-atomic={false}
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg',
              VARIANT_CLASS[toast.variant],
            )}
          >
            <span className="flex-1">{toast.message}</span>
            {toast.actionLabel !== undefined && (
              <button
                type="button"
                className="font-medium underline"
                onClick={() => {
                  actions.current.get(toast.id)?.();
                  dismissToast(toast.id);
                }}
              >
                {toast.actionLabel}
              </button>
            )}
            <button
              type="button"
              aria-label={t('toast.close')}
              className="text-muted-foreground"
              onClick={() => dismissToast(toast.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
