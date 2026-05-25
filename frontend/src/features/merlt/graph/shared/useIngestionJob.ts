import { useEffect, useState } from 'react';
import { fetchJobStatus } from './graphApi';
import { TERMINAL_JOB_STATUSES, type IngestionJobStatus } from './types';

const POLL_INTERVAL_MS = 2000;

export interface IngestionJobState {
  status: IngestionJobStatus | null;
  error: string | null;
  nodesCreated: number | null;
}

const IDLE: IngestionJobState = { status: null, error: null, nodesCreated: null };

/**
 * Poll a BFF ingestion job every 2s until it reaches a terminal status
 * (completed / failed / timeout). The interval is cleared on terminal status
 * and on unmount. A transient poll error is swallowed — the job may still
 * finish, and a real failure arrives as a terminal `failed` status.
 *
 * Pass `null`/`undefined` to disable polling (idle state).
 */
export function useIngestionJob(jobId: string | null | undefined): IngestionJobState {
  const [state, setState] = useState<IngestionJobState>(IDLE);

  // Reset to IDLE when the polled job changes (incl. → null). Done during
  // render — the React-sanctioned "adjust state on prop change" pattern — so we
  // never setState synchronously inside the effect (react-hooks rule, gotcha #11).
  const [trackedJobId, setTrackedJobId] = useState(jobId);
  if (jobId !== trackedJobId) {
    setTrackedJobId(jobId);
    setState(IDLE);
  }

  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stop = (): void => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const poll = async (): Promise<void> => {
      try {
        const res = await fetchJobStatus(jobId);
        if (cancelled) return;
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

    // Assign the interval BEFORE the immediate poll so a fast (<2s) terminal
    // response can clear a live handle rather than racing the assignment.
    intervalId = setInterval(() => void poll(), POLL_INTERVAL_MS);
    void poll();

    return () => {
      cancelled = true;
      stop();
    };
  }, [jobId]);

  return state;
}
