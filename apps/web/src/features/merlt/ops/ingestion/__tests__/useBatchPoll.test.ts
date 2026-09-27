import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBatchPoll, POLL_BUDGET_EXHAUSTED } from '../useBatchPoll';

const getBatchMock = vi.fn();
vi.mock('../opsIngestionApi', () => ({
  getBatch: (...args: unknown[]) => getBatchMock(...args),
}));

function batch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'b1',
    source: 'visualex_tree',
    scope_label: 'Libro IV',
    status: 'parsing',
    stats: null,
    created_at: '2026-07-01T00:00:00Z',
    created_by: 'admin',
    reviewed_by: null,
    promoted_at: null,
    rejected_at: null,
    expires_at: null,
    error: null,
    conflict_report: null,
    nodes_sample: [],
    edges_sample: [],
    nodes_total: 0,
    edges_total: 0,
    ...overrides,
  };
}

/** Advance fake timers AND flush the resulting React state updates. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  getBatchMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useBatchPoll', () => {
  it('does not poll when batchId is null', async () => {
    renderHook(() => useBatchPoll(null));
    await advance(5000);
    expect(getBatchMock).not.toHaveBeenCalled();
  });

  it('polls immediately on mount and again every 2s while transient (parsing)', async () => {
    getBatchMock.mockResolvedValue(batch({ status: 'parsing' }));

    renderHook(() => useBatchPoll('b1'));

    await advance(0);
    expect(getBatchMock).toHaveBeenCalledTimes(1);

    await advance(2000);
    expect(getBatchMock).toHaveBeenCalledTimes(2);

    await advance(2000);
    expect(getBatchMock).toHaveBeenCalledTimes(3);
  });

  it('stops polling once the status leaves the transient set (parsing → pending_review)', async () => {
    getBatchMock
      .mockResolvedValueOnce(batch({ status: 'parsing' }))
      .mockResolvedValueOnce(batch({ status: 'pending_review' }));

    const { result } = renderHook(() => useBatchPoll('b1'));

    await advance(0); // parsing
    await advance(2000); // pending_review → stops
    expect(getBatchMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('pending_review');

    await advance(6000);
    expect(getBatchMock).toHaveBeenCalledTimes(2);
  });

  it('stops polling once the status leaves the transient set (promoting → promoted)', async () => {
    getBatchMock
      .mockResolvedValueOnce(batch({ status: 'promoting' }))
      .mockResolvedValueOnce(batch({ status: 'promoted' }));

    const { result } = renderHook(() => useBatchPoll('b2'));

    await advance(0);
    await advance(2000);
    expect(result.current.status).toBe('promoted');

    const callsAtSettle = getBatchMock.mock.calls.length;
    await advance(6000);
    expect(getBatchMock).toHaveBeenCalledTimes(callsAtSettle);
  });

  it('does not poll further for a batch that is already pending_review on first fetch', async () => {
    getBatchMock.mockResolvedValue(batch({ status: 'pending_review' }));

    renderHook(() => useBatchPoll('b3'));
    await advance(0);
    expect(getBatchMock).toHaveBeenCalledTimes(1);

    await advance(6000);
    expect(getBatchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps polling on a transient request error (does not give up)', async () => {
    getBatchMock
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue(batch({ status: 'parsing' }));

    renderHook(() => useBatchPoll('b4'));

    await advance(0);
    await advance(2000);
    expect(getBatchMock).toHaveBeenCalledTimes(2);
  });

  it('stops polling after unmount', async () => {
    getBatchMock.mockResolvedValue(batch({ status: 'parsing' }));

    const { unmount } = renderHook(() => useBatchPoll('b5'));
    await advance(0);
    expect(getBatchMock).toHaveBeenCalledTimes(1);

    unmount();
    await advance(6000);
    expect(getBatchMock).toHaveBeenCalledTimes(1);
  });

  it('transitions to timeout and stops polling once the budget is exhausted', async () => {
    getBatchMock.mockResolvedValue(batch({ status: 'parsing' }));

    const { result } = renderHook(() => useBatchPoll('b6', { budgetMs: 5000 }));

    await advance(4999);
    expect(result.current.status).toBe('parsing');

    await advance(1);
    expect(result.current.status).toBe('timeout');
    expect(result.current.error).toBe(POLL_BUDGET_EXHAUSTED);

    const callsAtTimeout = getBatchMock.mock.calls.length;
    await advance(10_000);
    expect(getBatchMock).toHaveBeenCalledTimes(callsAtTimeout);
  });

  it('resets to idle when the polled batchId changes', async () => {
    getBatchMock.mockResolvedValue(batch({ status: 'parsing' }));

    const { result, rerender } = renderHook(({ id }) => useBatchPoll(id), {
      initialProps: { id: 'b7' as string | null },
    });

    await advance(0);
    expect(result.current.status).toBe('parsing');

    rerender({ id: null });
    expect(result.current.status).toBeNull();
    expect(result.current.batch).toBeNull();
  });

  it('restartToken forces a fresh poll cycle without resetting the currently displayed batch', async () => {
    getBatchMock
      .mockResolvedValueOnce(batch({ status: 'pending_review' }))
      .mockResolvedValueOnce(batch({ status: 'promoting' }));

    const { result, rerender } = renderHook(({ token }) => useBatchPoll('b8', { restartToken: token }), {
      initialProps: { token: 0 },
    });

    await advance(0);
    expect(result.current.status).toBe('pending_review');
    expect(getBatchMock).toHaveBeenCalledTimes(1);

    // Simulate a promote action succeeding server-side: bump restartToken.
    // The hook must NOT flash back to idle — it keeps showing the last batch
    // until the fresh immediate poll resolves.
    rerender({ token: 1 });
    expect(result.current.status).toBe('pending_review');
    expect(result.current.batch).not.toBeNull();

    await advance(0);
    expect(result.current.status).toBe('promoting');
    expect(getBatchMock).toHaveBeenCalledTimes(2);
  });

  it('cleans up timers on unmount mid-flight without throwing', async () => {
    let resolveLate: (v: unknown) => void = () => {};
    getBatchMock.mockImplementation(
      () =>
        new Promise((res) => {
          resolveLate = res;
        })
    );

    const { unmount } = renderHook(() => useBatchPoll('b9'));
    expect(getBatchMock).toHaveBeenCalledTimes(1);
    unmount();

    await act(async () => {
      resolveLate(batch({ status: 'parsing' }));
    });
    // The resolved poll after unmount must be a no-op (cancelled guard) — no
    // further polls get scheduled once the interval/budget timers are cleared.
    await advance(6000);
    expect(getBatchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores a poll response that resolves after the budget was already exhausted (does not un-timeout)', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    getBatchMock.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveFirst = res;
        })
    );

    const { result } = renderHook(() => useBatchPoll('b10', { budgetMs: 1000 }));

    await advance(1000);
    expect(result.current.status).toBe('timeout');

    await act(async () => {
      resolveFirst(batch({ status: 'parsing' }));
    });
    // The late 'parsing' resolution must NOT overwrite the timeout state.
    expect(result.current.status).toBe('timeout');

    // Nor should it restart the polling loop.
    const callsAfterResolve = getBatchMock.mock.calls.length;
    await advance(6000);
    expect(getBatchMock).toHaveBeenCalledTimes(callsAfterResolve);
  });

  it('paginate-in-place: changing nodeLimit does not reset the displayed batch to idle (FIX 1)', async () => {
    getBatchMock
      .mockResolvedValueOnce(batch({ status: 'pending_review' }))
      .mockResolvedValueOnce(batch({ status: 'pending_review' }));

    const { result, rerender } = renderHook(({ nodeLimit }) => useBatchPoll('b11', { nodeLimit }), {
      initialProps: { nodeLimit: 20 },
    });

    await advance(0);
    expect(result.current.status).toBe('pending_review');
    expect(result.current.batch).not.toBeNull();
    expect(getBatchMock).toHaveBeenCalledTimes(1);

    rerender({ nodeLimit: 40 });
    // Must NOT flash back to idle while the fresh (nodeLimit=40) fetch is in flight.
    expect(result.current.status).toBe('pending_review');
    expect(result.current.batch).not.toBeNull();

    await advance(0);
    expect(getBatchMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('pending_review');
  });
});
