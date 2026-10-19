import { useCallback, useEffect, useState } from 'react';
import { studiaService } from '../../../../services/studiaService';
import type { Materia, Progressi } from '../../../../types/studia';

export type ProgressState =
  | { status: 'loading'; data: Progressi | null }
  | { status: 'error'; data: Progressi | null }
  | { status: 'ready'; data: Progressi };

interface Answer {
  /** The read this answers: the subject and the count of «read again». */
  key: string;
  data: Progressi | null;
  failed: boolean;
}

/**
 * The dashboard's one read (`GET /lingo/srs/progressi`, Studia progress spec D4), for the subject asked.
 * While a new read travels the last answer stays on screen, marked loading, so the page does not jump;
 * an answer for a subject chosen before never overwrites the one that came after. `reload` reads again.
 * With `enabled` false nothing is read (and what it returns is not meant to be used): «Oggi» reads a subject only
 * when one is chosen.
 */
export function useProgress(materia: Materia | undefined, enabled = true): ProgressState & { reload: () => void } {
  const [reads, setReads] = useState(0);
  const key = `${materia ?? ''}#${reads}`;
  const [answer, setAnswer] = useState<Answer>({ key: '', data: null, failed: false });

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    studiaService.progress(materia).then(
      (data) => live && setAnswer({ key, data, failed: false }),
      () => live && setAnswer((previous) => ({ key, data: previous.data, failed: true })),
    );
    return () => {
      live = false;
    };
  }, [key, materia, enabled]);

  const reload = useCallback(() => setReads((n) => n + 1), []);
  if (answer.key !== key) return { status: 'loading', data: answer.data, reload };
  if (answer.failed || answer.data === null) return { status: 'error', data: answer.data, reload };
  return { status: 'ready', data: answer.data, reload };
}
