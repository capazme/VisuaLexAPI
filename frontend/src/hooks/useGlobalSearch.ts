import { useState, useCallback, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { NormaBlock, LooseArticle } from '../store/workspaceTabActions';

export interface GlobalSearchMatch {
  tabId: string;
  tabLabel: string;
  articleId: string;
  normaLabel: string;
  matchText: string;
  matchIndex: number;
  matchLength: number;
  /**
   * Ordinal of this match inside its article body (0-based). Mirrors
   * the `data-search-idx` attribute emitted by useArticleMarkers so
   * the click-to-scroll handler can target this specific occurrence
   * rather than just the first one.
   */
  occurrenceIdx: number;
}

export interface GlobalSearchResult {
  query: string;
  matches: GlobalSearchMatch[];
  totalMatches: number;
}

function stripHtml(html: string): string {
  // Remove HTML tags but preserve text
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMatchContext(text: string, matchIndex: number, matchLength: number, contextSize = 50): string {
  const start = Math.max(0, matchIndex - contextSize);
  const end = Math.min(text.length, matchIndex + matchLength + contextSize);

  let context = text.slice(start, end);

  if (start > 0) context = '...' + context;
  if (end < text.length) context = context + '...';

  return context;
}

export function useGlobalSearch() {
  const workspaceTabs = useAppStore((state) => state.workspaceTabs);
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const searchResults = useMemo((): GlobalSearchResult => {
    if (!query || query.length < 2) {
      return { query, matches: [], totalMatches: 0 };
    }

    const matches: GlobalSearchMatch[] = [];
    const searchQuery = query.toLowerCase();

    workspaceTabs.forEach((tab) => {
      tab.content.forEach((content) => {
        if (content.type === 'norma') {
          const normaBlock = content as NormaBlock;
          const normaLabel = `${normaBlock.norma.tipo_atto || ''} ${normaBlock.norma.numero_atto || ''}`.trim();

          normaBlock.articles.forEach((article) => {
            const articleText = article.article_text || '';
            const plainText = stripHtml(articleText);
            const lowerText = plainText.toLowerCase();

            // Find all matches in the text
            let matchIndex = 0;
            let occurrenceIdx = 0;
            const uid = article.norma_data.allegato
              ? `all${article.norma_data.allegato}:${article.norma_data.numero_articolo}`
              : article.norma_data.numero_articolo;
            while ((matchIndex = lowerText.indexOf(searchQuery, matchIndex)) !== -1) {
              matches.push({
                tabId: tab.id,
                tabLabel: tab.label,
                articleId: uid,
                normaLabel,
                matchText: extractMatchContext(plainText, matchIndex, query.length),
                matchIndex,
                matchLength: query.length,
                occurrenceIdx,
              });
              matchIndex += 1; // Move past this match
              occurrenceIdx += 1;
            }
          });
        } else if (content.type === 'loose-article') {
          const looseArticle = content as LooseArticle;
          const normaLabel = `${looseArticle.sourceNorma?.tipo_atto || ''} ${looseArticle.sourceNorma?.numero_atto || ''}`.trim();
          const articleText = looseArticle.article.article_text || '';
          const plainText = stripHtml(articleText);
          const lowerText = plainText.toLowerCase();

          // Find all matches in the text
          let matchIndex = 0;
          let occurrenceIdx = 0;
          const uid = looseArticle.article.norma_data.allegato
            ? `all${looseArticle.article.norma_data.allegato}:${looseArticle.article.norma_data.numero_articolo}`
            : looseArticle.article.norma_data.numero_articolo;
          while ((matchIndex = lowerText.indexOf(searchQuery, matchIndex)) !== -1) {
            matches.push({
              tabId: tab.id,
              tabLabel: tab.label,
              articleId: uid,
              normaLabel,
              matchText: extractMatchContext(plainText, matchIndex, query.length),
              matchIndex,
              matchLength: query.length,
              occurrenceIdx,
            });
            matchIndex += 1;
            occurrenceIdx += 1;
          }
        }
      });
    });

    return {
      query,
      matches,
      totalMatches: matches.length,
    };
  }, [query, workspaceTabs]);

  // Group results by tab
  const groupedResults = useMemo(() => {
    const groups: Record<string, { tabLabel: string; matches: GlobalSearchMatch[] }> = {};

    searchResults.matches.forEach((match) => {
      if (!groups[match.tabId]) {
        groups[match.tabId] = {
          tabLabel: match.tabLabel,
          matches: [],
        };
      }
      groups[match.tabId].matches.push(match);
    });

    return Object.entries(groups).map(([tabId, data]) => ({
      tabId,
      tabLabel: data.tabLabel,
      matches: data.matches,
    }));
  }, [searchResults.matches]);

  const openSearch = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setIsOpen(false);
    setQuery('');
  }, []);

  const clearQuery = useCallback(() => {
    setQuery('');
  }, []);

  return {
    query,
    setQuery,
    isOpen,
    openSearch,
    closeSearch,
    clearQuery,
    searchResults,
    groupedResults,
    hasResults: searchResults.matches.length > 0,
  };
}

// Global state for highlighting matches
let highlightQuery: string | null = null;
let highlightListeners: Set<(query: string | null) => void> = new Set();

export function setGlobalHighlight(query: string | null) {
  highlightQuery = query;
  highlightListeners.forEach((listener) => listener(query));
}

export function getGlobalHighlight(): string | null {
  return highlightQuery;
}

export function subscribeToHighlight(listener: (query: string | null) => void): () => void {
  highlightListeners.add(listener);
  return () => highlightListeners.delete(listener);
}

// ── Cmd+F click → scroll-to-match coordination ───────────────────────
//
// When the user clicks a match in the GlobalSearch results, we fire a
// nav request with the target article + occurrence ordinal. Whichever
// ArticleTabContent renders that article picks it up, scrolls the
// matching `.search-match[data-search-idx=N]` into view, and flashes
// it. Stays a module-level observable (not store state) so we don't
// thrash the persisted store over a transient UI gesture.

export interface SearchMatchNavRequest {
  tabId: string;
  articleId: string;
  occurrenceIdx: number;
  /** Bumped on every request so identical consecutive targets still fire. */
  nonce: number;
}

let pendingNav: SearchMatchNavRequest | null = null;
const navListeners = new Set<(r: SearchMatchNavRequest | null) => void>();
let navNonce = 0;

export function requestSearchNavigation(target: Omit<SearchMatchNavRequest, 'nonce'>): void {
  pendingNav = { ...target, nonce: ++navNonce };
  navListeners.forEach((l) => l(pendingNav));
}

export function clearSearchNavigation(): void {
  pendingNav = null;
  navListeners.forEach((l) => l(null));
}

export function getSearchNavigation(): SearchMatchNavRequest | null {
  return pendingNav;
}

export function subscribeSearchNavigation(
  listener: (r: SearchMatchNavRequest | null) => void,
): () => void {
  navListeners.add(listener);
  return () => {
    navListeners.delete(listener);
  };
}
