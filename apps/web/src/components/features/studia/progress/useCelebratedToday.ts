import { useCallback, useState } from 'react';

const STORAGE_KEY = 'visualex.studia.festeggiato';

function readCelebrated(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The Rome day this browser last celebrated the goal (Studia progress spec §6.4, decision 10): one
 * celebration a day, also when the goal is reached again after being raised. The day is written when a
 * celebration *starts*, so leaving the page halfway through, or a new read of the page, never plays it
 * twice; `celebratedBefore` answers what was stored when the component mounted, so the celebration that
 * just started is not cut short by its own mark. A convenience of this browser, never the streak's source.
 */
export function useCelebratedToday(): { celebratedBefore: (giorno: string) => boolean; markCelebrated: (giorno: string) => void } {
  const [atMount] = useState<string | null>(readCelebrated);
  const celebratedBefore = useCallback((giorno: string) => atMount === giorno, [atMount]);
  const markCelebrated = useCallback((giorno: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, giorno);
    } catch {
      // Private mode or a full store: the next visit may celebrate again.
    }
  }, []);
  return { celebratedBefore, markCelebrated };
}
