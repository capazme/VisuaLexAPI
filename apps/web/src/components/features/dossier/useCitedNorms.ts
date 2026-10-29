import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../../store/useAppStore';
import type { DossierItem } from '../../../types';
import type { ParsedCitationData } from '../../../utils/citationMatcher';
import type { CitedNorms } from '../decisions/DecisionReadingSurface';
import type { ActBlock } from './dossierLayout';
import { bringRowIntoView, citedArticleOf, keepLinkAt } from './citedNorm';

/** How the dossier's decisions open the norms they cite (D7d); outside the dossier there is none. */
export const CitedNormsContext = createContext<CitedNorms | null>(null);

/** How long the row a cited norm opened keeps its ring (`DossierArticleRow`'s `isFlashing`), as «Vai al passo» glows. */
const FLASH_MS = 1600;

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
 * moving the decision (`bringRowIntoView`; the link clicked is held where it was, `keepLinkAt`, the cleared search
 * having made the decision's column a scroller again), takes the focus and is ringed for 1.6 s (`flashedId`). Not held, a click offers the choice
 * (`CitedNormChoice`: Dashboard, or a dossier) and opens nothing by itself; the preview's button, «Apri su Dashboard»
 * there, is already a choice, and goes to Dashboard as before.
 */
export function useCitedNorms({ items, visibleItems, acts, unfoldAct, expand, clearSearch }: Options) {
  const navigate = useNavigate();
  const triggerSearch = useAppStore((s) => s.triggerSearch);
  const columnRef = useRef<HTMLElement>(null);
  const [choice, setChoice] = useState<{ citation: ParsedCitationData; link: HTMLElement } | null>(null);
  // The row to bring into view once the render that opens it is drawn, and the link clicked with its height then;
  // `reveals` counts the requests.
  const pending = useRef<{ id: string; link: HTMLElement | null; linkTop: number } | null>(null);
  const [reveals, setReveals] = useState(0);
  // The row ringed now; React draws the ring, never a class set from here.
  const [flashedId, setFlashedId] = useState<string | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  useEffect(() => {
    const asked = pending.current;
    const column = columnRef.current;
    if (!asked || !column) return;
    pending.current = null;
    if (asked.link) keepLinkAt(asked.link, asked.linkTop);
    const { id } = asked;
    const rows = column.querySelectorAll<HTMLElement>('[data-dossier-item]');
    const row = Array.from(rows).find((el) => el.dataset.dossierItem === id);
    if (!row) return;
    bringRowIntoView(row, column);
    row.querySelector<HTMLElement>('[aria-expanded]')?.focus({ preventScroll: true });
  }, [reveals]);

  const reveal = useCallback((item: NormaItem, link: HTMLElement | null) => {
    if (!visibleItems.some((i) => i.id === item.id)) clearSearch();
    const act = acts.find((a) => a.articles.some((i) => i.id === item.id));
    if (act) unfoldAct(act.key);
    expand(item.id);
    pending.current = { id: item.id, link, linkTop: link?.getBoundingClientRect().top ?? 0 };
    setReveals((n) => n + 1);
    setFlashedId(item.id);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashedId(null), FLASH_MS);
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
      if (item) reveal(item, link);
      else if (link) setChoice({ citation, link });
      else openOnDashboard(citation);
    },
  }), [items, reveal, openOnDashboard]);

  const closeChoice = useCallback(() => setChoice(null), []);

  return { citedNorms, columnRef, choice, closeChoice, openOnDashboard, flashedId };
}
