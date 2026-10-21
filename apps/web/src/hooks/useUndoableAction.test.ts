import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerUndoToastListener, showUndoToast, type UndoToast } from './useUndoableAction';

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
    vi.useRealTimers();
  });

  const show = (undo = vi.fn()) => {
    const done = showUndoToast({ action: () => 'result', undo, message: 'Elemento rimosso' });
    return { done, undo };
  };
  const lastToast = () => seen[seen.length - 1];

  it('counts down and dismisses by itself when nothing is clicked', async () => {
    const { done } = show();
    await vi.advanceTimersByTimeAsync(0);
    expect(lastToast()?.message).toBe('Elemento rimosso');
    expect(lastToast()?.timeRemaining).toBe(5000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(lastToast()?.timeRemaining).toBe(4000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(lastToast()).toBeNull();
    await expect(done).resolves.toBe(true);
  });

  it('says nothing more once undone: no ghost toast after the listener got null', async () => {
    const { done, undo } = show();
    await vi.advanceTimersByTimeAsync(300);
    await lastToast()?.onUndo();
    expect(undo).toHaveBeenCalledWith('result');
    expect(lastToast()).toBeNull();
    const count = seen.length;
    await vi.advanceTimersByTimeAsync(200);
    expect(seen).toHaveLength(count);
    await vi.advanceTimersByTimeAsync(6000);
    expect(seen).toHaveLength(count);
    await expect(done).resolves.toBe(false);
  });

  it('says nothing more once dismissed: no ghost toast after the listener got null', async () => {
    const { done, undo } = show();
    await vi.advanceTimersByTimeAsync(300);
    lastToast()?.onDismiss();
    expect(undo).not.toHaveBeenCalled();
    expect(lastToast()).toBeNull();
    const count = seen.length;
    await vi.advanceTimersByTimeAsync(200);
    expect(seen).toHaveLength(count);
    await vi.advanceTimersByTimeAsync(6000);
    expect(seen).toHaveLength(count);
    await expect(done).resolves.toBe(true);
  });

  it('a second toast replaces the first, which is kept, and they never take turns on screen', async () => {
    const first = show();
    await vi.advanceTimersByTimeAsync(500);
    const second = showUndoToast({ action: () => 'other', undo: vi.fn(), message: 'Compito completato' });
    await vi.advanceTimersByTimeAsync(0);
    await expect(first.done).resolves.toBe(true);
    const from = seen.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen.slice(from).every((t) => t?.message === 'Compito completato')).toBe(true);
    await lastToast()?.onUndo();
    expect(first.undo).not.toHaveBeenCalled();
    await expect(second).resolves.toBe(false);
  });
});
