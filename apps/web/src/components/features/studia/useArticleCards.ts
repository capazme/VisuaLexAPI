import { useCallback, useEffect, useState } from 'react';
import type { SchedaDellArticolo } from '../../../types/studia';
import { articleCardsInFlight, keptArticleCards, readArticleCards } from '../../../utils/articleCardsCache';

const NO_CARDS: SchedaDellArticolo[] = [];

export type ArticleCardsStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** The last answer this copy got, with the address it was for: an answer for another address is not this one's. */
type Answer = { urn: string; cards: SchedaDellArticolo[] } | { urn: string; failed: true };

/**
 * The cards resting on an article (`/api/lingo/articolo`), by the address the reader holds. Read when
 * the article is shown, kept for the session per address (`utils/articleCardsCache.ts`), and read
 * again by `refresh()` after a save. An answer that comes back after the address changed is dropped.
 */
export function useArticleCards(urn: string | undefined) {
  const [answer, setAnswer] = useState<Answer | null>(null);

  const fromKept = urn ? keptArticleCards(urn) : undefined;
  const current = answer && answer.urn === urn ? answer : null;
  const cards = fromKept ?? (current && 'cards' in current ? current.cards : NO_CARDS);
  const status: ArticleCardsStatus = !urn ? 'idle' : fromKept || (current && 'cards' in current) ? 'ready' : current ? 'failed' : 'loading';

  useEffect(() => {
    if (!urn || keptArticleCards(urn)) return;
    let live = true;
    (articleCardsInFlight(urn) ?? readArticleCards(urn)).then(
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
      const fresh = await readArticleCards(urn);
      setAnswer({ urn, cards: fresh });
    } catch {
      // The count stays as it was: the save itself went through.
    }
  }, [urn]);

  return { cards, count: cards.length, status, refresh };
}
