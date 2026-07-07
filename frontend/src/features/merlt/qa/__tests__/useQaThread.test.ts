import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const askQuestion = vi.fn();
const refineQuestion = vi.fn();
const rateAnswer = vi.fn();
const rateSource = vi.fn();
const confirmSource = vi.fn();
// Wave 2 P2.6: loadHistoryTurn hydrates details via fetchQaTrace — default to a
// pending promise so history tests stay focused unless they override it.
const fetchQaTrace = vi.fn<(...a: unknown[]) => Promise<unknown>>(() => new Promise(() => {}));

vi.mock('../qaApi', () => ({
  askQuestion: (...a: unknown[]) => askQuestion(...a),
  refineQuestion: (...a: unknown[]) => refineQuestion(...a),
  rateAnswer: (...a: unknown[]) => rateAnswer(...a),
  rateSource: (...a: unknown[]) => rateSource(...a),
  preferExpert: vi.fn(),
  rateDetailed: vi.fn(),
  confirmSource: (...a: unknown[]) => confirmSource(...a),
  fetchQaTrace: (...a: unknown[]) => fetchQaTrace(...a),
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

  it('ask() forwards the context basket and Riprova re-sends the same context', async () => {
    askQuestion.mockRejectedValueOnce({ status: 503, message: 'down' });
    askQuestion.mockResolvedValueOnce(answer);
    const context = { normReferences: ['urn:x~art1453'], legalConcepts: ['risoluzione'] };
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('art 1453?', 'convergent', { context });
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('error'));
    expect(askQuestion.mock.calls[0][2]).toEqual({ context });
    // The context is preserved on the turn request → retry re-sends it.
    await act(async () => {
      await result.current.retry(result.current.turns[0].id);
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('success'));
    expect(askQuestion.mock.calls[1][2]).toEqual({ context });
  });

  it('ask() without opts sends an unanchored request (no context)', async () => {
    askQuestion.mockResolvedValue(answer);
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('domanda generale?', 'convergent');
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('success'));
    expect(askQuestion.mock.calls[0][2]).toEqual({ context: undefined });
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
    // same question, same mode, same (single) turn (an AbortSignal now trails
    // the args — assert on the leading positional args only).
    expect(askQuestion).toHaveBeenCalledTimes(2);
    const secondCall = askQuestion.mock.calls[1];
    expect(secondCall[0]).toBe('art 1453?');
    expect(secondCall[1]).toBe('convergent');
    expect(secondCall[3]).toBeInstanceOf(AbortSignal);
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
    const secondRefine = refineQuestion.mock.calls[1];
    expect(secondRefine[0]).toBe('t1');
    expect(secondRefine[1]).toBe('e la diffida?');
    expect(secondRefine[2]).toBeInstanceOf(AbortSignal);
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

  // Wave 2 (history completeness, P2.6): the slim history turn is hydrated with
  // the FULL trace (retrieved_sources + expert_contributions + disagreement) so
  // the overlay/theses work on reopened debates.
  describe('loadHistoryTurn() trace hydration', () => {
    const item = {
      trace_id: 'hist-full',
      query: 'art 2043?',
      synthesis: 'Sintesi slim.',
      mode: 'divergent',
      confidence: 0.5,
      experts_used: ['literal', 'principles'],
      sources: [],
      created_at: '2026-06-01T10:00:00Z',
    };
    const traceJson = {
      trace_id: 'hist-full',
      stages: {
        expert_executions: [
          {
            expert_type: 'literal',
            confidence: 0.82,
            output: { interpretation_preview: 'Tesi letterale…' },
            retrieval_trace: { top_sources: ['urn:x~art2043', { urn: 'urn:x~art2059' }] },
          },
          {
            expert_type: 'principles',
            confidence: 0.71,
            output: { interpretation_preview: 'Tesi per principî…' },
            retrieval_trace: { top_sources: ['urn:x~art2043'] },
          },
        ],
        gating: { weights: { literal: 0.42, principles: 0.58 } },
        synthesis: {
          mode: 'divergent',
          confidence: 0.5,
          disagreement_analysis: {
            has_disagreement: true,
            intensity: 0.7,
            resolvability: 0.3,
            confidence: 0.8,
            conflicts: [{ expert_a: 'literal', expert_b: 'principles', conflict_score: 0.6 }],
          },
        },
      },
    };

    it('hydrates the turn with sources, contributions and disagreement from the trace', async () => {
      fetchQaTrace.mockResolvedValue(traceJson);
      const { result } = renderHook(() => useQaThread());
      act(() => result.current.loadHistoryTurn(item));
      await waitFor(() => expect(result.current.turns[0].historyDetail).toBe('hydrated'));
      expect(fetchQaTrace).toHaveBeenCalledWith('hist-full');

      const turn = result.current.turns[0];
      if (turn.state.status !== 'success') throw new Error('expected success state');
      const a = turn.state.answer;
      // Slim fields preserved…
      expect(a.synthesis).toBe('Sintesi slim.');
      // …details recovered from the trace (urn-only sources, deduped).
      expect(a.retrieved_sources.map((s) => s.urn)).toEqual(['urn:x~art2043', 'urn:x~art2059']);
      expect(a.expert_contributions).toEqual([
        { expert: 'literal', thesis: 'Tesi letterale…', confidence: 0.82, weight: 0.42 },
        { expert: 'principles', thesis: 'Tesi per principî…', confidence: 0.71, weight: 0.58 },
      ]);
      expect(a.disagreement_analysis?.has_disagreement).toBe(true);
      expect(a.disagreement_analysis?.conflicts).toHaveLength(1);
    });

    it('keeps the slim turn and marks it unavailable when the trace expired (404)', async () => {
      fetchQaTrace.mockRejectedValue({ status: 404, message: 'Trace not found' });
      const { result } = renderHook(() => useQaThread());
      act(() => result.current.loadHistoryTurn(item));
      await waitFor(() => expect(result.current.turns[0].historyDetail).toBe('unavailable'));

      const turn = result.current.turns[0];
      if (turn.state.status !== 'success') throw new Error('expected success state');
      expect(turn.state.answer.synthesis).toBe('Sintesi slim.');
      expect(turn.state.answer.retrieved_sources).toEqual([]);
    });

    it('marks the turn unavailable when the trace yields no details (empty payload)', async () => {
      fetchQaTrace.mockResolvedValue({ trace_id: 'hist-full', stages: {} });
      const { result } = renderHook(() => useQaThread());
      act(() => result.current.loadHistoryTurn(item));
      await waitFor(() => expect(result.current.turns[0].historyDetail).toBe('unavailable'));
    });
  });

  it('cancel() aborts the in-flight ask → recoverable "annullata" error, question preserved', async () => {
    // A signal-aware mock: rejects with an abort-style error when the caller
    // aborts (mirrors axios' CanceledError), otherwise stays pending.
    askQuestion.mockImplementation(
      (_q: string, _m: string, _max: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('canceled', 'AbortError')));
        }),
    );
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      void result.current.ask('art 1453?', 'convergent');
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('loading'));

    await act(async () => {
      result.current.cancel(result.current.turns[0].id);
    });

    await waitFor(() => expect(result.current.turns[0].state.status).toBe('error'));
    const turn = result.current.turns[0];
    expect(turn.question).toBe('art 1453?');
    if (turn.state.status !== 'error') throw new Error('expected error state');
    expect(turn.state.error).toMatch(/annullata/i);
    // Still retryable (the ask request is preserved).
    expect(turn.request).toEqual({ kind: 'ask', mode: 'convergent' });
  });

  it('cancel() on a non-loading turn is a no-op', async () => {
    askQuestion.mockResolvedValue(answer);
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('q', 'convergent');
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('success'));
    act(() => result.current.cancel(result.current.turns[0].id));
    // The completed turn is untouched.
    expect(result.current.turns[0].state.status).toBe('success');
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
    // B3: never forward the raw live: id as the entity name; a bare live: node
    // with no source_url falls back to a human placeholder.
    expect(confirmSource).toHaveBeenCalledWith('live:abc', 'Fonte provvisoria');
  });

  it('confirm() derives a readable entity name from source_url when present (B3)', async () => {
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
        source_url: 'https://normattiva.it/...~art467',
      });
    });
    await waitFor(() => expect(result.current.turns[0].confirmed['live:abc']).toBe('done'));
    expect(confirmSource).toHaveBeenCalledWith('live:abc', 'art. 467');
  });
});
