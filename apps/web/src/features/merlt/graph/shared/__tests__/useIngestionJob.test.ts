import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIngestionJob, POLL_BUDGET_EXHAUSTED } from '../useIngestionJob';

const fetchJobStatusMock = vi.fn();
vi.mock('../graphApi', () => ({
  fetchJobStatus: (...args: unknown[]) => fetchJobStatusMock(...args),
}));

/** Advance fake timers AND flush the resulting React state updates. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  fetchJobStatusMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useIngestionJob', () => {
  it('does not poll when jobId is null', async () => {
    renderHook(() => useIngestionJob(null));
    await advance(5000);
    expect(fetchJobStatusMock).not.toHaveBeenCalled();
  });

  it('polls immediately on mount and again every 2s while non-terminal', async () => {
    fetchJobStatusMock.mockResolvedValue({ jobId: 'j1', status: 'running' });

    renderHook(() => useIngestionJob('j1'));

    // Immediate poll.
    await advance(0);
    expect(fetchJobStatusMock).toHaveBeenCalledTimes(1);

    await advance(2000);
    expect(fetchJobStatusMock).toHaveBeenCalledTimes(2);

    await advance(2000);
    expect(fetchJobStatusMock).toHaveBeenCalledTimes(3);
  });

  it('stops polling once a terminal status is reached', async () => {
    fetchJobStatusMock
      .mockResolvedValueOnce({ jobId: 'j2', status: 'running' })
      .mockResolvedValueOnce({ jobId: 'j2', status: 'completed', nodesCreated: 12 });

    const { result } = renderHook(() => useIngestionJob('j2'));

    await advance(0); // running
    await advance(2000); // completed → clears interval
    expect(fetchJobStatusMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('completed');
    expect(result.current.nodesCreated).toBe(12);

    // No further polls after terminal.
    await advance(6000);
    expect(fetchJobStatusMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces the error string on a failed job', async () => {
    fetchJobStatusMock.mockResolvedValue({
      jobId: 'j3',
      status: 'failed',
      error: 'not indexable',
    });

    const { result } = renderHook(() => useIngestionJob('j3'));
    await advance(0);

    expect(result.current.status).toBe('failed');
    expect(result.current.error).toBe('not indexable');
  });

  it('keeps polling on a transient request error (does not give up)', async () => {
    fetchJobStatusMock
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue({ jobId: 'j4', status: 'running' });

    renderHook(() => useIngestionJob('j4'));

    await advance(0); // rejected
    await advance(2000); // resolves running
    expect(fetchJobStatusMock).toHaveBeenCalledTimes(2);
  });

  it('stops polling after unmount', async () => {
    fetchJobStatusMock.mockResolvedValue({ jobId: 'j5', status: 'running' });

    const { unmount } = renderHook(() => useIngestionJob('j5'));
    await advance(0);
    expect(fetchJobStatusMock).toHaveBeenCalledTimes(1);

    unmount();
    await advance(6000);
    expect(fetchJobStatusMock).toHaveBeenCalledTimes(1);
  });

  describe('polling budget', () => {
    it('transitions to timeout and stops polling once the default 60s budget is exhausted', async () => {
      fetchJobStatusMock.mockResolvedValue({ jobId: 'j6', status: 'running' });

      const { result } = renderHook(() => useIngestionJob('j6'));

      await advance(59_000);
      expect(result.current.status).toBe('running');

      await advance(1_000); // budget fires at 60s
      expect(result.current.status).toBe('timeout');
      expect(result.current.error).toBe(POLL_BUDGET_EXHAUSTED);

      const callsAtTimeout = fetchJobStatusMock.mock.calls.length;
      await advance(10_000);
      expect(fetchJobStatusMock).toHaveBeenCalledTimes(callsAtTimeout);
    });

    it('honours a custom budget', async () => {
      fetchJobStatusMock.mockResolvedValue({ jobId: 'j7', status: 'running' });

      const { result } = renderHook(() => useIngestionJob('j7', 5000));

      await advance(4999);
      expect(result.current.status).toBe('running');

      await advance(1);
      expect(result.current.status).toBe('timeout');
      expect(result.current.error).toBe(POLL_BUDGET_EXHAUSTED);
    });

    it('does not time out a job that reached a terminal status within the budget', async () => {
      fetchJobStatusMock.mockResolvedValue({ jobId: 'j8', status: 'completed', nodesCreated: 3 });

      const { result } = renderHook(() => useIngestionJob('j8'));

      await advance(0);
      expect(result.current.status).toBe('completed');

      await advance(120_000);
      expect(result.current.status).toBe('completed');
    });

    it('ignores an in-flight poll that resolves after the budget fired', async () => {
      let resolveLate: (v: unknown) => void = () => {};
      fetchJobStatusMock.mockImplementation(
        () =>
          new Promise((res) => {
            resolveLate = res;
          })
      );

      const { result } = renderHook(() => useIngestionJob('j9', 3000));

      await advance(3000); // budget fires while a poll is still pending
      expect(result.current.status).toBe('timeout');

      await act(async () => {
        resolveLate({ jobId: 'j9', status: 'running' });
      });
      expect(result.current.status).toBe('timeout');
    });

    it('restarts the budget when the polled job changes', async () => {
      fetchJobStatusMock.mockResolvedValue({ jobId: 'x', status: 'running' });

      const { result, rerender } = renderHook(({ id }) => useIngestionJob(id, 5000), {
        initialProps: { id: 'j10' },
      });

      await advance(4000);
      rerender({ id: 'j11' }); // new job → IDLE reset + fresh budget

      await advance(4000); // 8s total, but only 4s into j11's budget
      expect(result.current.status).toBe('running');

      await advance(1000);
      expect(result.current.status).toBe('timeout');
    });
  });
});
