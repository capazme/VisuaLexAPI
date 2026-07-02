import { useEffect, useState } from 'react';
import { fetchJobStatus } from './graphApi';
import { TERMINAL_JOB_STATUSES, type IngestionJobStatus } from './types';

const POLL_INTERVAL_MS = 2000;
/** Total polling budget: past this we give up and surface a client-side
 *  timeout so the UI never shows an unbounded spinner (design §3.4). */
const DEFAULT_POLL_BUDGET_MS = 60_000;

/** Sentinel error set when the client-side polling budget runs out (the job
 *  may still be running server-side — the UI treats it as "unreachable"). */
export const POLL_BUDGET_EXHAUSTED = 'poll_budget_exhausted';

export interface IngestionJobState {
  status: IngestionJobStatus | null;
  error: string | null;
  nodesCreated: number | null;
}

const IDLE: IngestionJobState = { status: null, error: null, nodesCreated: null };

/**
 * Poll a BFF ingestion job every 2s until it reaches a terminal status
 * (completed / failed / timeout) or the total polling budget (default 60s)
 * is exhausted — in which case the state transitions to `timeout` with the
 * POLL_BUDGET_EXHAUSTED error and polling stops. A transient poll error is
 * swallowed — the job may still finish, and a real failure arrives as a
 * terminal `failed` status.
 *
 * Pass `null`/`undefined` to disable polling (idle state).
 */
export function useIngestionJob(
  jobId: string | null | undefined,
  budgetMs: number = DEFAULT_POLL_BUDGET_MS
): IngestionJobState {
  const [state, setState] = useState<IngestionJobState>(IDLE);

  // Reset to IDLE when the polled job changes (incl. → null). Done during
  // render — the React-sanctioned "adjust state on prop change" pattern — so we
  // never setState synchronously inside the effect (react-hooks rule, gotcha #11).
  const [tracked, setTracked] = useState({ jobId, budgetMs });
  if (jobId !== tracked.jobId || budgetMs !== tracked.budgetMs) {
    setTracked({ jobId, budgetMs });
    setState(IDLE);
  }

  useEffect(() => {
    if (!jobId) return;

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

    const poll = async (): Promise<void> => {
      try {
        const res = await fetchJobStatus(jobId);
        // An in-flight poll resolving after budget exhaustion must not
        // overwrite the timeout state with a stale "running".
        if (cancelled || exhausted) return;
        setState({
          status: res.status,
          error: res.error ?? null,
          nodesCreated: res.nodesCreated ?? null,
        });
        if (TERMINAL_JOB_STATUSES.has(res.status)) stop();
      } catch {
        // Transient poll failure — keep polling; a terminal status will arrive.
      }
    };

    budgetId = setTimeout(() => {
      if (cancelled) return;
      exhausted = true;
      stop();
      setState({ status: 'timeout', error: POLL_BUDGET_EXHAUSTED, nodesCreated: null });
    }, budgetMs);

    // Assign the interval BEFORE the immediate poll so a fast (<2s) terminal
    // response can clear a live handle rather than racing the assignment.
    intervalId = setInterval(() => void poll(), POLL_INTERVAL_MS);
    void poll();

    return () => {
      cancelled = true;
      stop();
    };
  }, [jobId, budgetMs]);

  return state;
}
