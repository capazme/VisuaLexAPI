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
  /** The subject it was read for: an answer is never shown for another. */
  materia: Materia | undefined;
  data: Progressi | null;
  failed: boolean;
}

/**
 * The dashboard's one read (`GET /lingo/srs/progressi`, Studia progress spec D4), for the subject asked.
 * While a new read of the same subject travels the last answer stays on screen, marked loading, so the page
 * does not jump; an answer for another subject is never shown for this one (it would name one subject over another's
 * counts), and one for a subject chosen before never overwrites the one that came after. `reload` reads again.
 * With `enabled` false nothing is read (and what it returns is not meant to be used): «Oggi» reads a subject only
 * when one is chosen.
 */
export function useProgress(materia: Materia | undefined, enabled = true): ProgressState & { reload: () => void } {
  const [reads, setReads] = useState(0);
  const key = `${materia ?? ''}#${reads}`;
  const [answer, setAnswer] = useState<Answer>({ key: '', materia: undefined, data: null, failed: false });

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    studiaService.progress(materia).then(
      (data) => live && setAnswer({ key, materia, data, failed: false }),
      () => live && setAnswer((previous) => ({ key, materia, data: previous.materia === materia ? previous.data : null, failed: true })),
    );
    return () => {
      live = false;
    };
  }, [key, materia, enabled]);

  const reload = useCallback(() => setReads((n) => n + 1), []);
  if (answer.key !== key) return { status: 'loading', data: answer.materia === materia ? answer.data : null, reload };
  if (answer.failed || answer.data === null) return { status: 'error', data: answer.data, reload };
  return { status: 'ready', data: answer.data, reload };
}
