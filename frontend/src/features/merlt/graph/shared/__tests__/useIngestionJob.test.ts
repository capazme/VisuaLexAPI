import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIngestionJob } from '../useIngestionJob';

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
});
