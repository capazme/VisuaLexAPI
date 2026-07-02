import { useCallback, useEffect, useRef, useState } from 'react';
import {
  askQuestion,
  refineQuestion,
  rateAnswer,
  rateSource,
  preferExpert,
  rateDetailed,
  confirmSource,
} from './qaApi';
import { loadThread, saveThread, clearThread } from './qaThreadStorage';
import type { QaMode, QaTurnModel, QaRetrievedSource, QaAnswer, QaHistoryItem } from './types';

let seq = 0;
const nextId = (): string => `turn-${++seq}`;

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
  const [turns, setTurns] = useState<QaTurnModel[]>(() => loadThread());
  const tokens = useRef<Record<string, number>>({});
  // One AbortController per in-flight turn, so the user can cancel the up-to-120s
  // wait (design §3.5 "Annulla"). Cleared once the turn settles.
  const controllers = useRef<Record<string, AbortController>>({});

  // Persist the thread whenever it changes (saveThread keeps only completed
  // turns + caps the count). setState is never called here.
  useEffect(() => {
    saveThread(turns);
  }, [turns]);

  const patch = useCallback((id: string, fn: (t: QaTurnModel) => QaTurnModel): void => {
    setTurns((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  const run = useCallback(
    async (id: string, work: (signal: AbortSignal) => Promise<QaAnswer>): Promise<void> => {
      const token = (tokens.current[id] = (tokens.current[id] ?? 0) + 1);
      const controller = new AbortController();
      controllers.current[id] = controller;
      try {
        const answer = await work(controller.signal);
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

  const ask = useCallback(
    async (question: string, mode: QaMode): Promise<void> => {
      const id = nextId();
      setTurns((prev) => [
        ...prev,
        { id, question, state: { status: 'loading', startedAt: Date.now() }, confirmed: {}, request: { kind: 'ask', mode } },
      ]);
      await run(id, (signal) => askQuestion(question, mode, undefined, signal));
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
      await run(turnId, (signal) =>
        req.kind === 'ask'
          ? askQuestion(turn.question, req.mode, undefined, signal)
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
        await confirmSource(nodeId, source.urn);
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
  // completed turn. Skips if it's already present. retrieved_sources aren't
  // persisted server-side, so the provenance panel is empty for history turns.
  const loadHistoryTurn = useCallback((item: QaHistoryItem): void => {
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
    };
    setTurns((prev) => {
      if (prev.some((t) => t.state.status === 'success' && t.state.answer.trace_id === item.trace_id)) {
        return prev;
      }
      return [...prev, { id: nextId(), question: item.query, state: { status: 'success', answer }, confirmed: {} }];
    });
  }, []);

  return { turns, ask, refine, retry, cancel, rate, rateSrc, prefer, detailed, confirm, clear, loadHistoryTurn };
}
