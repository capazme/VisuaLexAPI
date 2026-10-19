import { useEffect, useState } from 'react';
import { cardSourcesAnswer } from '../../../services/healthService';

/**
 * Whether a card can be written now from typed references: the sources are asked once when the view
 * mounts (`cardSourcesAnswer`). `undefined` while the answer travels, then true or false. «+ Nuova
 * scheda» in Le mie schede is offered only on true (Gymnasium spec §8, point 5): with the sources down
 * the form could only fail.
 */
export function useCardSources(): boolean | undefined {
  const [answer, setAnswer] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    cardSourcesAnswer(controller.signal).then(setAnswer, () => {
      // Aborted: the view went before the answer.
    });
    return () => controller.abort();
  }, []);
  return answer;
}
