import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Book, ChevronDown, X, GitBranch, Plus, ArrowRight, ExternalLink, Loader2 } from 'lucide-react';
import type { Norma, ArticleData } from '../../../types';
import { cn } from '../../../lib/utils';
import { formatDateItalianLong, abbreviateActType } from '../../../utils/dateUtils';
import { ArticleTabContent } from './ArticleTabContent';
import { TreeViewPanel } from './TreeViewPanel';
import { AnnexSuggestion } from './AnnexSuggestion';
import { ArticleNavigation } from '../workspace/ArticleNavigation';
import { ArticleMinimap } from '../workspace/ArticleMinimap';
import { StudyMode } from '../workspace/StudyMode';
import { useAppStore } from '../../../store/useAppStore';
import { useAnnexNavigation } from '../../../hooks/useAnnexNavigation';

interface NormaCardProps {
  norma: Norma;
  articles: ArticleData[];
  onCloseArticle: (articleId: string) => void;
  onPinArticle: (articleId: string) => void; // Placeholder for future use
  onViewPdf: (urn: string) => void;
  onCompareArticle?: (article: ArticleData) => void;
  onCrossReference?: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
  onPopOut?: (articleId: string) => void;
  isNew?: boolean;
  searchedArticle?: string; // Original article number requested by user
  tabId?: string; // ID of the workspace tab containing this card
}

// Helper to generate unique article ID
const getUniqueId = (article: ArticleData) => {
  return article.norma_data.allegato
    ? `all${article.norma_data.allegato}:${article.norma_data.numero_articolo}`
    : article.norma_data.numero_articolo;
};

export function NormaCard({ norma, articles, onCloseArticle, onViewPdf, onCompareArticle: _onCompareArticle, onCrossReference, isNew, searchedArticle, tabId }: NormaCardProps) {
  // Local UI state - defined first so we can derive activeArticle
  const [isOpen, setIsOpen] = useState(true);
  // Initialize with unique ID of the first article
  const [activeTabId, setActiveTabId] = useState<string | null>(
    articles[0] ? getUniqueId(articles[0]) : null
  );

  // Derive active article from activeTabId
  const activeArticle = articles.find(a => getUniqueId(a) === activeTabId) || null;

  // Use the shared annex navigation hook - pass activeArticle for correct annex detection
  const {
    treeData,
    treeMetadata,
    treeLoading: _treeLoading,
    treeVisible,
    setTreeVisible,
    currentAnnex,
    allArticleIds,
    loadingArticle,
    fetchTree,
    handleAnnexSelect,
    handleLoadArticle,
    loadedArticleIds
  } = useAnnexNavigation({
    norma,
    articles,
    searchedArticle,
    tabId,
    activeArticle
  });
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddValue, setQuickAddValue] = useState('');

  // Mobile: track which articles are expanded (using unique IDs)
  const [expandedArticles, setExpandedArticles] = useState<Set<string>>(() => {
    const first = articles[0];
    return first ? new Set([getUniqueId(first)]) : new Set();
  });

  // Study Mode state
  const [studyModeOpen, setStudyModeOpen] = useState(false);
  const [studyModeArticle, setStudyModeArticle] = useState<ArticleData | null>(null);
  const { triggerSearch } = useAppStore();

  const toggleArticleExpanded = (uniqueId: string) => {
    setExpandedArticles(prev => {
      const next = new Set(prev);
      if (next.has(uniqueId)) {
        next.delete(uniqueId);
      } else {
        next.add(uniqueId);
      }
      return next;
    });
  };

  const openStudyMode = (article: ArticleData) => {
    setStudyModeArticle(article);
    setStudyModeOpen(true);
  };

  const handleQuickAddArticle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddValue.trim()) return;

    // Trigger search for the new article, preserving current annex
    triggerSearch({
      act_type: norma.tipo_atto,
      act_number: norma.numero_atto || '',
      date: norma.data || '',
      article: quickAddValue.trim(),
      version: 'vigente',
      version_date: '',
      show_brocardi_info: true,
      annex: currentAnnex || undefined
    });

    setQuickAddValue('');
    setQuickAddOpen(false);
  };

  // Set first tab active when articles change if no tab is active
  useEffect(() => {
    if (articles.length > 0) {
      const firstUniqueId = getUniqueId(articles[0]);

      if (!activeTabId) {
        setActiveTabId(firstUniqueId);
      } else {
        // Check if current active tab still exists
        const exists = articles.some(a => getUniqueId(a) === activeTabId);
        if (!exists) {
          setActiveTabId(firstUniqueId);
        }
      }
    }
  }, [articles, activeTabId]);

  const contentRef = useRef<HTMLDivElement>(null);

  // Function to navigate to a loaded article or load it if not present
  const handleArticleSelect = (articleNumber: string) => {
    // Construct unique ID based on current context (annex)
    // Note: This assumes selection comes from the current tree context (TreeViewPanel)
    const targetUniqueId = currentAnnex
      ? `all${currentAnnex}:${articleNumber}`
      : articleNumber;

    // Check if loaded (using unique ID check)
    const isLoaded = articles.some(a => getUniqueId(a) === targetUniqueId);

    if (isLoaded) {
      setActiveTabId(targetUniqueId);
    } else {
      handleLoadArticle(articleNumber);
      // We rely on useEffect to switch tab once loaded, 
      // or we could optimistically set it but it wouldn't match any article yet.
      // Better to let useEffect handle the switch IF we want auto-switch on load (which we do logic for).
      // But handleLoadArticle is async in hook.
      // If we want immediate feedback, we might need to track "pending" state.
      // For now, rely on previous logic + effect.
      // Wait, effect logic selects FIRST article if active is missing.
      // If we load a specific one, we want THAT one active.
      // NormaBlockComponent handles this. NormaCard relies on user action?
    }
  };

  if (articles.length === 0) return null;

  return (
    <div className={cn(
      "rounded-xl overflow-hidden mb-6",
      "bg-white dark:bg-slate-900",
      "border shadow-lg",
      "transition-all duration-300",
      "hover:shadow-xl",
      isNew
        ? "border-primary-500 ring-4 ring-primary-500/10"
        : "border-slate-200 dark:border-slate-800"
    )}>
      {/* Mobile Header */}
      <div
        className={cn(
          "md:hidden",
          "p-4 cursor-pointer",
          "border-b border-slate-200 dark:border-slate-800",
          "bg-slate-50 dark:bg-slate-900/50",
          "hover:bg-slate-100 dark:hover:bg-slate-800",
          "transition-colors duration-200"
        )}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 flex-shrink-0 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 dark:text-primary-400">
            <Book size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-bold text-slate-900 dark:text-white text-base leading-tight">
                {norma.tipo_atto}
                {/* Show number only if NOT an alias */}
                {!norma.tipo_atto_reale && norma.numero_atto && ` ${norma.numero_atto}`}
              </h3>
              {isNew && (
                <span className="flex-shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase bg-primary-600 text-white rounded-full shadow-sm">
                  Nuovo
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 font-medium">
              {norma.tipo_atto_reale ? (
                // For aliases: show real type + date + number
                <>
                  {abbreviateActType(norma.tipo_atto_reale)}
                  {norma.data && ` ${formatDateItalianLong(norma.data)}`}
                  {norma.numero_atto && `, n. ${norma.numero_atto}`}
                </>
              ) : (
                norma.data ? `Data: ${formatDateItalianLong(norma.data)}` : 'Estremi non disponibili'
              )}
            </p>
            <span className="inline-block text-[10px] bg-slate-200/50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
              {articles.length} {articles.length === 1 ? 'articolo' : 'articoli'} caricati
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {norma.urn && (
            <button
              className="flex-1 h-9 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 dark:text-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:bg-slate-700 rounded-lg transition-all shadow-sm flex items-center justify-center gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                onViewPdf(norma.urn!);
              }}
            >
              <ExternalLink size={14} className="text-primary-500" />
              PDF
            </button>
          )}
          {norma.urn && (
            <button
              className="flex-1 h-9 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 dark:text-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:bg-slate-700 rounded-lg transition-all shadow-sm flex items-center justify-center gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                setTreeVisible(!treeVisible);
                if (!treeData) fetchTree();
              }}
            >
              <GitBranch size={14} className="text-emerald-500" />
              Struttura
            </button>
          )}
          <button
            className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            onClick={() => setIsOpen(!isOpen)}
          >
            <ChevronDown className={cn("transition-transform duration-300", isOpen ? "rotate-180" : "")} size={20} />
          </button>
        </div>
      </div>

      {/* Desktop Header */}
      <div
        className={cn(
          "hidden md:flex",
          "p-5 items-center justify-between cursor-pointer",
          "border-b border-slate-200 dark:border-slate-800",
          "bg-slate-50 dark:bg-slate-900/50",
          "hover:bg-slate-100 dark:hover:bg-slate-900/80",
          "transition-colors duration-200"
        )}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 dark:text-primary-400 shadow-sm border border-primary-200/50 dark:border-primary-800/50">
            <Book size={24} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h3 className="font-bold text-slate-900 dark:text-white text-xl leading-tight">
                {norma.tipo_atto}
                {/* Show number only if NOT an alias */}
                {!norma.tipo_atto_reale && norma.numero_atto && ` ${norma.numero_atto}`}
              </h3>
              {isNew && (
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase bg-primary-600 text-white rounded-full shadow-sm tracking-wider">
                  Nuovo Risultato
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5">
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                {norma.tipo_atto_reale ? (
                  // For aliases: show real type abbreviation + date + number
                  <>
                    {abbreviateActType(norma.tipo_atto_reale)}
                    {norma.data && ` ${formatDateItalianLong(norma.data)}`}
                    {norma.numero_atto && `, n. ${norma.numero_atto}`}
                  </>
                ) : (
                  norma.data ? `Edizione del ${formatDateItalianLong(norma.data)}` : 'Data non disponibile'
                )}
              </p>
              <div className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-700" />
              <span className="text-xs bg-slate-200/50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
                {articles.length} {articles.length === 1 ? 'articolo' : 'articoli'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Quick Add Article */}
          <AnimatePresence>
            {quickAddOpen ? (
              <motion.form
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'auto', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleQuickAddArticle}
                className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-primary-200 dark:border-primary-800 p-1.5 rounded-xl shadow-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="text"
                  value={quickAddValue}
                  onChange={(e) => setQuickAddValue(e.target.value)}
                  placeholder="Es. 1, 12..."
                  autoFocus
                  className="w-24 px-2 py-1 text-sm bg-transparent border-none focus:outline-none focus:ring-0 dark:text-white"
                />
                <button
                  type="submit"
                  className="p-1.5 text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors shadow-sm"
                >
                  <ArrowRight size={14} />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setQuickAddOpen(false); setQuickAddValue(''); }}
                  className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors"
                >
                  <X size={14} />
                </button>
              </motion.form>
            ) : (
              <button
                className="h-10 px-4 text-xs font-bold text-primary-600 bg-primary-50 hover:bg-primary-100 dark:text-primary-400 dark:bg-primary-900/30 dark:hover:bg-primary-900/50 rounded-xl transition-all flex items-center gap-2 border border-primary-100/50 dark:border-primary-800/50"
                onClick={(e) => { e.stopPropagation(); setQuickAddOpen(true); }}
              >
                <Plus size={16} /> <span>Aggiungi Articolo</span>
              </button>
            )}
          </AnimatePresence>

          {norma.urn && (
            <button
              className="h-10 px-4 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-xl transition-all border border-red-100/50 dark:border-red-800/20"
              onClick={(e) => {
                e.stopPropagation();
                onViewPdf(norma.urn!);
              }}
            >
              PDF
            </button>
          )}
          {norma.urn && (
            <button
              className="h-10 px-4 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 dark:text-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:bg-slate-700 rounded-xl transition-all flex items-center gap-2 shadow-sm"
              onClick={(e) => {
                e.stopPropagation();
                setTreeVisible(!treeVisible);
                if (!treeData) fetchTree();
              }}
            >
              <GitBranch size={16} className="text-emerald-500" />
              <span>Struttura</span>
            </button>
          )}
          <div className="w-10 h-10 flex items-center justify-center text-slate-400 dark:text-slate-500">
            <ChevronDown className={cn("transition-transform duration-300", isOpen ? "rotate-180" : "")} size={20} />
          </div>
        </div>
      </div>

      {/* Tree View Side Panel - Now includes annex selection */}
      <TreeViewPanel
        isOpen={treeVisible}
        onClose={() => setTreeVisible(false)}
        treeData={treeData || []}
        urn={norma.urn || ''}
        title="Struttura dell'Atto"
        loadedArticles={loadedArticleIds}
        onArticleSelect={(articleNumber, targetAnnex) => {
          handleLoadArticle(articleNumber, targetAnnex);
          setTreeVisible(false);
        }}
        annexes={treeMetadata?.annexes}
        currentAnnex={currentAnnex}
      />

      {/* Content */}
      {isOpen && (
        <div className="bg-slate-50/50 dark:bg-slate-900/30">
          {/* Annex suggestion - show when article exists in other annexes */}
          {treeMetadata?.annexes && treeMetadata.annexes.length > 1 && activeArticle && (
            <div className="px-4 md:px-6 pt-4">
              <AnnexSuggestion
                articleNumber={activeArticle.norma_data.numero_articolo}
                currentAnnex={activeArticle.norma_data.allegato || null}
                annexes={treeMetadata.annexes}
                onSwitchAnnex={async (annexNumber): Promise<string | null> => {
                  const targetArticle = await handleAnnexSelect(annexNumber);
                  if (targetArticle) {
                    const uniqueId = annexNumber ? `all${annexNumber}:${targetArticle}` : targetArticle;
                    setActiveTabId(uniqueId);
                  }
                  return targetArticle;
                }}
              />
            </div>
          )}

          {/* Internal Navigation bar */}
          {(allArticleIds && allArticleIds.length > 1) || articles.length > 1 ? (
            <div className="hidden md:flex px-6 py-4 items-center justify-between border-b border-slate-200/50 dark:border-slate-800/50 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
              {/* Navigation Bar - Filtered for current context */}
              <ArticleNavigation
                allArticleIds={allArticleIds}
                loadedArticleIds={loadedArticleIds
                  .filter(id => currentAnnex ? id.startsWith(`all${currentAnnex}:`) : !id.includes(':'))
                  .map(id => id.includes(':') ? id.split(':').pop()! : id)
                }
                activeArticleId={activeArticle?.norma_data.numero_articolo || null}
                loadingArticleId={loadingArticle}
                onNavigate={(number) => {
                  // Convert back to unique ID for navigation
                  const uniqueId = currentAnnex ? `all${currentAnnex}:${number}` : number;
                  setActiveTabId(uniqueId);
                }}
                onLoadArticle={handleLoadArticle}
              />
              <ArticleMinimap
                loadedArticleIds={loadedArticleIds
                  .filter(id => currentAnnex ? id.startsWith(`all${currentAnnex}:`) : !id.includes(':'))
                  .map(id => id.includes(':') ? id.split(':').pop()! : id)
                }
                activeArticleId={activeArticle?.norma_data.numero_articolo || null}
                onArticleClick={handleArticleSelect}
                className="max-w-[400px]"
              />
            </div>
          ) : null}

          {/* Desktop Article Tabs */}
          <div className="hidden md:flex px-6 border-b border-slate-200 dark:border-slate-800 gap-1 overflow-x-auto no-scrollbar relative bg-white dark:bg-slate-900">
            {articles.map((article) => {
              const id = article.norma_data.numero_articolo;
              const allegato = article.norma_data.allegato;
              const uniqueKey = allegato ? `all${allegato}:${id}` : id;
              const isActive = uniqueKey === activeTabId;

              return (
                <div
                  key={uniqueKey}
                  className={cn(
                    "relative px-6 py-4 text-sm font-bold transition-all group flex items-center gap-3 flex-shrink-0 cursor-pointer overflow-hidden",
                    isActive
                      ? "text-primary-600 dark:text-primary-400"
                      : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  )}
                  onClick={() => setActiveTabId(uniqueKey)}
                >
                  <span className="relative z-10 uppercase tracking-wide text-xs">Art. {id}</span>

                  {/* Active Indicator */}
                  {isActive && (
                    <motion.span
                      layoutId="activeNormaTab"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-500 shadow-[0_-4px_10px_rgba(59,130,246,0.3)]"
                      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    />
                  )}

                  {/* Tab Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity relative z-10">
                    <button
                      className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 rounded-lg transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Pass unique ID to onCloseArticle - the store's remove func supports it
                        onCloseArticle(uniqueKey);
                      }}
                      title="Chiudi sessione"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mobile: Expandable List */}
          <div className="md:hidden bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
            {articles.map((article) => {
              const articleId = article.norma_data.numero_articolo;
              const allegato = article.norma_data.allegato;
              const uniqueKey = allegato ? `all${allegato}:${articleId}` : articleId;
              const isExpanded = expandedArticles.has(uniqueKey);
              return (
                <div key={uniqueKey} className="overflow-hidden">
                  <div
                    onClick={() => toggleArticleExpanded(uniqueKey)}
                    className={cn(
                      "w-full p-4 flex items-center justify-between transition-colors cursor-pointer",
                      isExpanded ? "bg-primary-50/30 dark:bg-primary-900/10" : "bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center transition-colors font-bold text-xs",
                        isExpanded ? "bg-primary-600 text-white shadow-md shadow-primary-500/20" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                      )}>
                        {articleId}
                      </div>
                      <h4 className={cn(
                        "font-bold text-base transition-colors",
                        isExpanded ? "text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-400"
                      )}>
                        Dispositivo Articolo
                      </h4>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onCloseArticle(uniqueKey);
                        }}
                        className="p-2 text-slate-400 hover:text-red-500 rounded-lg"
                      >
                        <X size={16} />
                      </button>
                      <ChevronDown
                        size={18}
                        className={cn(
                          "text-slate-400 transition-transform duration-300",
                          isExpanded ? "rotate-180" : ""
                        )}
                      />
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: "easeInOut" }}
                        className="overflow-hidden border-t border-slate-100 dark:border-slate-800"
                      >
                        <div className="p-4 bg-slate-50/50 dark:bg-slate-900/50">
                          <ArticleTabContent
                            data={article}
                            onCrossReferenceNavigate={onCrossReference}
                            onOpenStudyMode={() => openStudyMode(article)}
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>

          {/* Desktop Content Area */}
          <div
            ref={contentRef}
            className="hidden md:block bg-white dark:bg-slate-900 min-h-[400px] overflow-hidden relative"
          >
            {/* Loading Overlay */}
            <AnimatePresence>
              {loadingArticle && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center"
                >
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.1 }}
                    className="flex flex-col items-center gap-3"
                  >
                    <div className="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                      <Loader2 size={24} className="text-primary-600 dark:text-primary-400 animate-spin" />
                    </div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                      Caricamento articolo...
                    </p>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait" initial={false}>
              {activeArticle && (
                <motion.div
                  key={activeArticle.norma_data.allegato ? `all${activeArticle.norma_data.allegato}:${activeArticle.norma_data.numero_articolo}` : activeArticle.norma_data.numero_articolo}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  className="p-8"
                >
                  <ArticleTabContent
                    data={activeArticle}
                    onCrossReferenceNavigate={onCrossReference}
                    onOpenStudyMode={() => openStudyMode(activeArticle)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
            {!activeArticle && !loadingArticle && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Book size={48} className="opacity-20 mb-4" />
                <p className="text-sm font-medium">Seleziona un articolo per visualizzarne il contenuto</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Study Mode Portal */}
      <AnimatePresence>
        {studyModeOpen && studyModeArticle && (
          <StudyMode
            article={studyModeArticle}
            onClose={() => {
              setStudyModeOpen(false);
              setStudyModeArticle(null);
            }}
            onCrossReferenceNavigate={onCrossReference}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
