import { useState, useRef, useCallback, useEffect } from 'react';
import { ANNEX_AUTO_SWITCH_CONFIG } from '../config/annexConfig';
import type { SearchParams, TreeMetadata, AnnexMetadata } from '../types';

interface AutoSwitchState {
  /** Show confirmation dialog */
  showDialog: boolean;
  /** Article number being searched */
  articleNumber: string;
  /** Target annex label (e.g., "Allegato 2") */
  annexLabel: string;
  /** Target annex number (e.g., "2") */
  annexNumber: string | null;
  /** Original search params */
  originalParams: SearchParams | null;
}

interface UseAutoSwitchProps {
  /** Callback to trigger a new search */
  onSearch: (params: SearchParams) => void;
  /** Callback when search is loading (to track completion) */
  isLoading: boolean;
  /** Callback to remove duplicate tabs */
  onRemoveDuplicateTabs?: (params: SearchParams) => void;
}

interface UseAutoSwitchReturn {
  /** Register a new search to potentially trigger auto-switch */
  registerSearch: (params: SearchParams) => void;
  /** Reset auto-switch state (call when user manually selects annex) */
  reset: () => void;
  /** State for dialog display */
  dialogState: AutoSwitchState;
  /** Confirm the auto-switch */
  confirmSwitch: () => void;
  /** Cancel the auto-switch */
  cancelSwitch: () => void;
  /** Toast notification state */
  toast: { message: string; annexLabel: string } | null;
  /** Dismiss toast */
  dismissToast: () => void;
}

/**
 * Hook for automatic annex detection and switching.
 *
 * When a user searches for an article that exists in an annex (not main text),
 * this hook detects the situation and shows a confirmation dialog.
 *
 * Examples:
 * - "art 2043 codice civile" → Detects article is in Allegato 2, shows dialog
 * - "art 1 preleggi" → Detects article is in Allegato 1, shows dialog
 */
export function useAutoSwitch({
  onSearch,
  isLoading,
  onRemoveDuplicateTabs
}: UseAutoSwitchProps): UseAutoSwitchReturn {
  // Track current search params
  const currentSearchRef = useRef<SearchParams | null>(null);
  const hasCheckedRef = useRef(false);

  // Dialog state
  const [dialogState, setDialogState] = useState<AutoSwitchState>({
    showDialog: false,
    articleNumber: '',
    annexLabel: '',
    annexNumber: null,
    originalParams: null
  });

  // Toast state
  const [toast, setToast] = useState<{ message: string; annexLabel: string } | null>(null);

  // Register a new search
  const registerSearch = useCallback((params: SearchParams) => {
    currentSearchRef.current = params;
    // Only check for auto-switch if user didn't manually specify an annex
    hasCheckedRef.current = !!params.annex;
  }, []);

  // Reset state
  const reset = useCallback(() => {
    hasCheckedRef.current = true;
    setDialogState({
      showDialog: false,
      articleNumber: '',
      annexLabel: '',
      annexNumber: null,
      originalParams: null
    });
  }, []);

  // Confirm the switch
  const confirmSwitch = useCallback(() => {
    const { originalParams, annexNumber } = dialogState;
    if (!originalParams) return;

    // Close dialog
    setDialogState(prev => ({ ...prev, showDialog: false }));

    // Show toast
    setToast({
      message: `Reindirizzamento a ${dialogState.annexLabel}...`,
      annexLabel: dialogState.annexLabel
    });

    // Auto-dismiss toast
    setTimeout(() => setToast(null), ANNEX_AUTO_SWITCH_CONFIG.TOAST_DURATION);

    // Remove duplicate tabs from initial search
    if (onRemoveDuplicateTabs) {
      onRemoveDuplicateTabs(originalParams);
    }

    // Trigger new search with annex parameter
    const newParams: SearchParams = {
      ...originalParams,
      annex: annexNumber || undefined
    };

    // Small delay to ensure UI updates
    setTimeout(() => {
      onSearch(newParams);
    }, 100);
  }, [dialogState, onSearch, onRemoveDuplicateTabs]);

  // Cancel the switch
  const cancelSwitch = useCallback(() => {
    setDialogState(prev => ({ ...prev, showDialog: false }));
    hasCheckedRef.current = true; // Don't check again for this search
  }, []);

  // Dismiss toast
  const dismissToast = useCallback(() => {
    setToast(null);
  }, []);

  // Check for auto-switch after search completes
  useEffect(() => {
    if (!isLoading && currentSearchRef.current && !hasCheckedRef.current && ANNEX_AUTO_SWITCH_CONFIG.ENABLED) {
      const params = currentSearchRef.current;

      // Don't check if annex was manually specified
      if (params.annex) {
        return;
      }

      // Check for auto-switch
      const checkForAutoSwitch = async () => {
        try {
          // Build Normattiva URL from search params
          const buildNormURN = (p: SearchParams): string => {
            const actType = p.act_type.toLowerCase().replace(/\s+/g, '.');
            let nirUrn = `urn:nir:stato:${actType}`;
            if (p.date) nirUrn += `:${p.date}`;
            if (p.act_number) nirUrn += `;${p.act_number}`;
            return `https://www.normattiva.it/uri-res/N2Ls?${nirUrn}`;
          };

          const normUrl = buildNormURN(params);
          console.log('🔍 Auto-switch: Fetching tree for URL:', normUrl);

          const response = await fetch('/fetch_tree', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urn: normUrl, return_metadata: true })
          });

          if (!response.ok) {
            console.warn('Auto-switch: Failed to fetch tree');
            return;
          }

          const data = await response.json();
          const metadata: TreeMetadata | undefined = data.metadata;

          if (!metadata?.annexes || metadata.annexes.length < 2) {
            console.log('Auto-switch: No annexes detected');
            return;
          }

          // Find main text (annex with number === null)
          const mainText = metadata.annexes.find(a => a.number === null);

          if (!mainText) {
            console.log('Auto-switch: No main text found');
            return;
          }

          // Parse the requested article number(s)
          const requestedArticle = params.article || '';
          const requestedNumbers: string[] = [];

          // Handle ranges (e.g., "1-10")
          const rangeMatch = requestedArticle.match(/^(\d+)-(\d+)$/);
          if (rangeMatch) {
            const start = parseInt(rangeMatch[1]);
            const end = parseInt(rangeMatch[2]);
            for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
              requestedNumbers.push(String(i));
            }
          } else if (requestedArticle.includes(',')) {
            requestedNumbers.push(...requestedArticle.split(',').map(a => a.trim()));
          } else if (requestedArticle) {
            requestedNumbers.push(requestedArticle.trim());
          }

          // Check if ANY requested article exists in main text
          const mainTextArticles = new Set(mainText.article_numbers?.map(a => a.toLowerCase()) || []);
          const existsInMainText = requestedNumbers.some(num =>
            mainTextArticles.has(num.toLowerCase())
          );

          // If article exists in main text, check if we should still look for annexes
          if (existsInMainText) {
            // If Main text is large enough to be the primary body, respect it
            if (mainText.article_count > ANNEX_AUTO_SWITCH_CONFIG.MAX_MAIN_ARTICLES) {
              console.log('Auto-switch: Article exists in main text (large), not switching', {
                requestedArticles: requestedNumbers,
                mainTextArticles: mainText.article_count
              });
              hasCheckedRef.current = true;
              return;
            }
            console.log('Auto-switch: Article matches Main text, but Main is small (Preamble?). Checking annexes for better match...');
          }

          // Find the annex that CONTAINS the requested article
          let targetAnnex: AnnexMetadata | null = null;
          for (const annex of metadata.annexes) {
            if (annex.number === null) continue;
            if (annex.article_count < ANNEX_AUTO_SWITCH_CONFIG.MIN_ANNEX_ARTICLES) continue;

            const annexArticles = new Set(annex.article_numbers?.map(a => a.toLowerCase()) || []);
            const existsInThisAnnex = requestedNumbers.some(num =>
              annexArticles.has(num.toLowerCase())
            );

            if (existsInThisAnnex) {
              targetAnnex = annex;
              console.log('Auto-switch: Found article in annex', {
                annexNumber: annex.number,
                annexLabel: annex.label,
                requestedArticles: requestedNumbers
              });
              break;
            }
          }

          if (!targetAnnex) {
            console.log('Auto-switch: Requested article not found in any annex', {
              requestedArticles: requestedNumbers
            });
            hasCheckedRef.current = true;
            return;
          }

          // Check auto-switch conditions
          const shouldSwitch = mainText.article_count <= ANNEX_AUTO_SWITCH_CONFIG.MAX_MAIN_ARTICLES;

          if (shouldSwitch) {
            hasCheckedRef.current = true;

            // Auto-confirm if configured, otherwise show dialog
            if (ANNEX_AUTO_SWITCH_CONFIG.AUTO_CONFIRM) {
              console.log('✅ Auto-switch: Auto-confirming switch to annex', {
                requestedArticles: requestedNumbers,
                annexLabel: targetAnnex.label,
                annexNumber: targetAnnex.number
              });

              // Show toast
              setToast({
                message: `Articolo trovato in ${targetAnnex.label}`,
                annexLabel: targetAnnex.label
              });

              // Auto-dismiss toast
              setTimeout(() => setToast(null), ANNEX_AUTO_SWITCH_CONFIG.TOAST_DURATION);

              // Remove duplicate tabs from initial search
              if (onRemoveDuplicateTabs) {
                onRemoveDuplicateTabs(params);
              }

              // Trigger new search with annex parameter
              const newParams: SearchParams = {
                ...params,
                annex: targetAnnex.number || undefined
              };

              // Small delay to ensure UI updates
              setTimeout(() => {
                onSearch(newParams);
              }, 50);
            } else {
              console.log('✅ Auto-switch: Showing confirmation dialog', {
                requestedArticles: requestedNumbers,
                mainArticles: mainText.article_count,
                targetAnnexArticles: targetAnnex.article_count,
                annexLabel: targetAnnex.label,
                annexNumber: targetAnnex.number
              });

              // Show confirmation dialog
              setDialogState({
                showDialog: true,
                articleNumber: requestedNumbers[0],
                annexLabel: targetAnnex.label,
                annexNumber: targetAnnex.number,
                originalParams: params
              });
            }
          } else {
            console.log('Auto-switch: Main text has too many articles, not switching', {
              requestedArticles: requestedNumbers,
              mainArticles: mainText.article_count,
              threshold: ANNEX_AUTO_SWITCH_CONFIG.MAX_MAIN_ARTICLES,
              targetAnnex: targetAnnex.label
            });
            hasCheckedRef.current = true;
          }
        } catch (err) {
          console.error('Auto-switch: Error fetching tree', err);
          hasCheckedRef.current = true;
        }
      };

      checkForAutoSwitch();
    }
  }, [isLoading]);

  return {
    registerSearch,
    reset,
    dialogState,
    confirmSwitch,
    cancelSwitch,
    toast,
    dismissToast
  };
}
