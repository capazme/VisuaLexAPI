import { useEffect, useState } from 'react';
import { searchRassegne } from '../../../services/rassegneService';
import { searchWords } from './rassegnaFilters';
import { failureOf } from './useRassegne';
import type { RassegneSearchResponse } from './types';

/** The pause after the last key before ⌘K asks the reviews, as the panel's filter waits. */
export const RASSEGNE_TOPIC_DELAY_MS = 350;

export interface RassegneForTopic {
  /** the words asked (`searchWords`) */
  q: string;
  /** the first page, or 'error' when the reviews did not answer */
  answer: RassegneSearchResponse | 'error';
}

/**
 * The reviews' passages for the topic typed in ⌘K (U3): asked once the words have stood still for 350 ms, in a POST's
 * body (never an address). Null while there is nothing to show for the words as they are now: an answer that comes
 * after they changed is dropped. The words never reach the console (`failureOf`).
 */
export function useRassegneForTopic(topic: string | null): RassegneForTopic | null {
  const words = topic ? searchWords(topic) : null;
  const q = words?.kind === 'words' ? words.q : null;
  const [found, setFound] = useState<RassegneForTopic | null>(null);

  useEffect(() => {
    if (!q) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      searchRassegne({ q }).then(
        (data) => {
          if (live) setFound({ q, answer: Array.isArray(data?.items) ? data : 'error' });
        },
        (err: unknown) => {
          if (!live) return;
          console.error('[rassegne] palette search failed', { error: failureOf(err) });
          setFound({ q, answer: 'error' });
        },
      );
    }, RASSEGNE_TOPIC_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  return found && found.q === q ? found : null;
}
