import { useEffect, useState } from 'react';
import { getBatch, type GetBatchParams } from './opsIngestionApi';
import { TRANSIENT_BATCH_STATUSES, type BatchDetail, type IngestionBatchStatus } from './types';

const POLL_INTERVAL_MS = 2000;
/** Total polling budget: past this we give up and surface a client-side
 *  timeout so the UI never shows an unbounded spinner (mirrors
 *  graph/shared/useIngestionJob.ts's budget rationale). */
const DEFAULT_POLL_BUDGET_MS = 60_000;

/** Sentinel status set when the client-side polling budget runs out — the
 *  batch may still be running server-side; the UI treats it as "unreachable". */
export const POLL_BUDGET_EXHAUSTED = 'poll_budget_exhausted';

export type BatchPollStatus = IngestionBatchStatus | 'timeout';

export interface BatchPollState {
  /** null while idle (no batchId) or before the first poll response arrives. */
  status: BatchPollStatus | null;
  batch: BatchDetail | null;
  error: string | null;
}

const IDLE: BatchPollState = { status: null, batch: null, error: null };

export interface UseBatchPollOptions {
  budgetMs?: number;
  nodeLimit?: number;
  edgeLimit?: number;
  /**
   * Bump this (e.g. an incrementing counter) to force a fresh poll cycle —
   * a new immediate fetch + a new budget window — WITHOUT resetting the
   * currently displayed `batch`/`status` to idle first. Used after an admin
   * action (promote/reject) transitions the batch server-side but the poll
   * loop had already stopped because the last-seen status was non-transient
   * (e.g. pending_review). Intentionally excluded from the IDLE-reset
   * comparison below so there's no flash back to a blank state.
   */
  restartToken?: number;
}

/**
 * Poll GET /ops/ingestion/batches/:batchId every 2s while the batch is in a
 * transient status (parsing / promoting) — there is no separate job-status
 * endpoint for this pipeline (unlike graph lazy-ingestion), so the batch
 * detail fetch doubles as both the poll target and the data source for the
 * detail panel (conflict report + node/edge samples come back on every poll).
 *
 * Stops once the status leaves the transient set (pending_review / promoted /
 * rejected / failed) or the poll budget (default 60s) is exhausted. Pass
 * `null`/`undefined` batchId to disable polling (idle state).
 */
export function useBatchPoll(
  batchId: string | null | undefined,
  options: UseBatchPollOptions = {}
): BatchPollState {
  const budgetMs = options.budgetMs ?? DEFAULT_POLL_BUDGET_MS;
  const nodeLimit = options.nodeLimit;
  const edgeLimit = options.edgeLimit;
  const restartToken = options.restartToken ?? 0;

  const [state, setState] = useState<BatchPollState>(IDLE);

  // Reset to IDLE when the polled target changes (incl. → null) or the
  // budget changes. Done during render — the React-sanctioned "adjust state
  // on prop change" pattern — so we never setState synchronously inside the
  // effect (react-hooks/set-state-in-effect, repo gotcha #11).
  //
  // `nodeLimit`/`edgeLimit` are intentionally EXCLUDED from this tracker:
  // they only affect sample pagination ("Carica altri"), and resetting to
  // IDLE on every page bump would blank the whole detail panel (conflict
  // report, promote/reject buttons) mid-interaction. They still belong in
  // the effect's deps below so a limit change triggers a fresh fetch — just
  // one that paginates in place, same as `restartToken`.
  const [tracked, setTracked] = useState({ batchId, budgetMs });
  if (batchId !== tracked.batchId || budgetMs !== tracked.budgetMs) {
    setTracked({ batchId, budgetMs });
    setState(IDLE);
  }

  useEffect(() => {
    if (!batchId) return;

    let cancelled = false;
    let exhausted = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let budgetId: ReturnType<typeof setTimeout> | null = null;

    const stop = (): void => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (budgetId) {
        clearTimeout(budgetId);
        budgetId = null;
      }
    };

    const params: GetBatchParams = {};
    if (nodeLimit !== undefined) params.nodeLimit = nodeLimit;
    if (edgeLimit !== undefined) params.edgeLimit = edgeLimit;

    const poll = async (): Promise<void> => {
      try {
        const batch = await getBatch(batchId, params);
        // An in-flight poll resolving after budget exhaustion must not
        // overwrite the timeout state with a stale "running".
        if (cancelled || exhausted) return;
        setState({ status: batch.status, batch, error: batch.error });
        if (!TRANSIENT_BATCH_STATUSES.has(batch.status)) stop();
      } catch (err) {
        // Transient poll failure — keep polling; a real failure eventually
        // surfaces as a terminal `failed` status from the server. Logged per
        // the no-silent-catch rule (repo gotcha #18) even though we retry.
        console.error('useBatchPoll: poll failed, retrying:', err);
      }
    };

    budgetId = setTimeout(() => {
      if (cancelled) return;
      exhausted = true;
      stop();
      setState((prev) => ({ status: 'timeout', batch: prev.batch, error: POLL_BUDGET_EXHAUSTED }));
    }, budgetMs);

    // Assign the interval BEFORE the immediate poll so a fast (<2s) terminal
    // response can clear a live handle rather than racing the assignment.
    intervalId = setInterval(() => void poll(), POLL_INTERVAL_MS);
    void poll();

    return () => {
      cancelled = true;
      stop();
    };
    // `restartToken` intentionally forces a re-run (fresh immediate poll + budget)
    // without going through the `tracked`/IDLE-reset path above.
  }, [batchId, budgetMs, nodeLimit, edgeLimit, restartToken]);

  return state;
}
