import { useEffect, useState } from 'react';
import { fetchExtractionJobStatus } from './contribApi';
import { TERMINAL_EXTRACTION_STATUSES, type ExtractionJobStatus } from './types';

const POLL_INTERVAL_MS = 2000;

export interface ExtractionJobState {
  status: ExtractionJobStatus | null;
  error: string | null;
  candidatesCreated: number | null;
}

const IDLE: ExtractionJobState = { status: null, error: null, candidatesCreated: null };

/**
 * Poll a BFF extraction job every 2s until terminal (completed/failed/timeout).
 * Mirrors useIngestionJob (Slice 2a): interval cleared on terminal + unmount,
 * transient poll errors swallowed, state reset on job change during render
 * (no synchronous in-effect setState — gotcha #11). Pass null to disable.
 */
export function useExtractionJob(jobId: string | null | undefined): ExtractionJobState {
  const [state, setState] = useState<ExtractionJobState>(IDLE);

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
        const res = await fetchExtractionJobStatus(jobId);
        if (cancelled) return;
        setState({
          status: res.status,
          error: res.error ?? null,
          candidatesCreated: res.candidatesCreated ?? null,
        });
        if (TERMINAL_EXTRACTION_STATUSES.has(res.status)) stop();
      } catch {
        // Transient poll failure — keep polling; a terminal status will arrive.
      }
    };

    intervalId = setInterval(() => void poll(), POLL_INTERVAL_MS);
    void poll();

    return () => {
      cancelled = true;
      stop();
    };
  }, [jobId]);

  return state;
}
