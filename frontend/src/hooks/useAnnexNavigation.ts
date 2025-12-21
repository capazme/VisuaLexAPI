import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { extractArticleIdsFromTree, normalizeArticleId } from '../utils/treeUtils';
import type { Norma, ArticleData, TreeMetadata } from '../types';

interface UseAnnexNavigationProps {
  /** The norma being displayed */
  norma: Norma;
  /** Currently loaded articles */
  articles: ArticleData[];
  /** Tab ID (only for workspace - enables direct article loading) */
  tabId?: string;
  /** Originally searched article (for preserving context on annex switch) */
  searchedArticle?: string;
  /** Currently active/selected article (for determining current annex context) */
  activeArticle?: ArticleData | null;
}

interface UseAnnexNavigationReturn {
  // Tree state
  treeData: any[] | null;
  treeMetadata: TreeMetadata | null;
  treeLoading: boolean;
  treeVisible: boolean;
  setTreeVisible: (visible: boolean) => void;

  // Annex state
  currentAnnex: string | null;
  allArticleIds: string[] | undefined;

  // Loading state
  loadingArticle: string | null;

  // Actions
  fetchTree: () => Promise<void>;
  handleAnnexSelect: (annexNumber: string | null) => Promise<string | null>;
  /** Load an article - targetAnnex allows specifying which annex to load from (null = dispositivo) */
  handleLoadArticle: (articleNumber: string, targetAnnex?: string | null) => void;

  // Helpers
  isArticleLoaded: (articleNumber: string) => boolean;
  loadedArticleIds: string[];
}

/**
 * Unified hook for annex navigation across NormaCard and NormaBlockComponent.
 * Handles tree fetching, annex selection, and article loading with consistent behavior.
 */
export function useAnnexNavigation({
  norma,
  articles,
  tabId,
  searchedArticle,
  activeArticle
}: UseAnnexNavigationProps): UseAnnexNavigationReturn {
  const { triggerSearch, addNormaToTab } = useAppStore();

  // Tree state
  const [treeData, setTreeData] = useState<any[] | null>(null);
  const [treeMetadata, setTreeMetadata] = useState<TreeMetadata | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeVisible, setTreeVisible] = useState(false);

  // Article loading state (for workspace direct loading)
  const [loadingArticle, setLoadingArticle] = useState<string | null>(null);

  // Derive current annex from active article (if provided) or first loaded article
  const currentAnnex = activeArticle?.norma_data?.allegato
    ?? articles[0]?.norma_data?.allegato
    ?? null;

  // Loaded article IDs (just the article numbers)
  // Loaded article IDs (unique identifiers)
  // We use unique IDs to distinguish between "Art 1" (Main) and "Art 1" (Annex 2)
  const loadedArticleIds = useMemo(
    () => articles.map(a =>
      a.norma_data.allegato
        ? `all${a.norma_data.allegato}:${a.norma_data.numero_articolo}`
        : a.norma_data.numero_articolo
    ),
    [articles]
  );

  // Normalized set for faster lookups (handles "3 bis" vs "3-bis")
  const loadedArticleIdsNormalized = useMemo(
    () => new Set(loadedArticleIds.map(normalizeArticleId)),
    [loadedArticleIds]
  );

  // Check if an article is already loaded
  const isArticleLoaded = useCallback(
    (articleNumber: string) => loadedArticleIdsNormalized.has(normalizeArticleId(articleNumber)),
    [loadedArticleIdsNormalized]
  );

  // Compute all article IDs from structure, filtered by current annex
  const allArticleIds = useMemo(() => {
    if (treeMetadata?.annexes) {
      // Find the annex info matching current context
      const annexInfo = currentAnnex
        ? treeMetadata.annexes.find(a => a.number === currentAnnex)
        : treeMetadata.annexes.find(a => a.number === null); // Main text

      if (annexInfo?.article_numbers) {
        return annexInfo.article_numbers;
      }
    }
    // Fallback to full tree extraction
    return treeData ? extractArticleIdsFromTree(treeData) : undefined;
  }, [treeMetadata, treeData, currentAnnex]);

  // Fetch tree structure with metadata
  const fetchTree = useCallback(async () => {
    if (!norma.urn || treeData) return; // Don't refetch if already loaded

    try {
      setTreeLoading(true);
      const res = await fetch('/fetch_tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urn: norma.urn,
          link: false,
          details: true,
          return_metadata: true
        })
      });

      if (!res.ok) throw new Error('Impossibile caricare la struttura');

      const payload = await res.json();
      setTreeData(payload.articles || payload);

      if (payload.metadata) {
        setTreeMetadata(payload.metadata);
      }
    } catch (e) {
      console.error('Error fetching tree:', e);
    } finally {
      setTreeLoading(false);
    }
  }, [norma.urn, treeData]);

  // Auto-fetch tree when norma has URN
  useEffect(() => {
    if (norma.urn && !treeData && !treeLoading) {
      fetchTree();
    }
  }, [norma.urn, treeData, treeLoading, fetchTree]);

  // Handle annex selection - load into same tab if tabId is present
  const handleAnnexSelect = useCallback(async (annexNumber: string | null): Promise<string | null> => {
    // Use searched article > current article > default "1"
    const articleToSearch = searchedArticle
      || articles[0]?.norma_data?.numero_articolo
      || '1';

    // Check if target article (with correct annex) is already loaded
    // This handles the case where we switch back to an already loaded annex
    const existingArticle = articles.find(a =>
      a.norma_data.numero_articolo === articleToSearch &&
      (a.norma_data.allegato === annexNumber || (a.norma_data.allegato === null && annexNumber === null))
    );

    if (existingArticle) {
      return articleToSearch;
    }

    // For API: annexNumber === null means explicit dispositivo, pass empty string
    // This prevents smart lookup from redirecting to an allegato
    const annexForApi = annexNumber === null ? '' : annexNumber;

    // If we have a tabId, load directly into the same tab (workspace behavior)
    // This is now preferred for ALL contexts including search results (NormaCard will pass tabId)
    if (tabId) {
      setLoadingArticle(annexNumber ? `annex-${annexNumber}` : 'main');

      try {
        const response = await fetch('/fetch_all_data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            act_type: norma.tipo_atto,
            act_number: norma.numero_atto || '',
            date: norma.data || '',
            article: articleToSearch,
            annex: annexForApi,
            version: 'vigente',
            version_date: '',
            show_brocardi_info: true
          })
        });

        if (!response.ok) throw new Error('Errore nel caricamento');

        const data = await response.json();
        const fetchedArticles = Array.isArray(data) ? data : [data];
        const validArticles = fetchedArticles.filter((a: any) => !a.error && a.norma_data);

        if (validArticles.length > 0) {
          // Add to the same tab - addNormaToTab will handle deduplication
          addNormaToTab(tabId, norma, validArticles);
          return articleToSearch;
        }
      } catch (e) {
        console.error('Error loading annex articles:', e);
      } finally {
        setLoadingArticle(null);
      }
    } else {
      // Fallback for cases without tabId (should be rare/legacy)
      triggerSearch({
        act_type: norma.tipo_atto,
        act_number: norma.numero_atto || '',
        date: norma.data || '',
        article: articleToSearch,
        version: 'vigente',
        version_date: '',
        show_brocardi_info: true,
        annex: annexForApi
      });
      return null;
    }
    return null;
  }, [norma, articles, searchedArticle, tabId, triggerSearch, addNormaToTab]);

  // Handle loading a new article
  // targetAnnex: if provided, use it (null = dispositivo); if undefined, use currentAnnex
  const handleLoadArticle = useCallback(async (articleNumber: string, targetAnnex?: string | null) => {
    // Determine which annex to use: explicit targetAnnex if provided, otherwise currentAnnex
    // Note: targetAnnex=null means dispositivo, targetAnnex=undefined means use currentAnnex
    const isExplicitAnnex = targetAnnex !== undefined;
    const annexToUse = isExplicitAnnex ? targetAnnex : currentAnnex;

    // For API: when annex is explicitly specified (including null for dispositivo),
    // pass empty string for dispositivo to bypass smart lookup.
    // When not explicit, pass current context or undefined.
    const annexForApi = isExplicitAnnex
      ? (targetAnnex === null ? '' : targetAnnex)  // Explicit: '' for dispositivo, value for allegato
      : (currentAnnex || undefined);                // Context-based: current value or undefined

    // Check if already loaded (with the correct annex context)
    // Build unique ID to check: for dispositivo it's just articleNumber, for annex it's all{annex}:{articleNumber}
    const uniqueIdToCheck = annexToUse
      ? `all${annexToUse}:${articleNumber}`
      : articleNumber;

    if (isArticleLoaded(uniqueIdToCheck)) {
      return; // Already loaded - caller should handle navigation
    }

    // If we have a tabId, load directly into the tab (workspace behavior)
    if (tabId) {
      if (loadingArticle) return; // Already loading something

      setLoadingArticle(articleNumber);

      try {
        const response = await fetch('/fetch_all_data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            act_type: norma.tipo_atto,
            act_number: norma.numero_atto || '',
            date: norma.data || '',
            article: articleNumber,
            annex: annexForApi,
            version: 'vigente',
            version_date: '',
            show_brocardi_info: true
          })
        });

        if (!response.ok) throw new Error('Errore nel caricamento');

        const data = await response.json();
        const fetchedArticles = Array.isArray(data) ? data : [data];
        const validArticles = fetchedArticles.filter((a: any) => !a.error && a.norma_data);

        if (validArticles.length > 0) {
          addNormaToTab(tabId, norma, validArticles);
        }
      } catch (e) {
        console.error('Error loading article:', e);
      } finally {
        setLoadingArticle(null);
      }
    } else {
      // No tabId - use global search (NormaCard behavior)
      triggerSearch({
        act_type: norma.tipo_atto,
        act_number: norma.numero_atto || '',
        date: norma.data || '',
        article: articleNumber,
        version: 'vigente',
        version_date: '',
        show_brocardi_info: true,
        annex: annexForApi
      });
    }
  }, [norma, currentAnnex, tabId, loadingArticle, isArticleLoaded, triggerSearch, addNormaToTab]);

  return {
    // Tree state
    treeData,
    treeMetadata,
    treeLoading,
    treeVisible,
    setTreeVisible,

    // Annex state
    currentAnnex,
    allArticleIds,

    // Loading state
    loadingArticle,

    // Actions
    fetchTree,
    handleAnnexSelect,
    handleLoadArticle,

    // Helpers
    isArticleLoaded,
    loadedArticleIds
  };
}
