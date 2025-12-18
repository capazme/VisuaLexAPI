import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Book, ChevronDown, X, GitBranch, ExternalLink, Plus, ArrowRight } from 'lucide-react';
import type { Norma, ArticleData } from '../../../types';
import { cn } from '../../../lib/utils';
import { ArticleTabContent } from './ArticleTabContent';
import { TreeViewPanel } from './TreeViewPanel';
import { ArticleNavigation } from '../workspace/ArticleNavigation';
import { ArticleMinimap } from '../workspace/ArticleMinimap';
import { StudyMode } from '../workspace/StudyMode';
import { useAppStore } from '../../../store/useAppStore';
import { extractArticleIdsFromTree } from '../../../utils/treeUtils';

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
}

export function NormaCard({ norma, articles, onCloseArticle, onViewPdf, onCompareArticle: _onCompareArticle, onCrossReference, onPopOut, isNew }: NormaCardProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [treeVisible, setTreeVisible] = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeData, setTreeData] = useState<any[] | null>(null);
  const [_treeError, _setTreeError] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddValue, setQuickAddValue] = useState('');
  // Mobile: track which articles are expanded (by default first one is expanded)
  const [expandedArticles, setExpandedArticles] = useState<Set<string>>(() => {
    const first = articles[0]?.norma_data?.numero_articolo;
    return first ? new Set([first]) : new Set();
  });
  // Study Mode state
  const [studyModeOpen, setStudyModeOpen] = useState(false);
  const [studyModeArticle, setStudyModeArticle] = useState<ArticleData | null>(null);
  const { triggerSearch } = useAppStore();

  const toggleArticleExpanded = (articleId: string) => {
    setExpandedArticles(prev => {
      const next = new Set(prev);
      if (next.has(articleId)) {
        next.delete(articleId);
      } else {
        next.add(articleId);
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

    // Trigger search for the new article
    triggerSearch({
      act_type: norma.tipo_atto,
      act_number: norma.numero_atto || '',
      date: norma.data || '',
      article: quickAddValue.trim(),
      version: 'vigente',
      version_date: '',
      show_brocardi_info: true
    });

    setQuickAddValue('');
    setQuickAddOpen(false);
  };

  const fetchTree = async () => {
    if (!norma.urn || treeData) return; // Don't refetch if already loaded
    try {
      setTreeLoading(true);
      const res = await fetch('/fetch_tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urn: norma.urn, link: false, details: true })
      });
      if (!res.ok) throw new Error('Impossibile caricare la struttura');
      const payload = await res.json();
      setTreeData(payload.articles || payload);
    } catch (e: any) {
      console.error('Error fetching tree:', e);
    } finally {
      setTreeLoading(false);
    }
  };

  // Auto-fetch tree structure when norma has URN
  useEffect(() => {
    if (norma.urn && !treeData && !treeLoading) {
      fetchTree();
    }
  }, [norma.urn]);

  // Set first tab active when articles change if no tab is active
  useEffect(() => {
    if (articles.length > 0 && !activeTabId) {
      setActiveTabId(articles[0].norma_data.numero_articolo);
    } else if (articles.length > 0 && activeTabId && !articles.find(a => a.norma_data.numero_articolo === activeTabId)) {
      // If active tab was closed, switch to first available
      setActiveTabId(articles[0].norma_data.numero_articolo);
    }
  }, [articles, activeTabId]);

  const activeArticle = articles.find(a => a.norma_data.numero_articolo === activeTabId);
  const contentRef = useRef<HTMLDivElement>(null);

  // Loaded article IDs
  const loadedArticleIds = articles.map(a => a.norma_data.numero_articolo);

  // All article IDs from structure (if available)
  const allArticleIds = treeData ? extractArticleIdsFromTree(treeData) : undefined;

  // Function to load a new article
  const handleLoadArticle = (articleNumber: string) => {
    triggerSearch({
      act_type: norma.tipo_atto,
      act_number: norma.numero_atto || '',
      date: norma.data || '',
      article: articleNumber,
      version: 'vigente',
      version_date: '',
      show_brocardi_info: true
    });
  };

  // Function to navigate to a loaded article or load it if not present
  const handleArticleSelect = (articleNumber: string) => {
    if (loadedArticleIds.includes(articleNumber)) {
      setActiveTabId(articleNumber);
    } else {
      handleLoadArticle(articleNumber);
    }
  };

  if (articles.length === 0) return null;

  return (
    <div className={cn(
      "rounded-xl overflow-hidden mb-6",
      "bg-white dark:bg-gray-800",
      "border shadow-md",
      "transition-all duration-200",
      "hover:shadow-lg",
      isNew
        ? "border-blue-500 ring-2 ring-blue-500/20"
        : "border-gray-200 dark:border-gray-700"
    )}>
      {/* Mobile Header - Simplified for quick lookup */}
      <div
        className={cn(
          "md:hidden",
          "p-4 cursor-pointer",
          "border-b border-gray-200 dark:border-gray-700",
          "bg-gray-50 dark:bg-gray-800/50",
          "hover:bg-gray-100 dark:hover:bg-gray-700",
          "transition-colors duration-200"
        )}
        onClick={() => setIsOpen(!isOpen)}
      >
        {/* Top row: Icon and title */}
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 flex-shrink-0 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Book size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-bold text-gray-900 dark:text-white text-base leading-tight">
                {norma.tipo_atto} {norma.numero_atto}
              </h3>
              {isNew && (
                <span className="flex-shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase bg-blue-500 text-white rounded-full animate-pulse">
                  Nuovo
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              {norma.data ? `Data: ${norma.data}` : 'Estremi non disponibili'}
            </p>
            <span className="inline-block text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full font-medium">
              {articles.length} {articles.length === 1 ? 'articolo' : 'articoli'}
            </span>
          </div>
        </div>

        {/* Bottom row: Action buttons with proper touch targets */}
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {norma.urn && (
            <button
              className="flex-1 p-3 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                onViewPdf(norma.urn!);
              }}
              title="Esporta PDF"
            >
              PDF
            </button>
          )}
          {norma.urn && (
            <button
              className="flex-1 p-3 text-xs font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/20 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                setTreeVisible(!treeVisible);
                if (!treeData) {
                  fetchTree();
                }
              }}
              title="Visualizza struttura"
            >
              <GitBranch size={14} />
              <span>Struttura</span>
            </button>
          )}
          <button
            className="p-3 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            onClick={() => setIsOpen(!isOpen)}
            title={isOpen ? "Chiudi" : "Apri"}
          >
            <ChevronDown className={cn("transition-transform duration-200", isOpen ? "rotate-180" : "")} size={20} />
          </button>
        </div>
      </div>

      {/* Desktop Header - Full experience */}
      <div
        className={cn(
          "hidden md:flex",
          "p-4 items-center justify-between cursor-pointer",
          "border-b border-gray-200 dark:border-gray-700",
          "bg-gray-50 dark:bg-gray-800/50",
          "hover:bg-gray-100 dark:hover:bg-gray-700",
          "transition-colors duration-200"
        )}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Book size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-gray-900 dark:text-white text-lg leading-tight">
                {norma.tipo_atto} {norma.numero_atto}
              </h3>
              {isNew && (
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase bg-blue-500 text-white rounded-full animate-pulse">
                  Nuovo
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {norma.data ? `Data: ${norma.data}` : 'Estremi non disponibili'}
              </p>
              <span className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full font-medium">
                {articles.length} {articles.length === 1 ? 'articolo' : 'articoli'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Quick Add Article - Desktop only */}
          <AnimatePresence>
            {quickAddOpen ? (
              <motion.form
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'auto', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleQuickAddArticle}
                className="flex items-center gap-1 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="text"
                  value={quickAddValue}
                  onChange={(e) => setQuickAddValue(e.target.value)}
                  placeholder="es. 1, 2-5"
                  autoFocus
                  className="w-24 px-2 py-1 text-xs border border-blue-300 dark:border-blue-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-white"
                />
                <button
                  type="submit"
                  className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md transition-colors"
                  title="Aggiungi"
                >
                  <ArrowRight size={14} />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setQuickAddOpen(false); setQuickAddValue(''); }}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded-md transition-colors"
                  title="Annulla"
                >
                  <X size={14} />
                </button>
              </motion.form>
            ) : (
              <button
                className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-900/20 rounded-md transition-colors flex items-center gap-1"
                onClick={(e) => { e.stopPropagation(); setQuickAddOpen(true); }}
                title="Aggiungi articolo"
              >
                <Plus size={14} /> <span>Articolo</span>
              </button>
            )}
          </AnimatePresence>

          {norma.urn && (
            <button
              className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-md transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onViewPdf(norma.urn!);
              }}
              title="Esporta PDF"
            >
              PDF
            </button>
          )}
          {norma.urn && (
            <button
              className="px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/20 rounded-md transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setTreeVisible(!treeVisible);
                if (!treeData) {
                  fetchTree();
                }
              }}
              title="Visualizza struttura"
            >
              <span className="flex items-center gap-1"><GitBranch size={14} /> <span>Struttura</span></span>
            </button>
          )}
          <ChevronDown className={cn("text-gray-400 transition-transform duration-200", isOpen ? "rotate-180" : "")} size={20} />
        </div>
      </div>

      {/* Tree View Side Panel */}
      <TreeViewPanel
        isOpen={treeVisible}
        onClose={() => setTreeVisible(false)}
        treeData={treeData || []}
        urn={norma.urn || ''}
        title="Struttura Atto"
        loadedArticles={loadedArticleIds}
        onArticleSelect={(articleNumber) => {
          triggerSearch({
            act_type: norma.tipo_atto,
            act_number: norma.numero_atto || '',
            date: norma.data || '',
            article: articleNumber,
            version: 'vigente',
            version_date: '',
            show_brocardi_info: true
          });
          setTreeVisible(false);
        }}
      />

      {/* Content */}
      {isOpen && (
        <div className="bg-gray-50/50 dark:bg-gray-900/50">
          {/* Navigation bar - Desktop only (hidden on mobile since we show full list) */}
          {(allArticleIds && allArticleIds.length > 1) || articles.length > 1 ? (
            <div className="hidden md:flex px-5 pt-3 items-center justify-between">
              <ArticleNavigation
                allArticleIds={allArticleIds}
                loadedArticleIds={loadedArticleIds}
                activeArticleId={activeTabId}
                onNavigate={setActiveTabId}
                onLoadArticle={handleLoadArticle}
              />
              <ArticleMinimap
                allArticleIds={allArticleIds}
                loadedArticleIds={loadedArticleIds}
                activeArticleId={activeTabId}
                onArticleClick={handleArticleSelect}
                className="max-w-[300px]"
              />
            </div>
          ) : null}

          {/* Desktop Underline Tabs - Hidden on Mobile (< 768px) */}
          <div className="hidden md:flex px-5 border-b border-gray-200 dark:border-gray-700 gap-0 overflow-x-auto no-scrollbar relative">
            {articles.map((article) => {
              const id = article.norma_data.numero_articolo;
              const isActive = id === activeTabId;
              return (
                <div
                  key={id}
                  className={cn(
                    "relative px-6 py-3 text-sm font-medium transition-all group flex items-center gap-2 flex-shrink-0 cursor-pointer",
                    isActive
                      ? "text-blue-600 dark:text-blue-400"
                      : "text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/30"
                  )}
                  onClick={() => setActiveTabId(id)}
                >
                  <span>Art. {id}</span>

                  {/* Animated underline */}
                  {isActive && (
                    <motion.span
                      layoutId="activeTab"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500"
                      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    />
                  )}

                  {/* Actions (visible on hover) */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onPopOut && articles.length > 1 && (
                      <button
                        className="p-0.5 hover:text-blue-500 rounded"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPopOut(id);
                        }}
                        title="Estrai in nuova finestra"
                      >
                        <ExternalLink size={12} />
                      </button>
                    )}
                    <button
                      className="p-0.5 hover:text-red-500 rounded"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseArticle(id);
                      }}
                      title="Chiudi articolo"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mobile: Collapsible list of articles */}
          <div className="md:hidden bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
            {articles.map((article) => {
              const articleId = article.norma_data.numero_articolo;
              const isExpanded = expandedArticles.has(articleId);
              return (
                <div key={articleId} className="overflow-hidden">
                  {/* Collapsible header - always visible */}
                  <div
                    onClick={() => toggleArticleExpanded(articleId)}
                    className="w-full p-4 flex items-center justify-between bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <ChevronDown
                        size={18}
                        className={cn(
                          "text-gray-400 transition-transform duration-200",
                          isExpanded ? "rotate-180" : ""
                        )}
                      />
                      <h4 className="font-bold text-gray-900 dark:text-white text-base">
                        Art. {articleId}
                      </h4>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseArticle(articleId);
                      }}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      title="Chiudi articolo"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {/* Collapsible content */}
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 pt-2">
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
            {articles.length === 0 && (
              <div className="text-center py-10 text-gray-400">
                Nessun articolo caricato
              </div>
            )}
          </div>

          {/* Desktop: Tab Pane with single article */}
          <div
            ref={contentRef}
            className="hidden md:block bg-white dark:bg-gray-800 min-h-[300px] overflow-hidden"
          >
            <AnimatePresence mode="wait" initial={false}>
              {activeArticle && (
                <motion.div
                  key={activeArticle.norma_data.numero_articolo}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                  className="p-6"
                >
                  <ArticleTabContent
                    data={activeArticle}
                    onCrossReferenceNavigate={onCrossReference}
                    onOpenStudyMode={() => openStudyMode(activeArticle)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
            {!activeArticle && (
              <div className="text-center py-10 text-gray-400">
                Nessun articolo selezionato
              </div>
            )}
          </div>
        </div>
      )}

      {/* Study Mode */}
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
