import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { studiaService } from '../../../services/studiaService';
import type { FiltriSchede, Materia, Scheda, StatoScheda, TipoScheda } from '../../../types/studia';

/** What the filter row holds; «da rileggere» stands for `origine=applicazione` with `stato=BOZZA_PERSONALE`. */
export interface FilterState {
  materia?: Materia;
  stato?: StatoScheda;
  tipo?: TipoScheda;
  normaKey?: string;
  daRileggere: boolean;
}

export const NO_FILTERS: FilterState = { daRileggere: false };

export interface ActOption {
  normaKey: string;
  label: string;
}

export type CardQuery = Omit<FiltriSchede, 'ordine' | 'limit' | 'offset'>;

export interface InstituteGroup {
  istituto: string;
  cards: Scheda[];
}

export interface SubjectGroup {
  materia: Materia;
  istituti: InstituteGroup[];
}

/** The pages, as subject → institute → cards, in the order they came: a group split across pages is one group. */
export function groupCards(cards: Scheda[]): SubjectGroup[] {
  const subjects = new Map<Materia, Map<string, Scheda[]>>();
  for (const card of cards) {
    const institutes = subjects.get(card.materia) ?? new Map<string, Scheda[]>();
    const group = institutes.get(card.istituto) ?? [];
    group.push(card);
    institutes.set(card.istituto, group);
    subjects.set(card.materia, institutes);
  }
  return [...subjects].map(([materia, institutes]) => ({
    materia,
    istituti: [...institutes].map(([istituto, group]) => ({ istituto, cards: group })),
  }));
}

/**
 * The user's cards for «Le mie schede», read page after page and merged. It always asks for
 * `ordine: 'materia'`, so the server keeps a subject (and an institute within it) contiguous
 * across pages. A change of filters starts again from the first page.
 */
export function useMyCards(filters: CardQuery) {
  const key = JSON.stringify(filters);
  const [cards, setCards] = useState<Scheda[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Only the latest request may write: an answer to an older filter is dropped.
  const latest = useRef(0);

  const load = useCallback(async (offset: number) => {
    const request = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const page = await studiaService.list({ ...(JSON.parse(key) as CardQuery), ordine: 'materia', ...(offset > 0 ? { offset } : {}) });
      if (request !== latest.current) return;
      setCards((before) => {
        if (offset === 0) return page.cards;
        const known = new Set(before.map((card) => card.id));
        return [...before, ...page.cards.filter((card) => !known.has(card.id))];
      });
      setNextOffset(page.nextOffset);
    } catch {
      if (request !== latest.current) return;
      // Cards of another filter would be read as this one's.
      if (offset === 0) {
        setCards([]);
        setNextOffset(null);
      }
      setError('Non riesco a leggere le schede. Riprova.');
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    void load(0);
  }, [load]);

  const loadMore = useCallback(() => {
    if (nextOffset !== null && !loading) void load(nextOffset);
  }, [load, loading, nextOffset]);
  const refresh = useCallback(() => load(0), [load]);

  const groups = useMemo(() => groupCards(cards), [cards]);

  return { cards, groups, loadMore, hasMore: nextOffset !== null, loading, error, refresh };
}
