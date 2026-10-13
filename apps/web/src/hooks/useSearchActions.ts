import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { appStore } from '../store/useAppStore';
import type { SearchParams } from '../types';
import type { DecisionReference } from '../types/decisions';
import { resolveAct } from '../utils/actUrn';
import { getErrorMessage } from '../utils/errors';

/** The searches a user typed (the palette, the search page's field, a quick norm picked there). */
const typedSearches = new WeakSet<SearchParams>();

/**
 * Whether a search trigger is one the user typed. A typed search is run as the palette always ran it,
 * straight into the active practice, and is not checked for an annex the way a programmatic trigger
 * (a dossier's «Apri», a quick norm on the empty page) is.
 */
export function isTypedSearch(params: SearchParams): boolean {
  return typedSearches.has(params);
}

export interface SearchActions {
  /** A norm search: it lands in the active practice. */
  search: (params: SearchParams) => void;
  /** An act's index without an article («Apri l'indice e sfoglia»). */
  browse: (params: SearchParams) => Promise<void>;
  /** A decision, read from a link: beside the table on the desktop, the full-screen reader on a phone. */
  openDecision: (reference: DecisionReference) => void;
  /** A topic searched in the Cassazione's decisions. */
  openTopic: (topic: string) => void;
  /** Shows the search page, where every one of these lands. */
  goToSearch: () => void;
}

/**
 * What the palette and the search field do with what they read. Everything lands in the practices,
 * which only the search page draws (gotcha 15, 27), so from any other page each action goes there.
 */
export function useSearchActions(): SearchActions {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const goToSearch = useCallback(() => {
    if (pathname !== '/') navigate('/');
  }, [navigate, pathname]);

  const search = useCallback((params: SearchParams) => {
    typedSearches.add(params);
    appStore.getState().triggerSearch(params);
    goToSearch();
  }, [goToSearch]);

  const browse = useCallback(async (params: SearchParams) => {
    goToSearch();
    try {
      // The resolved identity, not the requested one: asking for "codice
      // civile" comes back as regio decreto 262/1942, and an act built from
      // the request would never match that same act arriving from a later
      // search — the practice would grow a duplicate act for it.
      const { norma } = await resolveAct({
        act_type: params.act_type,
        act_number: params.act_number || undefined,
        date: params.date || undefined,
      });
      // The act lands on the active practice (created when there is none) and the structure window
      // points at it, in one step (spec §5.1).
      appStore.getState().addActIndexToPractice(null, norma);
    } catch (e) {
      // Loud on purpose: the user asked for a door and must be told when it
      // does not open (CLAUDE.md gotcha #18 — no silent fallbacks).
      console.error('browse: URN resolution failed:', e);
      appStore.getState().pushSyncError(getErrorMessage(e) || "Impossibile aprire l'indice di questo atto.");
    }
  }, [goToSearch]);

  const openDecision = useCallback((reference: DecisionReference) => {
    appStore.getState().openDecision(reference, { fromLink: true });
    goToSearch();
  }, [goToSearch]);

  const openTopic = useCallback((topic: string) => {
    appStore.getState().openTopicSearch({ tema: topic }, `Tema: ${topic}`);
    goToSearch();
  }, [goToSearch]);

  return useMemo(
    () => ({ search, browse, openDecision, openTopic, goToSearch }),
    [search, browse, openDecision, openTopic, goToSearch],
  );
}
