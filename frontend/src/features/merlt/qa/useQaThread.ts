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

  // Persist the thread whenever it changes (saveThread keeps only completed
  // turns + caps the count). setState is never called here.
  useEffect(() => {
    saveThread(turns);
  }, [turns]);

  const patch = useCallback((id: string, fn: (t: QaTurnModel) => QaTurnModel): void => {
    setTurns((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  const run = useCallback(
    async (id: string, work: () => Promise<QaAnswer>): Promise<void> => {
      const token = (tokens.current[id] = (tokens.current[id] ?? 0) + 1);
      try {
        const answer = await work();
        if (tokens.current[id] === token) patch(id, (t) => ({ ...t, state: { status: 'success', answer } }));
      } catch (err) {
        if (tokens.current[id] === token) {
          patch(id, (t) => ({
            ...t,
            state: { status: 'error', error: err instanceof Error ? err.message : 'Errore' },
          }));
        }
      }
    },
    [patch],
  );

  const ask = useCallback(
    async (question: string, mode: QaMode): Promise<void> => {
      const id = nextId();
      setTurns((prev) => [...prev, { id, question, state: { status: 'loading' }, confirmed: {} }]);
      await run(id, () => askQuestion(question, mode));
    },
    [run],
  );

  const refine = useCallback(
    async (traceId: string, followUp: string): Promise<void> => {
      const id = nextId();
      setTurns((prev) => [...prev, { id, question: followUp, state: { status: 'loading' }, confirmed: {} }]);
      await run(id, () => refineQuestion(traceId, followUp));
    },
    [run],
  );

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

  return { turns, ask, refine, rate, rateSrc, prefer, detailed, confirm, clear, loadHistoryTurn };
}
