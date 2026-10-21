import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerUndoToastListener, showUndoToast, type UndoToast } from './useUndoableAction';
import { notificationStore, resetNotifications } from '../components/ui/notifications/notifications';

describe('showUndoToast', () => {
  let seen: Array<UndoToast | null>;
  let unregister: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    seen = [];
    unregister = registerUndoToastListener((t) => { seen.push(t); });
  });
  afterEach(() => {
    unregister();
    resetNotifications();
    vi.useRealTimers();
  });

  const show = (undo = vi.fn(), message = 'Elemento rimosso') => {
    const done = showUndoToast({ action: () => 'result', undo, message });
    return { done, undo };
  };
  const lastToast = () => seen[seen.length - 1];

  it('runs out by itself after 5 seconds when nothing is clicked: the action stands', async () => {
    const { done } = show();
    await vi.advanceTimersByTimeAsync(0);
    expect(lastToast()?.message).toBe('Elemento rimosso');
    expect(lastToast()?.timeRemaining).toBe(5000);
    await vi.advanceTimersByTimeAsync(4999);
    expect(lastToast()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(lastToast()).toBeNull();
    await expect(done).resolves.toBe(true);
  });

  it('undone, awaits the undo and says «Ripristinato» for a moment', async () => {
    const { done, undo } = show();
    await vi.advanceTimersByTimeAsync(300);
    await lastToast()?.onUndo();
    expect(undo).toHaveBeenCalledWith('result');
    expect(lastToast()).toBeNull();
    await expect(done).resolves.toBe(false);
    const restored = notificationStore.getState().entries.find((e) => e.message === 'Ripristinato');
    expect(restored?.duration).toBe(1500);
    expect(restored?.undoable).toBe(false);
  });

  it('an undo that fails says nothing more: it reported its own failure', async () => {
    const { done } = show(vi.fn().mockRejectedValue(new Error('offline')));
    await vi.advanceTimersByTimeAsync(0);
    await lastToast()?.onUndo();
    await expect(done).resolves.toBe(false);
    expect(notificationStore.getState().entries.some((e) => e.message === 'Ripristinato')).toBe(false);
  });

  it('dismissed, keeps the action and runs no undo', async () => {
    const { done, undo } = show();
    await vi.advanceTimersByTimeAsync(300);
    lastToast()?.onDismiss();
    expect(undo).not.toHaveBeenCalled();
    expect(lastToast()).toBeNull();
    await vi.advanceTimersByTimeAsync(6000);
    await expect(done).resolves.toBe(true);
  });

  it('a second stands beside the first: each keeps its own time and its own «Annulla» (K1a)', async () => {
    const first = show(vi.fn(), 'Elemento rimosso');
    await vi.advanceTimersByTimeAsync(500);
    const second = show(vi.fn(), 'Compito completato');
    await vi.advanceTimersByTimeAsync(0);
    expect(lastToast()?.message).toBe('Compito completato');
    await lastToast()?.onUndo();
    await expect(second.done).resolves.toBe(false);
    expect(first.undo).not.toHaveBeenCalled();
    // The first is the newest «Annulla» on screen again, and runs out on its own time.
    expect(lastToast()?.message).toBe('Elemento rimosso');
    await vi.advanceTimersByTimeAsync(4500);
    await expect(first.done).resolves.toBe(true);
  });
});
