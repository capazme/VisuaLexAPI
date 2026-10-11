import type { NormaVisitata } from '../../../types';
import { isStudiaEnabled } from '../../../features/studia/featureFlag';

/**
 * The address the cards of an article are read by: the reader's own `norma_data.urn`, when it is a
 * Normattiva one (the server cuts it at `urn:`). An act of the Union has none, and so has no cards;
 * with the feature off nothing is read either.
 */
export function cardsUrnOf(norma: Pick<NormaVisitata, 'urn'>): string | undefined {
  if (!isStudiaEnabled()) return undefined;
  const urn = norma.urn?.trim();
  return urn && urn.includes('urn:') ? urn : undefined;
}

/** Whether the reader offers a new card on this text: a row exists and the text is the one in force. */
export function offersNewCard(norma: Pick<NormaVisitata, 'urn'>, historical: boolean): boolean {
  return cardsUrnOf(norma) !== undefined && !historical;
}
