import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const fetchStatus = vi.fn();
vi.mock('../contribApi', () => ({
  fetchExtractionJobStatus: (...a: unknown[]) => fetchStatus(...a),
}));

import { useExtractionJob } from '../useExtractionJob';

/** Advance fake timers AND flush the resulting React state updates. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  fetchStatus.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useExtractionJob', () => {
  it('stays idle and does not poll when jobId is null', async () => {
    const { result } = renderHook(() => useExtractionJob(null));
    await advance(5000);
    expect(result.current.status).toBeNull();
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it('polls immediately and exposes the status', async () => {
    fetchStatus.mockResolvedValue({ jobId: 'j1', status: 'running', candidatesCreated: null, error: null });
    const { result } = renderHook(() => useExtractionJob('j1'));
    await advance(0);
    expect(fetchStatus).toHaveBeenCalledWith('j1');
    expect(result.current.status).toBe('running');
  });

  it('stops polling once terminal (completed)', async () => {
    fetchStatus
      .mockResolvedValueOnce({ jobId: 'j1', status: 'running', candidatesCreated: null, error: null })
      .mockResolvedValueOnce({ jobId: 'j1', status: 'completed', candidatesCreated: 5, error: null });
    const { result } = renderHook(() => useExtractionJob('j1'));
    await advance(0); // running
    await advance(2000); // completed → clears interval
    expect(result.current.status).toBe('completed');
    expect(result.current.candidatesCreated).toBe(5);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    await advance(6000);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it('resets to idle when the job id changes to null', async () => {
    fetchStatus.mockResolvedValue({ jobId: 'j1', status: 'completed', candidatesCreated: 1, error: null });
    const { result, rerender } = renderHook(({ id }) => useExtractionJob(id), {
      initialProps: { id: 'j1' as string | null },
    });
    await advance(0);
    expect(result.current.status).toBe('completed');
    rerender({ id: null });
    expect(result.current.status).toBeNull();
  });
});
