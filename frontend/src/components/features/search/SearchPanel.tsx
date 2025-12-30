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
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../lib/utils';
import { useAutoSwitch } from '../../../hooks/useAutoSwitch';

// Helper to generate keys (replicates original JS logic)
const sanitize = (str: string) => str.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();
const generateNormaKey = (norma: Norma) => {
  if (!norma) return '';
  const parts = [norma.tipo_atto];
  if (norma.numero_atto?.trim()) parts.push(norma.numero_atto);
  if (norma.data?.trim()) parts.push(norma.data);
  return parts.map(part => sanitize(part || '')).join('--');
};

export function SearchPanel() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [loadingProgress, setLoadingProgress] = useState<{ loaded: number; total?: number } | null>(null);
  const {
    addWorkspaceTab, addNormaToTab, workspaceTabs, removeArticleFromNorma, removeTab,
    searchTrigger, clearSearchTrigger,
    quickNorms, selectQuickNorm, triggerSearch,
    commandPaletteOpen, openCommandPalette, closeCommandPalette,
    quickNormsManagerOpen, openQuickNormsManager, closeQuickNormsManager
  } = useAppStore();
  const [resultsBuffer, setResultsBuffer] = useState<Record<string, { norma: Norma, articles: ArticleData[], versionDate?: string }>>({});
  const [customTabLabel, setCustomTabLabel] = useState<string | null>(null);

  // Track active streaming tab to avoid creating duplicates
  const streamingTabRef = useRef<{ normaKey: string; tabId: string } | null>(null);

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

  const processResult = useCallback((result: ArticleData, versionDate?: string, isStreaming = false) => {
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

      if (isSameNorma && streamingTabRef.current) {
        // Add article to the tab we created for this streaming session
        addNormaToTab(streamingTabRef.current.tabId, norma, [result]);
      } else {
        // First article of a new norma - create new tab
        const versionSuffix = isHistorical && versionDate ? ` - Ver. ${versionDate}` : '';
        const label = customTabLabel || `${norma.tipo_atto}${norma.numero_atto ? ` ${norma.numero_atto}` : ''}${versionSuffix}`;
        const newTabId = addWorkspaceTab(label, norma, [result]);

        // Track this tab for subsequent articles
        streamingTabRef.current = { normaKey: key, tabId: newTabId };
        setCustomTabLabel(null); // Clear after first use
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
  }, [workspaceTabs, addNormaToTab, addWorkspaceTab, customTabLabel]);

  const handleSearch = useCallback(async (params: SearchParams) => {
    console.log('🔍 SearchPanel handleSearch called with:', params);
    setIsLoading(true);
    setError(null);
    setResultsBuffer({}); // Clear buffer before new search
    streamingTabRef.current = null; // Reset streaming tab tracker

    // Calculate expected number of articles for progress tracking
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

    const expectedTotal = calculateExpectedArticles(params.article || '');
    setLoadingProgress({ loaded: 0, total: expectedTotal });

    try {
      // Always use streaming endpoint (now supports Brocardi too!)
      const response = await fetch('/stream_article_text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
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
              processResult(result, params.version_date, true); // isStreaming = true
            } catch (e) {
              console.error("Error parsing line", line, e);
            }
          }
        }
      }

      // Process any remaining data in buffer
      if (buffer.trim()) {
        try {
          const result = JSON.parse(buffer);
          processResult(result, params.version_date, true); // isStreaming = true
        } catch (e) {
          console.error("Error parsing final buffer", e);
        }
      }

      // Save to search history (fire and forget - don't block on this)
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

      // Results buffer will be processed by useEffect below

    } catch (err: any) {
      setError(err.message || "Si è verificato un errore.");
    } finally {
      setIsLoading(false);
      setLoadingProgress(null); // Clear progress when done
    }
  }, [processResult]);

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

        if (isHistorical) {
          // Create new tab with version date in label
          const versionDate = group.versionDate ? ` - Ver. ${group.versionDate}` : ' - Storico';
          const label = useCustomLabel && index === 0
            ? customTabLabel
            : `${group.norma.tipo_atto}${group.norma.numero_atto ? ` ${group.norma.numero_atto}` : ''}${versionDate}`;
          console.log('➕ Creating historical tab with label:', label);
          addWorkspaceTab(label, group.norma, group.articles);
        } else {
          // Check if there's an existing tab with this norma (current version)
          // Skip this check if we have a custom label (always create new tab for dossiers)
          const existingTab = useCustomLabel ? null : workspaceTabs.find(tab =>
            tab.content.some(item =>
              item.type === 'norma' &&
              item.norma.tipo_atto === group.norma.tipo_atto &&
              item.norma.numero_atto === group.norma.numero_atto &&
              item.norma.data === group.norma.data &&
              !item.articles?.some(a => a.versionInfo?.isHistorical) // Make sure it's not a historical tab
            )
          );

          if (existingTab) {
            // Add articles to existing tab's norma
            addNormaToTab(existingTab.id, group.norma, group.articles);
          } else {
            // Create new tab - use custom label for first group only
            const label = useCustomLabel && index === 0
              ? customTabLabel
              : `${group.norma.tipo_atto}${group.norma.numero_atto ? ` ${group.norma.numero_atto}` : ''}`;
            addWorkspaceTab(label, group.norma, group.articles);
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
                          ? "w-6 bg-primary-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"
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
                    .map((normaBlock) => (
                      <NormaCard
                        key={normaBlock.id}
                        norma={normaBlock.norma}
                        articles={normaBlock.articles || []}
                        tabId={workspaceTabs[mobileActiveTabIndex].id}
                        onCloseArticle={(articleId) => {
                          removeArticleFromNorma(workspaceTabs[mobileActiveTabIndex].id, normaBlock.id, articleId);
                        }}
                        onPinArticle={() => { }}
                        onViewPdf={handleViewPdf}
                        onCrossReference={handleCrossReferenceNavigate}
                      />
                    ))}
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
            {[1, 2].map(i => (
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
            className="fixed top-24 left-1/2 z-[100] w-full max-w-md px-4"
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
            className="fixed top-24 left-1/2 z-[100] w-full max-w-md px-4"
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
            className="fixed top-24 left-1/2 z-[100] w-full max-w-md px-4"
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
