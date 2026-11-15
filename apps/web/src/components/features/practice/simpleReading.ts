import { createContext, useContext } from 'react';
import type { MenuItem } from '../../ui/MenuButton';
import type { Practice } from '../../../utils/practice';

/**
 * «Lettura semplice» (LC28, Luca, 15 November: «io ho semplicemente cercato l'articolo, voglio leggere l'articolo senza
 * overload di informazioni»): a practice that holds one article of one act, and nothing else, is read as that article
 * — no practice heading over it, no row heading repeating the article's own title, no grip or fold on the act. Nothing
 * is taken away: the practice's actions («Salva come dossier», «Rinomina», «Nuova pratica», «Chiudi la pratica») go to
 * the act's «⋯». A second article, act or decision brings the full table back.
 */
export function isSimplePractice(practice: Practice): boolean {
  return practice.acts.length === 1 && practice.acts[0].articles.length === 1 && practice.decisions.length === 0 && practice.beside.length === 0;
}

export interface SimpleReading {
  simple: boolean;
  /** The practice's own menu, appended to the act's «⋯» while the practice heading is not drawn. */
  practiceItems: MenuItem[];
}

export const SimpleReadingContext = createContext<SimpleReading>({ simple: false, practiceItems: [] });

export const useSimpleReading = () => useContext(SimpleReadingContext);
