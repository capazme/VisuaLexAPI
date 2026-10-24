import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../../store/useAppStore';
import type { DossierItem } from '../../../types';
import type { ParsedCitationData } from '../../../utils/citationMatcher';
import type { CitedNorms } from '../decisions/DecisionReadingSurface';
import type { ActBlock } from './dossierLayout';
import { bringRowIntoView, citedArticleOf } from './citedNorm';

/** How the dossier's decisions open the norms they cite (D7d); outside the dossier there is none. */
export const CitedNormsContext = createContext<CitedNorms | null>(null);

/** The row a cited norm opened: a ring for 1.6 s, as «Vai al passo» glows. No motion: it comes and goes at once. */
const ROW_FLASH = ['ring-2', 'ring-inset', 'ring-amber-400'];

type NormaItem = Extract<DossierItem, { type: 'norma' }>;

interface Options {
  /** The whole dossier: a norm hidden by the page's search is still the dossier's. */
  items: DossierItem[];
  /** What the page's search leaves on screen. */
  visibleItems: DossierItem[];
  /** Every act of the dossier, to unfold the one that holds the article. */
  acts: ActBlock[];
  unfoldAct: (key: string) => void;
  expand: (itemId: string) => void;
  clearSearch: () => void;
}

/**
 * A norm a dossier's decision cites (D7d). Held by the dossier, it opens in the norms' column: the search that hides it
 * is cleared, its act unfolds (and folds again only when the user folds it), its row opens, comes into view without
 * moving the decision (`bringRowIntoView`), takes the focus and glows. Not held, a click offers the choice
 * (`CitedNormChoice`: Dashboard, or a dossier) and opens nothing by itself; the preview's «Apri nella pratica» is
 * already a choice, and goes to Dashboard as before.
 */
export function useCitedNorms({ items, visibleItems, acts, unfoldAct, expand, clearSearch }: Options) {
  const navigate = useNavigate();
  const triggerSearch = useAppStore((s) => s.triggerSearch);
  const columnRef = useRef<HTMLElement>(null);
  const [choice, setChoice] = useState<{ citation: ParsedCitationData; link: HTMLElement } | null>(null);
  // The row to bring into view once the render that opens it is drawn; `reveals` counts the requests.
  const pending = useRef<string | null>(null);
  const [reveals, setReveals] = useState(0);

  useEffect(() => {
    const id = pending.current;
    const column = columnRef.current;
    if (!id || !column) return;
    pending.current = null;
    const rows = column.querySelectorAll<HTMLElement>('[data-dossier-item]');
    const row = Array.from(rows).find((el) => el.dataset.dossierItem === id);
    if (!row) return;
    bringRowIntoView(row, column);
    row.querySelector<HTMLElement>('[aria-expanded]')?.focus({ preventScroll: true });
    row.classList.add(...ROW_FLASH);
    const timer = window.setTimeout(() => row.classList.remove(...ROW_FLASH), 1600);
    return () => {
      window.clearTimeout(timer);
      row.classList.remove(...ROW_FLASH);
    };
  }, [reveals]);

  const reveal = useCallback((item: NormaItem) => {
    if (!visibleItems.some((i) => i.id === item.id)) clearSearch();
    const act = acts.find((a) => a.articles.some((i) => i.id === item.id));
    if (act) unfoldAct(act.key);
    expand(item.id);
    pending.current = item.id;
    setReveals((n) => n + 1);
  }, [visibleItems, acts, clearSearch, unfoldAct, expand]);

  // As a decision read outside a practice opens a cited norm: a search of the text in force, on Dashboard.
  const openOnDashboard = useCallback((citation: ParsedCitationData) => {
    triggerSearch({
      act_type: citation.act_type,
      act_number: citation.act_number || '',
      date: citation.date || '',
      article: citation.article,
      version: 'vigente',
    });
    navigate('/');
  }, [triggerSearch, navigate]);

  const citedNorms = useMemo<CitedNorms>(() => ({
    holds: (citation) => citedArticleOf(items, citation) !== null,
    open: (citation, link) => {
      const item = citedArticleOf(items, citation);
      if (item) reveal(item);
      else if (link) setChoice({ citation, link });
      else openOnDashboard(citation);
    },
  }), [items, reveal, openOnDashboard]);

  const closeChoice = useCallback(() => setChoice(null), []);

  return { citedNorms, columnRef, choice, closeChoice, openOnDashboard };
}
