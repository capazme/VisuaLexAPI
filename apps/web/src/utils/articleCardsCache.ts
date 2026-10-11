/** The cards under an article for the session, by address: one request per article however many
 *  copies of the row ask (the desktop panel and the phone view draw the same article at once). Only an
 *  answer is kept; a failure is asked again. Studia changes the cards (a save, a card to the trash, a
 *  restore from the trash): those call `invalidateArticleCards()`; logout calls `clearArticleCardsCache()`.
 *  A read that started before either never writes what it found: it is read again for the present.
 *  Tests: `src/test/setup.ts` clears it after each test. */
import { studiaService } from '../services/studiaService';
import type { SchedaDellArticolo } from '../types/studia';

const kept = new Map<string, SchedaDellArticolo[]>();
const inFlight = new Map<string, Promise<SchedaDellArticolo[]>>();
// Bumped whenever what is kept stops being true; a read keeps its answer only if it did not move.
let generation = 0;

/** What the session has read for this address, if anything. */
export function keptArticleCards(urn: string): SchedaDellArticolo[] | undefined {
  return kept.get(urn);
}

/** The cards of an article: the read already on its way, else a new one. */
export function readArticleCards(urn: string): Promise<SchedaDellArticolo[]> {
  const started = generation;
  const pending: Promise<SchedaDellArticolo[]> = studiaService
    .forArticle(urn)
    .then((cards) => {
      if (started === generation) {
        kept.set(urn, cards);
        return cards;
      }
      // The world changed while this was out (another account, or the cards themselves): not its answer.
      return inFlight.get(urn) ?? readArticleCards(urn);
    })
    .finally(() => {
      if (inFlight.get(urn) === pending) inFlight.delete(urn);
    });
  inFlight.set(urn, pending);
  return pending;
}

/** The read on its way for this address, if there is one. */
export function articleCardsInFlight(urn: string): Promise<SchedaDellArticolo[]> | undefined {
  return inFlight.get(urn);
}

/** The cards changed (saved, trashed, restored): what was kept is read again the next time it is shown. */
export function invalidateArticleCards(): void {
  generation += 1;
  kept.clear();
  inFlight.clear();
}

/** Everything kept, at logout: the next reader of this browser starts with nothing of the last one's. */
export function clearArticleCardsCache(): void {
  invalidateArticleCards();
}
