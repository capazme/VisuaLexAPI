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
 * celebration a day, also when the goal is reached again after being raised. A convenience of this
 * browser, never the source of the streak; without storage it lasts for the visit.
 */
export function useCelebratedToday(): { celebrated: (giorno: string) => boolean; markCelebrated: (giorno: string) => void } {
  const [day, setDay] = useState<string | null>(readCelebrated);
  const celebrated = useCallback((giorno: string) => day === giorno, [day]);
  const markCelebrated = useCallback((giorno: string) => {
    setDay(giorno);
    try {
      localStorage.setItem(STORAGE_KEY, giorno);
    } catch {
      // Private mode or a full store: remembered for this visit only.
    }
  }, []);
  return { celebrated, markCelebrated };
}
