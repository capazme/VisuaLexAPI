import { useCallback, useEffect, useState } from 'react';
import { studiaService } from '../../../services/studiaService';
import type { SchedaDellArticolo } from '../../../types/studia';

const NO_CARDS: SchedaDellArticolo[] = [];

// What the session has read, by address, and the reads on their way (the desktop panel and the
// phone view draw the same article at once). Only an answer is kept; a failure is asked again.
const kept = new Map<string, SchedaDellArticolo[]>();
const inFlight = new Map<string, Promise<SchedaDellArticolo[]>>();

function read(urn: string): Promise<SchedaDellArticolo[]> {
  const pending = studiaService
    .forArticle(urn)
    .then((cards) => {
      kept.set(urn, cards);
      return cards;
    })
    .finally(() => {
      if (inFlight.get(urn) === pending) inFlight.delete(urn);
    });
  inFlight.set(urn, pending);
  return pending;
}

/** Everything kept, at logout: the next reader of this browser starts with nothing of the last one's. */
export function clearArticleCardsCache(): void {
  kept.clear();
  inFlight.clear();
}

export type ArticleCardsStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** The last answer this copy got, with the address it was for: an answer for another address is not this one's. */
type Answer = { urn: string; cards: SchedaDellArticolo[] } | { urn: string; failed: true };

/**
 * The cards resting on an article (`/api/lingo/articolo`), by the address the reader holds. Read when
 * the article is shown, kept for the session per address, and read again by `refresh()` after a
 * save. An answer that comes back after the address changed is dropped.
 */
export function useArticleCards(urn: string | undefined) {
  const [answer, setAnswer] = useState<Answer | null>(null);

  const fromKept = urn ? kept.get(urn) : undefined;
  const current = answer && answer.urn === urn ? answer : null;
  const cards = fromKept ?? (current && 'cards' in current ? current.cards : NO_CARDS);
  const status: ArticleCardsStatus = !urn ? 'idle' : fromKept || (current && 'cards' in current) ? 'ready' : current ? 'failed' : 'loading';

  useEffect(() => {
    if (!urn || kept.has(urn)) return;
    let live = true;
    (inFlight.get(urn) ?? read(urn)).then(
      (found) => live && setAnswer({ urn, cards: found }),
      () => live && setAnswer({ urn, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [urn]);

  const refresh = useCallback(async () => {
    if (!urn) return;
    try {
      const fresh = await read(urn);
      setAnswer({ urn, cards: fresh });
    } catch {
      // The count stays as it was: the save itself went through.
    }
  }, [urn]);

  return { cards, count: cards.length, status, refresh };
}
