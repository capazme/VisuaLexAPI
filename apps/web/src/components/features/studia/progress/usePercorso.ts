import { useCallback, useEffect, useState } from 'react';
import { studiaService } from '../../../../services/studiaService';
import type { TappaIstituto } from '../../../../types/studia';

export type PercorsoState =
  | { status: 'loading'; data: TappaIstituto[] | null }
  | { status: 'error'; data: TappaIstituto[] | null }
  | { status: 'ready'; data: TappaIstituto[] };

/**
 * The road's read by institute (`GET /lingo/srs/percorso`, Gymnasium spec §6, G5), every subject at once: the
 * subjects' «N da ripassare» and, inside each, its institutes. A read of its own, so the missions and «Inizia»
 * never wait on it or fail with it. While a new read travels the last answer stays on screen; a failed read
 * again keeps it too, marked failed. `reload` reads again.
 */
export function usePercorso(): PercorsoState & { reload: () => void } {
  const [reads, setReads] = useState(0);
  const [answer, setAnswer] = useState<{ read: number; data: TappaIstituto[] | null; failed: boolean }>({ read: -1, data: null, failed: false });

  useEffect(() => {
    let live = true;
    studiaService.percorso().then(
      (data) => live && setAnswer({ read: reads, data, failed: false }),
      () => live && setAnswer((previous) => ({ read: reads, data: previous.data, failed: true })),
    );
    return () => {
      live = false;
    };
  }, [reads]);

  const reload = useCallback(() => setReads((n) => n + 1), []);
  if (answer.read !== reads) return { status: 'loading', data: answer.data, reload };
  if (answer.failed || answer.data === null) return { status: 'error', data: answer.data, reload };
  return { status: 'ready', data: answer.data, reload };
}
