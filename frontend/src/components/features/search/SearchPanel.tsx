import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PanInfo } from 'framer-motion';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { CommandPalette } from './CommandPalette';
import { QuickNormsManager } from './QuickNormsManager';
import { AliasManager } from '../settings/AliasManager';
import { PDFViewer } from '../../ui/PDFViewer';
import { WorkspaceNavigator } from '../workspace/WorkspaceNavigator';
import { NormaCard } from './NormaCard';
import { AnnexSwitchDialog } from '../../ui/AnnexSwitchDialog';
import type { SearchParams, ArticleData, Norma } from '../../../types';
import { SearchX, Search, X, Star, Plus, Sparkles, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { addToHistory } from '../../../services/historyService';
import { isAuthenticated } from '../../../services/authService';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../lib/utils';
import { useAutoSwitch } from '../../../hooks/useAutoSwitch';
import { Z_INDEX } from '../../../constants/zIndex';

// Helper to generate keys (replicates original JS logic)
const sanitize = (str: string) => str.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();
const generateNormaKey = (norma: Norma) => {
  if (!norma) return '';
  const parts = [norma.tipo_atto];
  if (norma.numero_atto?.trim()) parts.push(norma.numero_atto);
  if (norma.data?.trim()) parts.push(norma.data);
  return parts.map(part => sanitize(part || '')).join('--');
};

// Estimate the number of articles a search will return based on the `article`
// field. Used both for the streaming progress bar and the loading skeleton.
const calculateExpectedArticles = (article: string): number => {
  if (!article) return 0;

  // Handle ranges (e.g., "1-10")
  const rangeMatch = article.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1]);
    const end = parseInt(rangeMatch[2]);
    return Math.abs(end - start) + 1;
  }

  // Handle comma-separated (e.g., "1,2,3")
  if (article.includes(',')) {
    return article.split(',').filter(a => a.trim()).length;
  }

  // Single article
  return 1;
};

export function SearchPanel() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [loadingProgress, setLoadingProgress] = useState<{ loaded: number; total?: number } | null>(null);
  const {
    addWorkspaceTab, addNormaToTab, workspaceTabs, removeArticleFromNorma, removeTab,
    focusArticleInTab,
    searchTrigger, clearSearchTrigger,
    searchQueue, drainNextSearch,
    quickNorms, selectQuickNorm, triggerSearch,
    commandPaletteOpen, openCommandPalette, closeCommandPalette,
    quickNormsManagerOpen, openQuickNormsManager, closeQuickNormsManager
  } = useAppStore();
  const [resultsBuffer, setResultsBuffer] = useState<Record<string, { norma: Norma, articles: ArticleData[], versionDate?: string }>>({});
  const [customTabLabel, setCustomTabLabel] = useState<string | null>(null);
  // Remember the expected article count for the current search so the loading
  // skeleton can render a meaningful number of placeholder cards (M-4).
  const [expectedSkeletonCount, setExpectedSkeletonCount] = useState<number>(1);

  // Track active streaming tab to avoid creating duplicates
  const streamingTabRef = useRef<{ normaKey: string; tabId: string } | null>(null);

  // R2 (streaming-ux): how many articles the current search is expected to
  // produce. When it's exactly 1, processResult auto-focuses the single
  // result (even when merged into an existing tab via R3). Above 1 we
  // stay out of the way per R1.
  const expectedTotalRef = useRef<number>(0);

  // Abort in-flight streaming fetch when a new search starts or component unmounts
  const streamAbortRef = useRef<AbortController | null>(null);

  // Mobile: active tab index for swipe navigation
  const [mobileActiveTabIndex, setMobileActiveTabIndex] = useState(0);

  // Keep mobile tab index in bounds when tabs change
  useEffect(() => {
    if (mobileActiveTabIndex >= workspaceTabs.length && workspaceTabs.length > 0) {
      setMobileActiveTabIndex(workspaceTabs.length - 1);
    }
  }, [workspaceTabs.length, mobileActiveTabIndex]);

  // PDF State
  const [pdfState, setPdfState] = useState<{ isOpen: boolean; url: string | null; isLoading: boolean }>({
    isOpen: false,
    url: null,
    isLoading: false
  });

  // `tabLabel` is the per-search custom label (e.g. from a dossier). It must
  // be threaded through as a parameter rather than read from `customTabLabel`
  // state, otherwise a queued multi-search (see triggerMultiSearch) closes
  // over a stale label captured when the memoized callback was created — the
  // second search would end up landing in a default-label tab. See the drain
  // effect below for the flow.
  const processResult = useCallback((result: ArticleData, versionDate?: string, isStreaming = false, tabLabel?: string, targetTabId?: string) => {
    if (result.error) {
      console.error("Backend Error for item:", result.error);
      return;
    }

    const normaData = result.norma_data;

    if (!normaData) {
      console.error("Received result without norma_data", result);
      return;
    }

    // Mark as historical if version_date was provided
    if (versionDate) {
      console.log('📅 Processing with versionDate:', versionDate, 'norma data_versione:', normaData.data_versione);
      result.versionInfo = {
        isHistorical: true,
        requestedDate: versionDate,
        effectiveDate: normaData.data_versione || normaData.data
      };
    }

    const norma: Norma = {
      tipo_atto: normaData.tipo_atto,
      data: normaData.data,
      numero_atto: normaData.numero_atto,
      tipo_atto_reale: normaData.tipo_atto_reale,
      urn: normaData.url
    };

    const key = generateNormaKey(norma);
    if (!key) return;

    // If streaming, add directly to workspace instead of buffering
    if (isStreaming) {
      const isHistorical = result.versionInfo?.isHistorical;

      // Update loading progress
      setLoadingProgress(prev => prev ? { ...prev, loaded: prev.loaded + 1 } : { loaded: 1 });

      // Check if we're streaming to the same norma as before
      const isSameNorma = streamingTabRef.current && streamingTabRef.current.normaKey === key;

      // Direct-merge path: when the caller pre-created a tab (dossier "apri
      // tutto") and passed its id, we bypass all label-matching logic and
      // always merge into that tab. Also binds streamingTabRef so subsequent
      // articles from the same norma continue writing there.
      if (targetTabId && workspaceTabs.some((t) => t.id === targetTabId)) {
        addNormaToTab(targetTabId, norma, [result]);
        streamingTabRef.current = { normaKey: key, tabId: targetTabId };
      } else if (isSameNorma && streamingTabRef.current) {
        // Add article to the tab we created for this streaming session
        addNormaToTab(streamingTabRef.current.tabId, norma, [result]);
      } else {
        // First article of a new norma.
        //
        // Custom-label search (dossier "apri tutti"): first look for an
        // already-open custom tab with the SAME label and merge into it —
        // this is how a multi-norm dossier collapses into a single tab.
        // Fall back to creating a new custom tab.
        //
        // Non-custom search: R3 (streaming-ux) — merge into an existing
        // non-custom, non-historical tab that already holds the same norma,
        // otherwise create a new default-labeled tab.
        let mergeTarget: typeof workspaceTabs[number] | undefined;
        if (tabLabel && !isHistorical) {
          mergeTarget = workspaceTabs.find(tab =>
            tab.labelIsCustom &&
            tab.label === tabLabel &&
            !tab.content.some(item =>
              item.type === 'norma' && item.articles?.some(a => a.versionInfo?.isHistorical)
            )
          );
        } else if (!tabLabel && !isHistorical) {
          mergeTarget = workspaceTabs.find(tab =>
            !tab.labelIsCustom &&
            tab.content.some(item =>
              item.type === 'norma' &&
              item.norma.tipo_atto === norma.tipo_atto &&
              item.norma.numero_atto === norma.numero_atto &&
              item.norma.data === norma.data &&
              !item.articles?.some(a => a.versionInfo?.isHistorical)
            )
          );
        }

        if (mergeTarget) {
          addNormaToTab(mergeTarget.id, norma, [result]);
          streamingTabRef.current = { normaKey: key, tabId: mergeTarget.id };
        } else {
          const versionSuffix = isHistorical && versionDate ? ` - Ver. ${versionDate}` : '';
          const label = tabLabel || `${norma.tipo_atto}${norma.numero_atto ? ` ${norma.numero_atto}` : ''}${versionSuffix}`;
          const newTabId = addWorkspaceTab(label, norma, [result], { isCustom: !!tabLabel });
          streamingTabRef.current = { normaKey: key, tabId: newTabId };
        }

        // R2 (streaming-ux): single-article searches auto-focus the result
        // even when merged into a pre-existing tab (R3). For ranges we let
        // the user stay on whatever they're reading (R1).
        if (expectedTotalRef.current === 1 && streamingTabRef.current) {
          const numero = result.norma_data.numero_articolo;
          const allegato = result.norma_data.allegato;
          const articleUniqueId = allegato ? `all${allegato}:${numero}` : numero;
          focusArticleInTab(streamingTabRef.current.tabId, articleUniqueId);
        }
      }
    } else {
      // Buffer results for batch processing
      setResultsBuffer(prev => {
        const existing = prev[key];
        const newArticles = existing ? [...existing.articles] : [];

        const isNewArticle = !newArticles.find(a => a.norma_data.numero_articolo === result.norma_data.numero_articolo);

        if (isNewArticle) {
          newArticles.push(result);
          newArticles.sort((a, b) => {
            const numA = parseInt(a.norma_data.numero_articolo) || 0;
            const numB = parseInt(b.norma_data.numero_articolo) || 0;
            return numA - numB;
          });
        } else {
          const idx = newArticles.findIndex(a => a.norma_data.numero_articolo === result.norma_data.numero_articolo);
          newArticles[idx] = result;
        }

        return {
          ...prev,
          [key]: { norma, articles: newArticles, versionDate }
        };
      });
    }
  }, [workspaceTabs, addNormaToTab, addWorkspaceTab, focusArticleInTab]);

  const handleSearch = useCallback(async (params: SearchParams) => {
    console.log('🔍 SearchPanel handleSearch called with:', params);

    // Cancel any in-flight streaming fetch so its reader does not keep writing
    // into the workspace after this new search took over.
    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;

    setIsLoading(true);
    setError(null);
    setResultsBuffer({}); // Clear buffer before new search
    streamingTabRef.current = null; // Reset streaming tab tracker

    const expectedTotal = calculateExpectedArticles(params.article || '');
    expectedTotalRef.current = expectedTotal;
    setLoadingProgress({ loaded: 0, total: expectedTotal });
    // Skeleton count: at least 1, at most 10, mirrors the expected article
    // count (M-4). Avoids a fixed 2-card skeleton for ranges like "1-50".
    setExpectedSkeletonCount(Math.min(Math.max(expectedTotal || 1, 1), 10));

    // Count of NDJSON lines that failed to parse so we can surface a summary
    // error once the stream ends (M-2). Local to this search run so a later
    // search starts clean.
    let parseFailures = 0;

    try {
      // Always use streaming endpoint (now supports Brocardi too!)
      const response = await fetch('/stream_article_text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error('Errore nella richiesta');

      // Stream results - articles appear as they're fetched
      if (!response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              const result = JSON.parse(line);
              processResult(result, params.version_date, true, params.tabLabel, params.targetTabId);
            } catch (e) {
              parseFailures += 1;
              console.error("Error parsing line", line, e);
            }
          }
        }
      }

      // Process any remaining data in buffer
      if (buffer.trim()) {
        try {
          const result = JSON.parse(buffer);
          processResult(result, params.version_date, true, params.tabLabel, params.targetTabId);
        } catch (e) {
          parseFailures += 1;
          console.error("Error parsing final buffer", e);
        }
      }

      // If any NDJSON lines were malformed, let the user know something was
      // dropped instead of silently showing a partial result (M-2).
      if (parseFailures > 0) {
        setError(
          `Errore durante lo streaming: ${parseFailures} ${parseFailures === 1 ? 'articolo non è stato elaborato' : 'articoli non sono stati elaborati'}.`
        );
      }

      // Save to search history (fire and forget - don't block on this).
      // Skip when unauthenticated: history is per-user and would only
      // produce 401 noise in the console otherwise.
      if (isAuthenticated()) {
        addToHistory({
          act_type: params.act_type,
          act_number: params.act_number,
          article: params.article,
          date: params.date,
          version: params.version,
        }).catch(err => {
          // Silently fail - history is not critical
          console.debug('Failed to save search history:', err);
        });
      }

      // Results buffer will be processed by useEffect below

    } catch (err: any) {
      // A new search (or unmount) aborted this stream — not a user-facing error.
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      setError(err.message || "Si è verificato un errore.");
    } finally {
      // Only clear transient UI state if this controller is still the active one.
      // A newer search replaces streamAbortRef before reaching finally.
      if (streamAbortRef.current === controller) {
        setIsLoading(false);
        setLoadingProgress(null);
        streamAbortRef.current = null;
      }
    }
  }, [processResult]);

  // On unmount: abort any in-flight stream (C-2) and drop the buffered
  // results + streaming tab ref (M-1) so nothing leaks into a future
  // SearchPanel mount if the user navigates away mid-batch.
  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      streamingTabRef.current = null;
      setResultsBuffer({});
    };
  }, []);

  // Process results buffer and create workspace tabs
  useEffect(() => {
    if (Object.keys(resultsBuffer).length > 0 && !isLoading) {
      console.log('📦 Processing results buffer:', resultsBuffer);

      // Use custom label if provided (e.g., from dossier), otherwise generate default
      const useCustomLabel = customTabLabel && Object.keys(resultsBuffer).length > 0;

      Object.entries(resultsBuffer).forEach(([key, group], index) => {
        // For historical versions, always create a new tab
        const isHistorical = group.articles.some(a => a.versionInfo?.isHistorical);
        console.log('🏷️ Processing group:', key, 'isHistorical:', isHistorical, 'versionDate:', group.versionDate);

        const isCustomForThisGroup = !!useCustomLabel && index === 0;

        if (isHistorical) {
          // Create new tab with version date in label
          const versionDate = group.versionDate ? ` - Ver. ${group.versionDate}` : ' - Storico';
          const label = isCustomForThisGroup
            ? customTabLabel!
            : `${group.norma.tipo_atto}${group.norma.numero_atto ? ` ${group.norma.numero_atto}` : ''}${versionDate}`;
          console.log('➕ Creating historical tab with label:', label);
          addWorkspaceTab(label, group.norma, group.articles, { isCustom: isCustomForThisGroup });
        } else {
          // R3 (streaming-ux): merge into an existing tab that holds the
          // same norma, but only if that tab is not reserved (labelIsCustom)
          // and is not a historical view.
          //
          // Custom-label searches (dossier "apri tutti") previously always
          // forked a new tab, which prevented a multi-norm dossier from
          // landing in a single tab. Now: a custom-labeled search tries to
          // merge into an existing custom-labeled tab with the SAME LABEL —
          // so sequential dossier searches all collapse into the dossier's
          // one tab (see dossier `triggerMultiSearch` queue).
          const existingTab = isCustomForThisGroup
            ? workspaceTabs.find(tab =>
                tab.labelIsCustom &&
                tab.label === customTabLabel &&
                !tab.content.some(item =>
                  item.type === 'norma' && item.articles?.some(a => a.versionInfo?.isHistorical)
                )
              )
            : workspaceTabs.find(tab =>
                !tab.labelIsCustom &&
                tab.content.some(item =>
                  item.type === 'norma' &&
                  item.norma.tipo_atto === group.norma.tipo_atto &&
                  item.norma.numero_atto === group.norma.numero_atto &&
                  item.norma.data === group.norma.data &&
                  !item.articles?.some(a => a.versionInfo?.isHistorical)
                )
              );

          if (existingTab) {
            addNormaToTab(existingTab.id, group.norma, group.articles);
          } else {
            const label = isCustomForThisGroup
              ? customTabLabel!
              : `${group.norma.tipo_atto}${group.norma.numero_atto ? ` ${group.norma.numero_atto}` : ''}`;
            addWorkspaceTab(label, group.norma, group.articles, { isCustom: isCustomForThisGroup });
          }
        }
      });

      // Clear buffer and custom label after processing
      setResultsBuffer({});
      setCustomTabLabel(null);
    }
  }, [resultsBuffer, isLoading, addWorkspaceTab, addNormaToTab, workspaceTabs, customTabLabel]);

  useEffect(() => {
    const shareValue = searchParams.get('share');
    if (shareValue) {
      try {
        const decoded = JSON.parse(atob(shareValue));
        if (decoded) {
          handleSearch(decoded);
        }
      } catch (e) {
        console.error('Invalid share link', e);
      }
      const next = new URLSearchParams(searchParams);
      next.delete('share');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, handleSearch]);

  // Listen for programmatic search triggers
  useEffect(() => {
    if (searchTrigger) {
      // Capture custom tab label before search
      if (searchTrigger.tabLabel) {
        setCustomTabLabel(searchTrigger.tabLabel);
      }
      handleSearch(searchTrigger);
      clearSearchTrigger();
    }
  }, [searchTrigger, handleSearch, clearSearchTrigger]);

  // Drain the multi-search queue one item at a time. We only fire the next
  // item when: nothing is loading, no trigger is pending, and the results
  // buffer has been drained by the tab-processor effect above. That way each
  // queued search runs end-to-end before the next starts — critical because
  // they share the same custom label and merge into the SAME tab via
  // `addNormaToTab`, which requires the tab to already exist when the 2nd
  // through Nth searches resolve.
  useEffect(() => {
    if (searchQueue.length === 0) return;
    if (isLoading) return;
    if (searchTrigger) return;
    if (Object.keys(resultsBuffer).length > 0) return;
    // Atomic inside the store: if another drain invocation (StrictMode) already
    // parked a searchTrigger, this one no-ops and we don't dequeue twice.
    drainNextSearch();
  }, [isLoading, searchTrigger, resultsBuffer, searchQueue, drainNextSearch]);

  // Auto-switch hook for annex detection
  const {
    registerSearch,
    dialogState: autoSwitchDialog,
    confirmSwitch,
    cancelSwitch,
    toast: annexToast,
    dismissToast: dismissAnnexToast
  } = useAutoSwitch({
    onSearch: handleSearch,
    isLoading,
    onRemoveDuplicateTabs: (params) => {
      // Remove any existing tabs with the same norma (from the initial search without annex)
      const duplicateTabs = workspaceTabs.filter(tab =>
        tab.content.some(item =>
          item.type === 'norma' &&
          item.norma.tipo_atto.toLowerCase() === params.act_type.toLowerCase() &&
          item.norma.numero_atto === params.act_number &&
          item.norma.data === params.date
        )
      );

      duplicateTabs.forEach(tab => {
        console.log('🗑️ Auto-switch: Removing duplicate tab', tab.id, tab.label);
        removeTab(tab.id);
      });
    }
  });

  // Register search for auto-switch detection when search trigger is used
  useEffect(() => {
    if (searchTrigger && !searchTrigger.annex) {
      registerSearch(searchTrigger);
    }
  }, [searchTrigger, registerSearch]);

  const handleCrossReferenceNavigate = useCallback((articleNumber: string, normaData: ArticleData['norma_data']) => {
    const params: SearchParams = {
      act_type: normaData.tipo_atto,
      act_number: normaData.numero_atto || '',
      date: normaData.data || '',
      article: articleNumber,
      version: (normaData.versione as 'vigente' | 'originale') || 'vigente',
      version_date: normaData.data_versione || '',
      show_brocardi_info: true,
      annex: normaData.allegato || undefined  // Preserve annex when navigating via cross-reference
    };
    handleSearch(params);
  }, [handleSearch]);


  const handleViewPdf = async (urn: string) => {
    setPdfState({ isOpen: true, url: null, isLoading: true });
    try {
      const response = await fetch('/export_pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urn })
      });

      if (!response.ok) throw new Error('Errore generazione PDF');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      setPdfState({ isOpen: true, url, isLoading: false });
    } catch (e) {
      console.error(e);
      setPdfState({ isOpen: false, url: null, isLoading: false });
      setError("Impossibile caricare il PDF.");
    }
  };

  const hasTabs = workspaceTabs.length > 0;

  return (
    <>
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={closeCommandPalette}
        onSearch={handleSearch}
      />

      {/* Workspace Manager - renders all tabs */}
      {/* Desktop: Workspace floating panels - hidden on mobile */}
      <div id="tour-results-area" className="hidden md:block">
        <WorkspaceManager
          onViewPdf={handleViewPdf}
          onCrossReference={handleCrossReferenceNavigate}
        />
      </div>

      {/* Desktop: Workspace Navigator dock - hidden on mobile */}
      <div className="hidden md:block">
        <WorkspaceNavigator />
      </div>

      {/* Mobile: Swipeable tabs navigation */}
      {hasTabs && (
        <div className="md:hidden w-full h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
          {/* Tab header with navigation - Glass aesthetic */}
          <div className="flex-shrink-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800 px-4 py-4">
            <div className="flex items-center justify-between">
              {/* Prev button */}
              <button
                onClick={() => setMobileActiveTabIndex(Math.max(0, mobileActiveTabIndex - 1))}
                disabled={mobileActiveTabIndex === 0}
                className={cn(
                  "p-2.5 rounded-xl transition-all shadow-sm active:scale-95",
                  mobileActiveTabIndex === 0
                    ? "text-slate-300 dark:text-slate-700 bg-slate-50 dark:bg-slate-900"
                    : "text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
                )}
              >
                <ChevronLeft size={20} />
              </button>

              {/* Tab label and indicator */}
              <div className="flex-1 text-center min-w-0 px-4">
                <p className="font-bold text-slate-900 dark:text-white text-base truncate">
                  {workspaceTabs[mobileActiveTabIndex]?.label || 'Risultati'}
                </p>
                {/* Dots indicator */}
                <div className="flex justify-center gap-1.5 mt-2.5">
                  {workspaceTabs.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setMobileActiveTabIndex(idx)}
                      className={cn(
                        "h-1.5 rounded-full transition-all duration-300",
                        idx === mobileActiveTabIndex
                          ? "w-6 bg-primary-500 shadow-glow-sm"
                          : "w-1.5 bg-slate-300 dark:bg-slate-700"
                      )}
                    />
                  ))}
                </div>
              </div>

              {/* Next button */}
              <button
                onClick={() => setMobileActiveTabIndex(Math.min(workspaceTabs.length - 1, mobileActiveTabIndex + 1))}
                disabled={mobileActiveTabIndex === workspaceTabs.length - 1}
                className={cn(
                  "p-2.5 rounded-xl transition-all shadow-sm active:scale-95",
                  mobileActiveTabIndex === workspaceTabs.length - 1
                    ? "text-slate-300 dark:text-slate-700 bg-slate-50 dark:bg-slate-900"
                    : "text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
                )}
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>

          {/* Swipeable content area */}
          <div className="flex-1 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              {workspaceTabs[mobileActiveTabIndex] && (
                <motion.div
                  key={workspaceTabs[mobileActiveTabIndex].id}
                  initial={{ opacity: 0, x: 50 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -50 }}
                  transition={{ duration: 0.3, ease: "circOut" }}
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.2}
                  onDragEnd={(_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
                    const threshold = 50;
                    if (info.offset.x > threshold && mobileActiveTabIndex > 0) {
                      setMobileActiveTabIndex(mobileActiveTabIndex - 1);
                    } else if (info.offset.x < -threshold && mobileActiveTabIndex < workspaceTabs.length - 1) {
                      setMobileActiveTabIndex(mobileActiveTabIndex + 1);
                    }
                  }}
                  className="h-full overflow-y-auto p-4 space-y-4 custom-scrollbar"
                >
                  {workspaceTabs[mobileActiveTabIndex].content
                    .filter((item): item is typeof item & { type: 'norma' } => item.type === 'norma')
                    .map((normaBlock) => {
                      const tabIsStreaming =
                        isLoading &&
                        streamingTabRef.current?.tabId === workspaceTabs[mobileActiveTabIndex].id;
                      return (
                        <NormaCard
                          key={normaBlock.id}
                          norma={normaBlock.norma}
                          articles={normaBlock.articles || []}
                          tabId={workspaceTabs[mobileActiveTabIndex].id}
                          onCloseArticle={(articleId) => {
                            removeArticleFromNorma(workspaceTabs[mobileActiveTabIndex].id, normaBlock.id, articleId);
                          }}
                          onViewPdf={handleViewPdf}
                          onCrossReference={handleCrossReferenceNavigate}
                          isStreaming={tabIsStreaming}
                          streamProgress={tabIsStreaming ? loadingProgress : null}
                        />
                      );
                    })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* QuickNorms Manager Modal */}
      <QuickNormsManager
        isOpen={quickNormsManagerOpen}
        onClose={closeQuickNormsManager}
        onSearch={handleSearch}
      />

      {/* Alias Manager Modal */}
      <AliasManager />

      {/* Main Content Area - Empty state when no tabs */}
      {!hasTabs && !isLoading && (
        <div id="tour-main-content" className="w-full h-full flex flex-col items-center justify-center p-8 animate-in fade-in duration-700 bg-slate-50 dark:bg-slate-950">
          {/* Interactive Search Icon */}
          <div
            className="relative group cursor-pointer active:scale-95 transition-transform"
            onClick={openCommandPalette}
            title="Apri ricerca (Cmd+K)"
          >
            {/* Blur Background */}
            <div className="absolute inset-0 bg-primary-500/20 rounded-[2.5rem] blur-2xl group-hover:bg-primary-500/30 transition-all duration-700 animate-pulse" />

            {/* Icon Container - Glass Card */}
            <div className="relative w-32 h-32 sm:w-40 sm:h-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-[2.5rem] shadow-glass-lg flex items-center justify-center border border-white dark:border-slate-800 transition-all duration-500 group-hover:shadow-primary-500/10 group-hover:-translate-y-2">
              <Search size={64} className="text-primary-500 stroke-[1.2] w-14 h-14 sm:w-16 sm:h-16 group-hover:scale-110 transition-transform duration-500" />

              {/* Keyboard Shortcut Badge */}
              <div className="absolute -bottom-2 -right-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[10px] font-black px-3 py-1.5 rounded-full shadow-lg border-4 border-slate-50 dark:border-slate-950 uppercase tracking-widest">
                ⌘ K
              </div>
            </div>
          </div>

          {/* Title and Description */}
          <div className="text-center mt-12 mb-10 max-w-md">
            <h3 className="text-3xl font-black text-slate-900 dark:text-white mb-4 tracking-tight">
              Ricerca Intelligente
            </h3>
            <p className="text-slate-500 dark:text-slate-400 text-lg leading-relaxed font-medium">
              Esplora l'intero ecosistema normativo con query naturali. Prova <span className="text-primary-600 dark:text-primary-400 font-bold">"Art 2043 cc"</span>
            </p>
          </div>

          {/* QuickNorms Section */}
          <div id="tour-quick-norms" className="w-full max-w-2xl px-4">
            <div className="flex items-center justify-between mb-6 px-2">
              <div className="flex items-center gap-2.5 text-xs font-bold text-slate-400 uppercase tracking-widest">
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
                  <Star size={14} fill="currentColor" />
                </div>
                <span>Ricerche Frequenti</span>
              </div>
              <button
                onClick={openQuickNormsManager}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider",
                  "bg-slate-200/50 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700",
                  "text-slate-600 dark:text-slate-300 transition-all shadow-sm active:scale-95 border border-slate-300 dark:border-slate-700"
                )}
              >
                <Plus size={14} />
                Gestisci
              </button>
            </div>

            {quickNorms.length === 0 ? (
              <div
                onClick={openQuickNormsManager}
                className={cn(
                  "group flex flex-col items-center justify-center py-12 px-8 rounded-3xl cursor-pointer",
                  "border-2 border-dashed border-slate-200 dark:border-slate-800",
                  "hover:border-primary-400/50 dark:hover:border-primary-500/50 hover:bg-primary-50/30 dark:hover:bg-primary-900/10",
                  "transition-all duration-300"
                )}
              >
                <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-900 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Sparkles size={28} className="text-slate-400 dark:text-slate-500 group-hover:text-primary-500 transition-colors" />
                </div>
                <p className="text-base text-slate-500 dark:text-slate-400 text-center font-bold">
                  Velocizza il tuo workflow<br />
                  <span className="text-xs font-medium text-slate-400 mt-1 block">Aggiungi norme consultate frequentemente</span>
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {quickNorms.slice(0, 6).map((qn) => (
                  <button
                    key={qn.id}
                    onClick={() => {
                      selectQuickNorm(qn.id);
                      triggerSearch(qn.searchParams);
                    }}
                    className={cn(
                      "group flex flex-col gap-2 p-4 rounded-2xl text-left",
                      "bg-white dark:bg-slate-900",
                      "border border-slate-200 dark:border-slate-800",
                      "hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-xl hover:shadow-primary-500/5 hover:-translate-y-1",
                      "transition-all duration-300"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-500">
                        <Star size={12} fill="currentColor" />
                      </div>
                      <ChevronRight size={14} className="text-slate-300 group-hover:text-primary-500 transition-colors" />
                    </div>
                    <div>
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-100 line-clamp-1">{qn.label}</span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight mt-0.5">{qn.searchParams.act_type}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Loading Skeleton - Shows while search is in progress */}
      {isLoading && !hasTabs && (
        <div className="w-full max-w-4xl mx-auto p-12 space-y-8 animate-pulse">
          <div className="space-y-4">
            <div className="h-10 bg-slate-200 dark:bg-slate-800 rounded-2xl w-1/3" />
            <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-lg w-1/2" />
          </div>

          <div className="grid grid-cols-1 gap-6">
            {Array.from({ length: expectedSkeletonCount }, (_, i) => i + 1).map(i => (
              <div key={i} className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                <div className="p-8 space-y-6">
                  <div className="flex gap-4 items-center">
                    <div className="w-12 h-12 bg-slate-200 dark:bg-slate-800 rounded-2xl" />
                    <div className="space-y-2 flex-1">
                      <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-md w-1/4" />
                      <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded-md w-1/6" />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="h-3 bg-slate-100 dark:bg-slate-800/50 rounded-md w-full" />
                    <div className="h-3 bg-slate-100 dark:bg-slate-800/50 rounded-md w-full" />
                    <div className="h-3 bg-slate-100 dark:bg-slate-800/50 rounded-md w-2/3" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading progress indicator */}
      <AnimatePresence>
        {loadingProgress && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className={cn('fixed top-24 left-1/2 w-full max-w-md px-4', Z_INDEX.searchPanel)}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className="bg-white dark:bg-slate-900 border border-primary-200 dark:border-primary-900/30 p-4 rounded-2xl shadow-lg shadow-primary-500/10 flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center text-primary-500">
                <div className="w-5 h-5 rounded-full border-2 border-current border-t-transparent animate-spin" />
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
                  Caricamento articoli...
                </h4>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed">
                  {loadingProgress.total
                    ? `${loadingProgress.loaded} di ${loadingProgress.total} articoli caricati`
                    : `${loadingProgress.loaded} articoli caricati`}
                </p>
                {/* Progress bar */}
                {loadingProgress.total && (
                  <div className="mt-2 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-primary-500 to-primary-600"
                      initial={{ width: 0 }}
                      animate={{ width: `${(loadingProgress.loaded / loadingProgress.total) * 100}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error display */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className={cn('fixed top-24 left-1/2 w-full max-w-md px-4', Z_INDEX.searchPanel)}
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            <div className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/30 p-4 rounded-2xl shadow-lg shadow-red-500/10 flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center text-red-500">
                <SearchX size={20} />
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Errore di Ricerca</h4>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Annex Auto-Switch Toast Notification */}
      <AnimatePresence>
        {annexToast && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className={cn('fixed top-24 left-1/2 w-full max-w-md px-4', Z_INDEX.searchPanel)}
          >
            <div className="bg-white dark:bg-slate-900 border border-primary-200 dark:border-primary-900/30 p-4 rounded-2xl shadow-lg shadow-primary-500/10 flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center text-primary-500">
                <Info size={20} />
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Navigazione allegato</h4>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed">{annexToast.message}</p>
              </div>
              <button
                onClick={dismissAnnexToast}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Annex Switch Confirmation Dialog */}
      <AnnexSwitchDialog
        isOpen={autoSwitchDialog.showDialog}
        onConfirm={confirmSwitch}
        onCancel={cancelSwitch}
        articleNumber={autoSwitchDialog.articleNumber}
        annexLabel={autoSwitchDialog.annexLabel}
        annexNumber={autoSwitchDialog.annexNumber}
      />

      {/* PDF Viewer Modal */}
      <PDFViewer
        isOpen={pdfState.isOpen}
        onClose={() => setPdfState(s => ({ ...s, isOpen: false }))}
        pdfUrl={pdfState.url}
        isLoading={pdfState.isLoading}
      />
    </>
  );
}
