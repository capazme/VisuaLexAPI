import { useCallback, useEffect, useRef, useState } from 'react';
import {
  refineQuestion,
  rateAnswer,
  rateSource,
  preferExpert,
  rateDetailed,
  confirmSource,
  fetchQaTrace,
  startQueryAsync,
  fetchQaJobStatus,
} from './qaApi';
import { loadThread, saveThread, clearThread } from './qaThreadStorage';
import { extractTraceDetails, isEmptyTraceDetails } from './traceDetails';
import { confirmSourceEntityText } from './format';
import { TERMINAL_QA_JOB_STATUSES } from './types';
import type {
  GraphContext,
  QaMode,
  QaTurnModel,
  QaRetrievedSource,
  QaAnswer,
  QaHistoryItem,
  QaPartialExpert,
} from './types';

// Module-level counter. On reload it resets to 0 while the persisted thread
// keeps its `turn-N` ids, so a new turn would reuse `turn-1` and collide with a
// restored turn (React duplicate-key). hydrateSeq() bumps it past the loaded max
// before the first nextId() call.
let seq = 0;
const nextId = (): string => `turn-${++seq}`;

function hydrateSeq(turns: QaTurnModel[]): void {
  for (const t of turns) {
    const n = Number(t.id.slice('turn-'.length));
    if (Number.isFinite(n) && n > seq) seq = n;
  }
}

/**
 * Map a failed ask/refine to user-facing Italian copy. The apiClient response
 * interceptor rejects with a plain `{ status?, message? }` object — the raw
 * (English/HTTP) message must never reach the UI. The failed question stays on
 * the turn, so every message can point at "Riprova".
 */
function friendlyQaError(err: unknown): string {
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? (err as { status?: number }).status
      : undefined;
  if (status === 502 || status === 503 || status === 504) {
    return 'Il motore MERL-T non è al momento raggiungibile. Riprova più tardi.';
  }
  if (status === 429) {
    return 'Troppe richieste in poco tempo. Attendi qualche istante e riprova.';
  }
  if (status === 403) {
    // The ask/refine routes need at least basic consent (Slice 3 D2). A revoke
    // mid-thread lands here — point at consent, not a retry that can't succeed.
    return 'Per usare l’assistente serve il consenso a MERL-T. Attivalo dalle impostazioni per continuare.';
  }
  if (status === undefined) {
    return 'Nessuna risposta dal server: la connessione è assente o la richiesta ha impiegato troppo tempo. Riprova.';
  }
  return 'Non è stato possibile ottenere una risposta. Riprova.';
}

// qa-async-progressive-contract.md §2: same cadence as the ingestion/extraction
// job polls (useIngestionJob.ts / useExtractionJob.ts) — 2s.
const QA_POLL_INTERVAL_MS = 2000;

/**
 * Poll a Q&A job (qa-async-progressive-contract.md §2) to a terminal state,
 * invoking `onPartial` with the accumulated per-expert contributions on every
 * non-terminal tick (contract: "il FE keya su `expert`, no remount a metà
 * stream" — callers just replace their `partials` array wholesale, the BFF
 * already returns them pre-ordered/pre-deduped). Resolves with the normalized
 * answer on `completed`; rejects on `failed`/`timeout` (mapped through
 * `friendlyQaError` by the caller, same as any other request failure) or the
 * instant `signal` aborts (mirrors askQuestion/refineQuestion's own abort
 * contract, so Annulla behaves identically for both request shapes).
 *
 * A transient poll error is swallowed — the job may still finish server-side;
 * a genuine failure arrives as a terminal `failed`/`timeout` status (mirrors
 * useIngestionJob's same swallow-and-keep-polling choice).
 */
function pollQaJob(
  jobId: string,
  signal: AbortSignal,
  onPartial: (partials: QaPartialExpert[]) => void,
): Promise<QaAnswer> {
  return new Promise<QaAnswer>((resolve, reject) => {
    let settled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stop = (): void => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      stop();
      signal.removeEventListener('abort', onAbort);
      fn();
    };

    const onAbort = (): void => {
      settle(() => reject(new DOMException('The QA poll was aborted.', 'AbortError')));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort);

    const tick = async (): Promise<void> => {
      if (settled) return;
      try {
        const res = await fetchQaJobStatus(jobId, signal);
        if (settled) return;
        if (TERMINAL_QA_JOB_STATUSES.has(res.status)) {
          if (res.status === 'completed' && res.result) {
            settle(() => resolve(res.result as QaAnswer));
          } else if (res.status === 'completed') {
            // Contract says `result` is valorized on `completed` — a missing
            // one is a BFF/callback bug, not a user-facing network failure.
            settle(() => reject({ status: 500, message: 'La deliberazione risulta completata ma senza risultato.' }));
          } else {
            // A deliberate `status: 500` (not a real HTTP status, just a value
            // friendlyQaError doesn't special-case) steers it to its neutral
            // default copy instead of the `status === undefined` "connessione
            // assente" branch — this is a server-side deliberation failure
            // (MERL-T ran and gave up), not a transport failure to the BFF.
            settle(() =>
              reject({ status: 500, message: res.error ?? 'La deliberazione MERL-T non è andata a buon fine.' }),
            );
          }
          return;
        }
        if (res.partials.length > 0) onPartial(res.partials);
      } catch {
        // Transient poll failure — keep polling; see doc comment above.
      }
    };

    intervalId = setInterval(() => void tick(), QA_POLL_INTERVAL_MS);
    void tick();
  });
}

/**
 * Submit+poll work function for an 'ask'-kind turn (qa-async-progressive-
 * contract.md §1+§2), the shape `run()` expects: `(signal, onPartial) =>
 * Promise<QaAnswer>`. Shared by `ask()` and `retry()` on an 'ask' turn.
 */
async function askAsync(
  question: string,
  mode: QaMode,
  context: GraphContext | undefined,
  signal: AbortSignal,
  onPartial: (partials: QaPartialExpert[]) => void,
): Promise<QaAnswer> {
  const { jobId } = await startQueryAsync(question, mode, { context }, signal);
  return pollQaJob(jobId, signal, onPartial);
}

/**
 * Conversational Q&A thread over the MERL-T experts. Holds the turns, drives
 * ask/refine, and the granular feedback channels (inline / per-source /
 * preference / detailed) + confirm-source. All feedback is fire-and-forget and
 * optimistic. Latest-wins per turn via a request token (a stale response for a
 * turn that was re-run is discarded). All setState lives in callbacks — never
 * synchronously inside an effect (react-hooks/set-state-in-effect).
 */
export function useQaThread() {
  // Hydrate the completed thread from localStorage so a reload doesn't lose
  // past answers (Loop β #1 option A). Lazy initializer → runs once.
  const [turns, setTurns] = useState<QaTurnModel[]>(() => {
    // A turn persisted mid-hydration ('loading') has no live trace fetch to
    // resume after a reload — degrade it to 'unavailable' instead of showing
    // an eternal "Recupero i dettagli…" spinner.
    const loaded = loadThread().map((t): QaTurnModel =>
      t.historyDetail === 'loading' ? { ...t, historyDetail: 'unavailable' } : t,
    );
    hydrateSeq(loaded); // continue ids past the restored max — no turn-1 reuse
    return loaded;
  });
  const tokens = useRef<Record<string, number>>({});
  // One AbortController per in-flight turn, so the user can cancel the up-to-120s
  // wait (design §3.5 "Annulla"). Cleared once the turn settles.
  const controllers = useRef<Record<string, AbortController>>({});

  // Persist the thread whenever it changes (saveThread keeps only completed
  // turns + caps the count). setState is never called here.
  useEffect(() => {
    saveThread(turns);
  }, [turns]);

  // Abort every in-flight turn on unmount, so a poll loop (up to ~11min per
  // the async progressive contract) doesn't keep hitting the BFF and calling
  // setTurns on an unmounted component after the user navigates away from
  // /grafo. No setState here — just aborts, same as cancel().
  useEffect(
    () => () => {
      for (const c of Object.values(controllers.current)) c?.abort();
    },
    [],
  );

  const patch = useCallback((id: string, fn: (t: QaTurnModel) => QaTurnModel): void => {
    setTurns((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  // `work` may report interim per-expert progress via `onPartial` before
  // settling — the 'ask' path (askAsync/pollQaJob) calls it, the 'refine'
  // path (refineQuestion, still a single blocking round-trip per the BFF
  // contract — no async /refine endpoint exists) never does. Every setState
  // (partial AND terminal) re-checks the token so a superseded turn (a new
  // ask/retry issued for the same turn id, or a stale poll tick) is a no-op —
  // "latest-wins" per qa-async-progressive-contract.md.
  const run = useCallback(
    async (
      id: string,
      work: (signal: AbortSignal, onPartial: (partials: QaPartialExpert[]) => void) => Promise<QaAnswer>,
    ): Promise<void> => {
      const token = (tokens.current[id] = (tokens.current[id] ?? 0) + 1);
      // A same-id re-run (retry) must not leave the previous controller's poll
      // orphaned — abort it before the new one takes its place in the map, so
      // cancel() can always reach the live request.
      controllers.current[id]?.abort();
      const controller = new AbortController();
      controllers.current[id] = controller;
      const onPartial = (partials: QaPartialExpert[]): void => {
        if (tokens.current[id] === token) patch(id, (t) => ({ ...t, state: { status: 'partial', partials } }));
      };
      try {
        const answer = await work(controller.signal, onPartial);
        if (tokens.current[id] === token) patch(id, (t) => ({ ...t, state: { status: 'success', answer } }));
      } catch (err) {
        // A user-initiated Annulla aborts the request: surface the dedicated
        // "annullata" copy (still recoverable via Riprova) rather than a scary
        // network-failure message.
        const aborted = controller.signal.aborted;
        if (!aborted) console.error('QA ask/refine failed:', err);
        if (tokens.current[id] === token) {
          patch(id, (t) => ({
            ...t,
            state: { status: 'error', error: aborted ? 'Richiesta annullata.' : friendlyQaError(err) },
          }));
        }
      } finally {
        if (controllers.current[id] === controller) delete controllers.current[id];
      }
    },
    [patch],
  );

  // Context-anchored ask: `opts.context` (the graph context basket at ask time)
  // travels to the BFF and is stored on the turn's request so Riprova re-sends
  // the SAME selected nodes. Omitted / empty = unanchored ask. Goes through the
  // async submit+poll path (askAsync) — see qa-async-progressive-contract.md.
  const ask = useCallback(
    async (question: string, mode: QaMode, opts?: { context?: GraphContext }): Promise<void> => {
      const id = nextId();
      const context = opts?.context;
      setTurns((prev) => [
        ...prev,
        { id, question, state: { status: 'loading', startedAt: Date.now() }, confirmed: {}, request: { kind: 'ask', mode, context } },
      ]);
      await run(id, (signal, onPartial) => askAsync(question, mode, context, signal, onPartial));
    },
    [run],
  );

  const refine = useCallback(
    async (traceId: string, followUp: string): Promise<void> => {
      const id = nextId();
      setTurns((prev) => [
        ...prev,
        { id, question: followUp, state: { status: 'loading', startedAt: Date.now() }, confirmed: {}, request: { kind: 'refine', traceId } },
      ]);
      await run(id, (signal) => refineQuestion(traceId, followUp, signal));
    },
    [run],
  );

  // Re-submit a failed turn in place (Riprova). The question is preserved on
  // the turn model, so the same request re-runs without re-typing; run()'s
  // token bump makes any stale in-flight response for this turn discardable.
  const retry = useCallback(
    async (turnId: string): Promise<void> => {
      const turn = turns.find((t) => t.id === turnId);
      if (!turn || turn.state.status !== 'error' || !turn.request) return;
      const req = turn.request;
      patch(turnId, (t) => ({ ...t, state: { status: 'loading', startedAt: Date.now() } }));
      await run(turnId, (signal, onPartial) =>
        req.kind === 'ask'
          ? askAsync(turn.question, req.mode, req.context, signal, onPartial)
          : refineQuestion(req.traceId, turn.question, signal),
      );
    },
    [turns, patch, run],
  );

  // Abort the in-flight request for a turn (Annulla). run()'s catch sees the
  // aborted signal and transitions the turn to a recoverable "annullata" error
  // with Riprova; the composer is never blocked, so the user can also re-type.
  const cancel = useCallback((turnId: string): void => {
    controllers.current[turnId]?.abort();
  }, []);

  const rate = useCallback(
    (turnId: string, traceId: string, rating: 1 | 5): void => {
      patch(turnId, (t) => ({ ...t, rating }));
      void rateAnswer(traceId, rating).catch((e) => console.error('rate failed:', e));
    },
    [patch],
  );

  const rateSrc = useCallback((traceId: string, sourceId: string, relevant: boolean): void => {
    void rateSource(traceId, sourceId, relevant).catch((e) => console.error('rateSource failed:', e));
  }, []);

  const prefer = useCallback((traceId: string, expert: string): void => {
    void preferExpert(traceId, expert).catch((e) => console.error('preferExpert failed:', e));
  }, []);

  const detailed = useCallback(
    (traceId: string, scores: { retrievalScore: number; reasoningScore: number; synthesisScore: number }, comment?: string): void => {
      void rateDetailed(traceId, scores, comment).catch((e) => console.error('rateDetailed failed:', e));
    },
    [],
  );

  const confirm = useCallback(
    async (turnId: string, source: QaRetrievedSource): Promise<void> => {
      if (!source.node_id) return;
      const nodeId = source.node_id;
      patch(turnId, (t) => ({ ...t, confirmed: { ...t.confirmed, [nodeId]: 'pending' } }));
      try {
        // Pass a human-readable entity name (never the raw live: id — the BFF
        // rejects a name that starts with the provisional node id).
        await confirmSource(nodeId, confirmSourceEntityText(source));
        patch(turnId, (t) => ({ ...t, confirmed: { ...t.confirmed, [nodeId]: 'done' } }));
      } catch (e) {
        console.error('confirm-source failed:', e);
        patch(turnId, (t) => ({ ...t, confirmed: { ...t.confirmed, [nodeId]: 'error' } }));
      }
    },
    [patch],
  );

  const clear = useCallback((): void => {
    setTurns([]);
    clearThread();
  }, []);

  // Load a past turn (from the server history) into the thread as a read-only
  // completed turn. Skips if it's already present. The history DTO is SLIM
  // (Wave 2 P2.6): the turn lands immediately with the synthesis, then the
  // FULL trace is fetched to hydrate retrieved_sources + expert_contributions
  // + disagreement so the overlay/theses work on reopened debates. When the
  // trace expired (404) or yields nothing, the slim turn stays with a
  // "dettagli non più disponibili" note.
  const loadHistoryTurn = useCallback(
    (item: QaHistoryItem): void => {
      const isDup = (t: QaTurnModel): boolean =>
        t.state.status === 'success' && t.state.answer.trace_id === item.trace_id;
      // Early return via the render-scoped turns (fresh: deps include turns);
      // the updater re-checks so a StrictMode double-call stays a single turn.
      if (turns.some(isDup)) return;
      const answer: QaAnswer = {
        trace_id: item.trace_id,
        synthesis: item.synthesis,
        mode: item.mode,
        alternatives: null,
        sources: item.sources,
        retrieved_sources: [],
        experts_used: item.experts_used,
        confidence: item.confidence ?? 0,
        execution_time_ms: 0,
        // The slim history DTO carries neither the walk nor the trace — all
        // hydrate below from fetchQaTrace, same as retrieved_sources/contributions.
        graphTraversal: [],
        toolUsages: [],
        reactSteps: [],
      };
      const id = nextId();
      setTurns((prev) => {
        if (prev.some(isDup)) return prev;
        return [
          ...prev,
          { id, question: item.query, state: { status: 'success', answer }, confirmed: {}, historyDetail: 'loading' },
        ];
      });
      void fetchQaTrace(item.trace_id)
        .then((trace) => {
          const details = extractTraceDetails(trace);
          if (isEmptyTraceDetails(details)) {
            patch(id, (t) => ({ ...t, historyDetail: 'unavailable' }));
            return;
          }
          patch(id, (t) =>
            t.state.status === 'success'
              ? {
                  ...t,
                  historyDetail: 'hydrated',
                  state: {
                    status: 'success',
                    answer: {
                      ...t.state.answer,
                      retrieved_sources: details.retrievedSources,
                      expert_contributions: details.expertContributions,
                      disagreement_analysis: details.disagreement,
                      graphTraversal: details.graphTraversal,
                      toolUsages: details.toolUsages,
                      reactSteps: details.reactSteps,
                    },
                  },
                }
              : t,
          );
        })
        .catch(() => {
          // Expired/unreachable trace: keep the slim turn, note the gap.
          patch(id, (t) => ({ ...t, historyDetail: 'unavailable' }));
        });
    },
    [turns, patch],
  );

  return { turns, ask, refine, retry, cancel, rate, rateSrc, prefer, detailed, confirm, clear, loadHistoryTurn };
}
