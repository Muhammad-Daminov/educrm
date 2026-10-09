import { describe, expect, it } from 'vitest';
import {
  MAX_VISIBLE_TOASTS,
  toastReducer,
  UNDO_TOAST_MS,
  type Toast,
} from '../lib/toast-store';

function toast(id: string): Toast {
  return { id, message: `message ${id}`, variant: 'info', durationMs: 5_000 };
}

describe('toastReducer', () => {
  it('puts the newest toast first', () => {
    const state = toastReducer(toastReducer([], { type: 'push', toast: toast('a') }), {
      type: 'push',
      toast: toast('b'),
    });

    expect(state.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('caps how many are on screen, dropping the oldest', () => {
    // A burst must not cover the screen or push the newest message out of
    // view below the fold.
    const state = ['a', 'b', 'c', 'd', 'e'].reduce<Toast[]>(
      (acc, id) => toastReducer(acc, { type: 'push', toast: toast(id) }),
      [],
    );

    expect(state).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(state.map((item) => item.id)).toEqual(['e', 'd', 'c']);
  });

  it('re-pushing an id replaces it rather than duplicating', () => {
    const pushed = toastReducer([], { type: 'push', toast: toast('a') });
    const state = toastReducer(pushed, {
      type: 'push',
      toast: { ...toast('a'), message: 'updated' },
    });

    expect(state).toHaveLength(1);
    expect(state[0]?.message).toBe('updated');
  });

  it('dismisses by id', () => {
    const state = ['a', 'b'].reduce<Toast[]>(
      (acc, id) => toastReducer(acc, { type: 'push', toast: toast(id) }),
      [],
    );

    expect(toastReducer(state, { type: 'dismiss', id: 'a' }).map((item) => item.id)).toEqual(['b']);
  });

  it('ignores a dismissal for an id that is already gone', () => {
    // The auto-dismiss timer and a manual close can both fire for one toast.
    const state = toastReducer([], { type: 'push', toast: toast('a') });
    const once = toastReducer(state, { type: 'dismiss', id: 'a' });

    expect(toastReducer(once, { type: 'dismiss', id: 'a' })).toEqual([]);
  });

  it('clears everything', () => {
    const state = toastReducer([], { type: 'push', toast: toast('a') });
    expect(toastReducer(state, { type: 'clear' })).toEqual([]);
  });

  it('keeps the undo window UX P1 specifies', () => {
    expect(UNDO_TOAST_MS).toBe(10_000);
  });
});
