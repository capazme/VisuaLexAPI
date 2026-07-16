import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const startQueryAsync = vi.fn();
const fetchQaJobStatus = vi.fn();
const refineQuestion = vi.fn();
const rateAnswer = vi.fn();
const rateSource = vi.fn();
const confirmSource = vi.fn();
// Wave 2 P2.6: loadHistoryTurn hydrates details via fetchQaTrace — default to a
// pending promise so history tests stay focused unless they override it.
const fetchQaTrace = vi.fn<(...a: unknown[]) => Promise<unknown>>(() => new Promise(() => {}));

vi.mock('../qaApi', () => ({
  startQueryAsync: (...a: unknown[]) => startQueryAsync(...a),
  fetchQaJobStatus: (...a: unknown[]) => fetchQaJobStatus(...a),
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

const literalPartial = { expert: 'literal', thesis: 'Tesi letterale…', confidence: 0.7, weight: 0.5 };
const systemicPartial = { expert: 'systemic', thesis: 'Tesi sistematica…', confidence: 0.6, weight: 0.4 };

/** Default happy path for a single-tick async ask: submit → immediately completed. */
function mockAskSucceedsOnFirstTick(): void {
  startQueryAsync.mockResolvedValue({ jobId: 'job1', status: 'pending' });
  fetchQaJobStatus.mockResolvedValue({ jobId: 'job1', status: 'completed', partials: [], result: answer, error: null });
}

/** Advance fake timers AND flush the resulting React state updates (mirrors useIngestionJob's tests). */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

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
    mockAskSucceedsOnFirstTick();
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('art 1453?', 'convergent');
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('success'));
  });

  it('ask() forwards the context basket and Riprova re-sends the same context', async () => {
    startQueryAsync.mockRejectedValueOnce({ status: 503, message: 'down' });
    startQueryAsync.mockResolvedValueOnce({ jobId: 'job1', status: 'pending' });
    fetchQaJobStatus.mockResolvedValue({ jobId: 'job1', status: 'completed', partials: [], result: answer, error: null });
    const context = { normReferences: ['urn:x~art1453'], legalConcepts: ['risoluzione'] };
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('art 1453?', 'convergent', { context });
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('error'));
    expect(startQueryAsync.mock.calls[0][2]).toEqual({ context });
    // The context is preserved on the turn request → retry re-sends it.
    await act(async () => {
      await result.current.retry(result.current.turns[0].id);
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('success'));
    expect(startQueryAsync.mock.calls[1][2]).toEqual({ context });
  });

  it('ask() without opts sends an unanchored request (no context)', async () => {
    mockAskSucceedsOnFirstTick();
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('domanda generale?', 'convergent');
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('success'));
    expect(startQueryAsync.mock.calls[0][2]).toEqual({ context: undefined });
  });

  it('ask() error → error state', async () => {
    startQueryAsync.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('q', 'convergent');
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('error'));
  });

  it('ask() failure preserves the question and maps the error to Italian copy', async () => {
    // apiClient's interceptor rejects with a plain { status, message } object.
    startQueryAsync.mockRejectedValue({ status: 503, message: 'Service Unavailable' });
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
    startQueryAsync.mockRejectedValueOnce({ status: undefined, message: 'Network Error' });
    startQueryAsync.mockResolvedValueOnce({ jobId: 'job1', status: 'pending' });
    fetchQaJobStatus.mockResolvedValue({ jobId: 'job1', status: 'completed', partials: [], result: answer, error: null });
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
    expect(startQueryAsync).toHaveBeenCalledTimes(2);
    const secondCall = startQueryAsync.mock.calls[1];
    expect(secondCall[0]).toBe('art 1453?');
    expect(secondCall[1]).toBe('convergent');
    expect(secondCall[3]).toBeInstanceOf(AbortSignal);
    expect(result.current.turns).toHaveLength(1);
  });

  it('retry() on a failed refine re-calls refineQuestion with the original traceId', async () => {
    mockAskSucceedsOnFirstTick();
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
    mockAskSucceedsOnFirstTick();
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('q', 'convergent');
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('success'));
    await act(async () => {
      await result.current.retry(result.current.turns[0].id);
    });
    expect(startQueryAsync).toHaveBeenCalledTimes(1);
    expect(result.current.turns[0].state.status).toBe('success');
  });

  it('refine() appends a second turn', async () => {
    mockAskSucceedsOnFirstTick();
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
    mockAskSucceedsOnFirstTick();
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
    // aborts (mirrors axios' CanceledError), otherwise stays pending. The
    // submission itself never resolves, so the turn stays 'loading' (never
    // reaches 'partial') until cancel fires.
    startQueryAsync.mockImplementation(
      (_q: string, _m: string, _opts: unknown, signal: AbortSignal) =>
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
    // The job status endpoint was never reached — the submission itself hung.
    expect(fetchQaJobStatus).not.toHaveBeenCalled();
  });

  it('cancel() on a non-loading turn is a no-op', async () => {
    mockAskSucceedsOnFirstTick();
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
    mockAskSucceedsOnFirstTick();
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
    mockAskSucceedsOnFirstTick();
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

  // qa-async-progressive-contract.md — the submit→poll progressive loop.
  // Fake timers, scoped to this describe only: the poll loop's cadence
  // (QA_POLL_INTERVAL_MS = 2000) needs controlled time advancement, but
  // combining vi.useFakeTimers() with `await act(async () => { await
  // hookMethod() })` elsewhere in this file deadlocks (React's scheduler
  // yields via a timer that never gets pumped while we're already inside an
  // awaited act() callback) — every test below instead fires the action with
  // `void` and drains it via the `advance()` helper (mirrors useIngestionJob's
  // tests, which never await the triggering call directly either).
  describe('async progressive poll loop', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('surfaces a partial state as experts land, then settles to success', async () => {
      startQueryAsync.mockResolvedValue({ jobId: 'job1', status: 'pending' });
      fetchQaJobStatus
        .mockResolvedValueOnce({ jobId: 'job1', status: 'pending', partials: [], result: null, error: null })
        .mockResolvedValueOnce({ jobId: 'job1', status: 'running', partials: [literalPartial], result: null, error: null })
        .mockResolvedValueOnce({
          jobId: 'job1',
          status: 'running',
          partials: [literalPartial, systemicPartial],
          result: null,
          error: null,
        })
        .mockResolvedValueOnce({ jobId: 'job1', status: 'completed', partials: [literalPartial, systemicPartial], result: answer, error: null });

      const { result } = renderHook(() => useQaThread());
      await act(async () => {
        void result.current.ask('art 1453?', 'convergent');
      });

      await advance(0); // 1st tick: pending, no partials yet
      expect(result.current.turns[0].state.status).toBe('loading');

      await advance(2000); // 2nd tick: literal lands
      expect(result.current.turns[0].state).toEqual({ status: 'partial', partials: [literalPartial] });

      await advance(2000); // 3rd tick: systemic lands too
      expect(result.current.turns[0].state).toEqual({
        status: 'partial',
        partials: [literalPartial, systemicPartial],
      });

      await advance(2000); // 4th tick: completed
      expect(result.current.turns[0].state.status).toBe('success');
      // Polling stopped — no further fetchQaJobStatus calls past the terminal tick.
      const callsAtCompletion = fetchQaJobStatus.mock.calls.length;
      await advance(6000);
      expect(fetchQaJobStatus).toHaveBeenCalledTimes(callsAtCompletion);
    });

    it('maps a terminal "failed" job status to a recoverable error', async () => {
      startQueryAsync.mockResolvedValue({ jobId: 'job1', status: 'pending' });
      fetchQaJobStatus.mockResolvedValue({
        jobId: 'job1',
        status: 'failed',
        partials: [],
        result: null,
        error: 'Buffer insufficiente',
      });

      const { result } = renderHook(() => useQaThread());
      act(() => {
        void result.current.ask('art 1453?', 'convergent');
      });
      await advance(0);

      expect(result.current.turns[0].state.status).toBe('error');
      const turn = result.current.turns[0];
      if (turn.state.status !== 'error') throw new Error('expected error state');
      // Riprova stays available; the copy is the neutral fallback (not the
      // "connessione assente" branch — the job failed server-side, not the
      // transport to the BFF).
      expect(turn.state.error).toMatch(/non è stato possibile ottenere una risposta/i);
    });

    it('maps a terminal "timeout" job status to a recoverable error', async () => {
      startQueryAsync.mockResolvedValue({ jobId: 'job1', status: 'pending' });
      fetchQaJobStatus.mockResolvedValue({
        jobId: 'job1',
        status: 'timeout',
        partials: [literalPartial],
        result: null,
        error: null,
      });

      const { result } = renderHook(() => useQaThread());
      act(() => {
        void result.current.ask('art 1453?', 'convergent');
      });
      await advance(0);

      expect(result.current.turns[0].state.status).toBe('error');
    });

    it('cancel() during an active poll stops further polling', async () => {
      startQueryAsync.mockResolvedValue({ jobId: 'job1', status: 'pending' });
      fetchQaJobStatus.mockResolvedValue({ jobId: 'job1', status: 'running', partials: [literalPartial], result: null, error: null });

      const { result } = renderHook(() => useQaThread());
      act(() => {
        void result.current.ask('art 1453?', 'convergent');
      });
      await advance(0);
      expect(result.current.turns[0].state.status).toBe('partial');
      const callsBeforeCancel = fetchQaJobStatus.mock.calls.length;

      act(() => {
        result.current.cancel(result.current.turns[0].id);
      });
      await advance(0);
      expect(result.current.turns[0].state.status).toBe('error');
      const turn = result.current.turns[0];
      if (turn.state.status !== 'error') throw new Error('expected error state');
      expect(turn.state.error).toMatch(/annullata/i);

      // No more ticks fire after cancel (the interval was cleared).
      await advance(10_000);
      expect(fetchQaJobStatus).toHaveBeenCalledTimes(callsBeforeCancel);
    });

    it('unmounting mid-poll aborts the controller and stops further polling', async () => {
      startQueryAsync.mockResolvedValue({ jobId: 'job1', status: 'pending' });
      fetchQaJobStatus.mockResolvedValue({ jobId: 'job1', status: 'running', partials: [literalPartial], result: null, error: null });

      const { result, unmount } = renderHook(() => useQaThread());
      act(() => {
        void result.current.ask('art 1453?', 'convergent');
      });
      await advance(0);
      expect(result.current.turns[0].state.status).toBe('partial');
      const callsBeforeUnmount = fetchQaJobStatus.mock.calls.length;

      act(() => {
        unmount();
      });

      // No more ticks fire after unmount (the poll's AbortController was
      // aborted, which clears its interval).
      await advance(10_000);
      expect(fetchQaJobStatus).toHaveBeenCalledTimes(callsBeforeUnmount);
    });

    it('a tick already in flight when cancel() fires cannot resurrect the turn on late resolution (latest-wins)', async () => {
      // Tick 1 lands a partial normally. Tick 2 is deliberately left in flight
      // (a real network response arriving late despite the AbortController —
      // pollQaJob's `settled` guard, not just the AbortSignal, is what must
      // stop it): the user hits Annulla WHILE tick 2 is pending, then tick 2
      // resolves with a — otherwise state-changing — 'completed' payload. It
      // must be discarded; the turn stays on the cancel's "annullata" error.
      let resolveTick2: ((v: unknown) => void) | null = null;
      startQueryAsync.mockResolvedValue({ jobId: 'job1', status: 'pending' });
      fetchQaJobStatus
        .mockResolvedValueOnce({ jobId: 'job1', status: 'running', partials: [literalPartial], result: null, error: null })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveTick2 = resolve;
            }),
        );

      const { result } = renderHook(() => useQaThread());
      act(() => {
        void result.current.ask('art 1453?', 'convergent');
      });
      await advance(0); // tick 1
      expect(result.current.turns[0].state.status).toBe('partial');

      await advance(2000); // tick 2 fires, stays pending (resolveTick2 captured)
      expect(result.current.turns[0].state.status).toBe('partial');

      act(() => {
        result.current.cancel(result.current.turns[0].id);
      });
      await advance(0);
      expect(result.current.turns[0].state.status).toBe('error');

      // The stale tick 2 now resolves with a terminal 'completed' — too late.
      await act(async () => {
        resolveTick2?.({ jobId: 'job1', status: 'completed', partials: [literalPartial], result: answer, error: null });
      });
      await advance(0);
      expect(result.current.turns[0].state.status).toBe('error');
      expect(result.current.turns).toHaveLength(1);
    });
  });
});
