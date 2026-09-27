/**
 * Hook per gestire il preview delle citazioni normative.
 * Gestisce hover debounced, fetch articoli e caching.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ArticleData } from '../types';
import type { ParsedCitationData } from '../utils/citationMatcher';

interface CachedArticle {
  data: ArticleData;
  fetchedAt: number;
}

interface CitationPreviewState {
  isVisible: boolean;
  isLoading: boolean;
  error: string | null;
  citation: ParsedCitationData | null;
  article: ArticleData | null;
  position: { top: number; left: number };
  targetElement: HTMLElement | null;
}

interface UseCitationPreviewOptions {
  debounceMs?: number;
  cacheTtlMs?: number;
  maxCacheSize?: number;
}

// Cache globale per le citazioni (condivisa tra istanze)
const citationCache = new Map<string, CachedArticle>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minuti
const MAX_CACHE_SIZE = 50;

/**
 * Pulisce le voci di cache scadute
 */
function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of citationCache.entries()) {
    if (now - value.fetchedAt > CACHE_TTL_MS) {
      citationCache.delete(key);
    }
  }
}

/**
 * Aggiunge un articolo alla cache, rispettando il limite di dimensione
 */
function addToCache(key: string, data: ArticleData) {
  // Pulisci cache scaduta prima di aggiungere
  cleanupCache();

  // Se siamo al limite, rimuovi la voce più vecchia
  if (citationCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = citationCache.keys().next().value;
    if (oldestKey) citationCache.delete(oldestKey);
  }

  citationCache.set(key, { data, fetchedAt: Date.now() });
}

/**
 * Ottiene un articolo dalla cache se valido
 */
function getFromCache(key: string): ArticleData | null {
  const cached = citationCache.get(key);
  if (!cached) return null;

  // Verifica TTL
  if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) {
    citationCache.delete(key);
    return null;
  }

  return cached.data;
}

export function useCitationPreview(options: UseCitationPreviewOptions = {}) {
  const { debounceMs = 300 } = options;

  const [state, setState] = useState<CitationPreviewState>({
    isVisible: false,
    isLoading: false,
    error: null,
    citation: null,
    article: null,
    position: { top: 0, left: 0 },
    targetElement: null,
  });

  const hoverTimeoutRef = useRef<number | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const currentCacheKeyRef = useRef<string | null>(null);

  /**
   * Calcola la posizione del popup rispetto all'elemento target
   */
  const calculatePosition = useCallback((element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const popupWidth = 400;
    const popupHeight = 300;
    const padding = 12;

    let left = rect.left + rect.width / 2 - popupWidth / 2;
    let top = rect.bottom + padding;

    // Evita overflow a destra
    if (left + popupWidth > window.innerWidth - padding) {
      left = window.innerWidth - popupWidth - padding;
    }

    // Evita overflow a sinistra
    if (left < padding) {
      left = padding;
    }

    // Se non c'è spazio sotto, mostra sopra
    if (top + popupHeight > window.innerHeight - padding) {
      top = rect.top - popupHeight - padding;
    }

    return { top, left };
  }, []);

  /**
   * Fetch dell'articolo dalla API
   */
  const fetchArticle = useCallback(async (
    citation: ParsedCitationData,
    cacheKey: string
  ): Promise<ArticleData | null> => {
    // Controlla cache prima
    const cached = getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    // Abort fetch precedente
    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort();
    }

    fetchAbortRef.current = new AbortController();

    // Build request body - only include fields with actual values
    const requestBody: Record<string, string | boolean> = {
      act_type: citation.act_type,
      article: citation.article,
      version: 'vigente',
      show_brocardi_info: false, // Skip Brocardi per preview
    };

    // Only add optional fields if they have actual values
    if (citation.act_number) {
      requestBody.act_number = citation.act_number;
    }
    if (citation.date) {
      requestBody.date = citation.date;
    }

    try {
      const response = await fetch('/fetch_article_text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: fetchAbortRef.current.signal,
      });

      console.log('[CitationPreview] Response status:', response.status);

      if (!response.ok) {
        throw new Error('Errore nel caricamento');
      }

      const data = await response.json();

      // L'API restituisce un array, prendiamo il primo risultato
      if (Array.isArray(data) && data.length > 0) {
        const article = data[0];

        // Check if the response contains an error
        if (article.error) {
          throw new Error(article.error);
        }

        // Verify we have article text
        if (!article.article_text) {
          throw new Error('Articolo non trovato');
        }

        addToCache(cacheKey, article);
        return article;
      }

      throw new Error('Articolo non trovato');
    } catch (error) {
      // AbortError is expected when user moves mouse away - return special symbol
      if ((error as Error).name === 'AbortError') {
        return 'ABORTED' as unknown as ArticleData;
      }
      throw error;
    }
  }, []);

  /**
   * Mostra il preview per una citazione
   */
  const showPreview = useCallback((
    element: HTMLElement,
    citation: ParsedCitationData,
    cacheKey: string
  ) => {
    // Skip if already showing/loading this citation
    if (currentCacheKeyRef.current === cacheKey) {
      return;
    }

    // Set immediately to prevent duplicate calls
    currentCacheKeyRef.current = cacheKey;

    // Cancella timeout precedente
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    hoverTimeoutRef.current = window.setTimeout(async () => {

      // Calcola posizione
      const position = calculatePosition(element);

      // Controlla cache
      const cached = getFromCache(cacheKey);
      if (cached) {
        setState({
          isVisible: true,
          isLoading: false,
          error: null,
          citation,
          article: cached,
          position,
          targetElement: element,
        });
        return;
      }

      // Mostra loading
      setState({
        isVisible: true,
        isLoading: true,
        error: null,
        citation,
        article: null,
        position,
        targetElement: element,
      });

      try {
        const article = await fetchArticle(citation, cacheKey);

        // Verifica che sia ancora la stessa citazione
        if (currentCacheKeyRef.current !== cacheKey) return;

        // Check if fetch was aborted - do nothing
        if (article === 'ABORTED' as unknown as ArticleData) {
          return;
        }

        // Success - show article
        setState(prev => ({
          ...prev,
          isLoading: false,
          article,
        }));
      } catch (error) {
        // Verifica che sia ancora la stessa citazione
        if (currentCacheKeyRef.current !== cacheKey) return;

        setState(prev => ({
          ...prev,
          isLoading: false,
          error: (error as Error).message || 'Errore nel caricamento',
        }));
      }
    }, debounceMs);
  }, [calculatePosition, fetchArticle, debounceMs]);

  /**
   * Nasconde il preview
   */
  const hidePreview = useCallback(() => {
    // Cancella timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }

    // Abort fetch in corso
    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort();
      fetchAbortRef.current = null;
    }

    currentCacheKeyRef.current = null;

    setState({
      isVisible: false,
      isLoading: false,
      error: null,
      citation: null,
      article: null,
      position: { top: 0, left: 0 },
      targetElement: null,
    });
  }, []);

  /**
   * Aggiorna la posizione del popup (per scroll/resize)
   */
  const updatePosition = useCallback(() => {
    if (state.targetElement) {
      const position = calculatePosition(state.targetElement);
      setState(prev => ({ ...prev, position }));
    }
  }, [state.targetElement, calculatePosition]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      if (fetchAbortRef.current) {
        fetchAbortRef.current.abort();
      }
    };
  }, []);

  return {
    ...state,
    showPreview,
    hidePreview,
    updatePosition,
  };
}
