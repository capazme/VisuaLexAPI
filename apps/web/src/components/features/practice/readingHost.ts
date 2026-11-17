import { createContext, useContext } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import type { SearchParams } from '../../../types';
import { isBoundPractice, type Practice } from '../../../utils/practice';

/**
 * Who hosts a reading (LC52 c2): where the reader's search gestures go — a norm of another act, «testo al…», «vai al
 * vigente», the act's arrows. In the Corpus the host is `SearchPanel`: the store's `triggerSearch`, which it drains, as
 * before. A reader with no host around it (the dossier's own readers) does the same. The PDF and a norm of the same act
 * are the containers' props (`onViewPdf`, `onCrossReference`), which the host passes.
 */
export interface ReadingHost {
  search: (params: SearchParams) => void;
  /**
   * The dossier a bound table reads (LC55 c4): its rows say whether they are in it, and add to it or leave it. Absent in
   * the Corpus, whose rows say nothing of a dossier. `onTrashChanged`: the page's trash, read again after a removal;
   * `showToast`: the page's message, after an add from a row (LC58).
   */
  dossier?: { id: string; onTrashChanged?: () => void; showToast?: (message: string, type?: 'success' | 'error' | 'info') => void };
}

export const ReadingHostContext = createContext<ReadingHost | null>(null);

/** The host's search; without a host, `fallback` (the store's `triggerSearch` the reader already holds). */
export function useReadingSearch(fallback: (params: SearchParams) => void): (params: SearchParams) => void {
  return useContext(ReadingHostContext)?.search ?? fallback;
}

/** The dossier the reading's host writes to (LC55), or undefined outside a dossier's «Lettura». */
export function useHostDossier(): ReadingHost['dossier'] {
  return useContext(ReadingHostContext)?.dossier;
}

/** The practice a reading container shows: `practiceId`'s when given (none if it is not open), else the Corpus's active one. */
export function useHostedPractice(practiceId?: string): Practice | undefined {
  return useAppStore((s) => s.practices.find((p) => (practiceId !== undefined
    ? p.id === practiceId
    : p.id === s.activePracticeId && !isBoundPractice(p))));
}
