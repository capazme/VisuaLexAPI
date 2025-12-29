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
            while ((matchIndex = lowerText.indexOf(searchQuery, matchIndex)) !== -1) {
              matches.push({
                tabId: tab.id,
                tabLabel: tab.label,
                articleId: article.norma_data.numero_articolo,
                normaLabel,
                matchText: extractMatchContext(plainText, matchIndex, query.length),
                matchIndex,
                matchLength: query.length,
              });
              matchIndex += 1; // Move past this match
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
          while ((matchIndex = lowerText.indexOf(searchQuery, matchIndex)) !== -1) {
            matches.push({
              tabId: tab.id,
              tabLabel: tab.label,
              articleId: looseArticle.article.norma_data.numero_articolo,
              normaLabel,
              matchText: extractMatchContext(plainText, matchIndex, query.length),
              matchIndex,
              matchLength: query.length,
            });
            matchIndex += 1;
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
