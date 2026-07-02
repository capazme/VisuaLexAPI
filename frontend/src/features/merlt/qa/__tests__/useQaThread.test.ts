import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const askQuestion = vi.fn();
const refineQuestion = vi.fn();
const rateAnswer = vi.fn();
const rateSource = vi.fn();
const confirmSource = vi.fn();

vi.mock('../qaApi', () => ({
  askQuestion: (...a: unknown[]) => askQuestion(...a),
  refineQuestion: (...a: unknown[]) => refineQuestion(...a),
  rateAnswer: (...a: unknown[]) => rateAnswer(...a),
  rateSource: (...a: unknown[]) => rateSource(...a),
  preferExpert: vi.fn(),
  rateDetailed: vi.fn(),
  confirmSource: (...a: unknown[]) => confirmSource(...a),
}));

import { useQaThread } from '../useQaThread';

const answer = {
  trace_id: 't1',
  synthesis: 'S',
  mode: 'convergent',
  sources: [],
  retrieved_sources: [{ urn: 'live:abc', provenance: 'live_unconfirmed', trust: 0.6, node_id: 'live:abc' }],
  experts_used: ['literal'],
  confidence: 0.8,
  execution_time_ms: 10,
};

beforeEach(() => {
  vi.clearAllMocks();
  // useQaThread now hydrates/persists the thread — install a working in-memory
  // localStorage (the project's setup mock is partial) and start empty.
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() { return store.size; },
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  } as Storage);
});

describe('useQaThread', () => {
  it('ask() appends a turn that resolves to success', async () => {
    askQuestion.mockResolvedValue(answer);
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('art 1453?', 'convergent');
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('success'));
  });

  it('ask() error → error state', async () => {
    askQuestion.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('q', 'convergent');
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('error'));
  });

  it('ask() failure preserves the question and maps the error to Italian copy', async () => {
    // apiClient's interceptor rejects with a plain { status, message } object.
    askQuestion.mockRejectedValue({ status: 503, message: 'Service Unavailable' });
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('art 1453?', 'convergent');
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('error'));
    const turn = result.current.turns[0];
    expect(turn.question).toBe('art 1453?');
    if (turn.state.status !== 'error') throw new Error('expected error state');
    expect(turn.state.error).not.toMatch(/Service Unavailable/);
    expect(turn.state.error).toMatch(/non è al momento raggiungibile/i);
  });

  it('retry() re-submits the same failed question in place and can succeed', async () => {
    askQuestion.mockRejectedValueOnce({ status: undefined, message: 'Network Error' });
    askQuestion.mockResolvedValueOnce(answer);
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('art 1453?', 'convergent');
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('error'));

    await act(async () => {
      await result.current.retry(result.current.turns[0].id);
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('success'));
    // same question, same mode, same (single) turn
    expect(askQuestion).toHaveBeenCalledTimes(2);
    expect(askQuestion).toHaveBeenNthCalledWith(2, 'art 1453?', 'convergent');
    expect(result.current.turns).toHaveLength(1);
  });

  it('retry() on a failed refine re-calls refineQuestion with the original traceId', async () => {
    askQuestion.mockResolvedValue(answer);
    refineQuestion.mockRejectedValueOnce({ status: 500, message: 'Internal' });
    refineQuestion.mockResolvedValueOnce({ ...answer, trace_id: 't2' });
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('q', 'convergent');
    });
    await act(async () => {
      await result.current.refine('t1', 'e la diffida?');
    });
    await waitFor(() => expect(result.current.turns[1].state.status).toBe('error'));

    await act(async () => {
      await result.current.retry(result.current.turns[1].id);
    });
    await waitFor(() => expect(result.current.turns[1].state.status).toBe('success'));
    expect(refineQuestion).toHaveBeenNthCalledWith(2, 't1', 'e la diffida?');
  });

  it('retry() is a no-op on non-error turns', async () => {
    askQuestion.mockResolvedValue(answer);
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('q', 'convergent');
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('success'));
    await act(async () => {
      await result.current.retry(result.current.turns[0].id);
    });
    expect(askQuestion).toHaveBeenCalledTimes(1);
    expect(result.current.turns[0].state.status).toBe('success');
  });

  it('refine() appends a second turn', async () => {
    askQuestion.mockResolvedValue(answer);
    refineQuestion.mockResolvedValue({ ...answer, trace_id: 't2' });
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('q', 'convergent');
    });
    await act(async () => {
      await result.current.refine('t1', 'e la diffida?');
    });
    await waitFor(() => expect(result.current.turns).toHaveLength(2));
  });

  it('rate() sets optimistic rating and fires the feedback', async () => {
    askQuestion.mockResolvedValue(answer);
    rateAnswer.mockResolvedValue(undefined);
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('q', 'convergent');
    });
    act(() => {
      result.current.rate(result.current.turns[0].id, 't1', 5);
    });
    await waitFor(() => expect(result.current.turns[0].rating).toBe(5));
    expect(rateAnswer).toHaveBeenCalledWith('t1', 5);
  });

  it('loadHistoryTurn() appends a read-only success turn (deduped)', async () => {
    const { result } = renderHook(() => useQaThread());
    const item = {
      trace_id: 'hist1', query: 'art 1453?', synthesis: 'La risoluzione…',
      mode: 'convergent', confidence: 0.6, experts_used: ['literal'], sources: [],
      created_at: '2026-05-31T10:00:00Z',
    };
    act(() => result.current.loadHistoryTurn(item));
    await waitFor(() => expect(result.current.turns).toHaveLength(1));
    expect(result.current.turns[0].state.status).toBe('success');
    // dedupe: loading the same trace again is a no-op
    act(() => result.current.loadHistoryTurn(item));
    expect(result.current.turns).toHaveLength(1);
  });

  it('confirm() marks the source done on success', async () => {
    askQuestion.mockResolvedValue(answer);
    confirmSource.mockResolvedValue(undefined);
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('q', 'convergent');
    });
    await act(async () => {
      await result.current.confirm(result.current.turns[0].id, {
        urn: 'live:abc',
        provenance: 'live_unconfirmed',
        node_id: 'live:abc',
      });
    });
    await waitFor(() => expect(result.current.turns[0].confirmed['live:abc']).toBe('done'));
    expect(confirmSource).toHaveBeenCalledWith('live:abc', 'live:abc');
  });
});
