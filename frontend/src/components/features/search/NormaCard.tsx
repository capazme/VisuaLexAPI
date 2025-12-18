import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Book, ChevronDown, X, GitBranch, Plus, ArrowRight, ExternalLink } from 'lucide-react';
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

export function NormaCard({ norma, articles, onCloseArticle, onViewPdf, onCompareArticle: _onCompareArticle, onCrossReference, isNew }: NormaCardProps) {
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
                {norma.tipo_atto} {norma.numero_atto}
              </h3>
              {isNew && (
                <span className="flex-shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase bg-primary-600 text-white rounded-full shadow-sm">
                  Nuovo
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 font-medium">
              {norma.data ? `Data: ${norma.data}` : 'Estremi non disponibili'}
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
                {norma.tipo_atto} {norma.numero_atto}
              </h3>
              {isNew && (
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase bg-primary-600 text-white rounded-full shadow-sm tracking-wider">
                  Nuovo Risultato
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5">
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                {norma.data ? `Edizione del ${norma.data}` : 'Data non disponibile'}
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

      {/* Tree View Side Panel */}
      <TreeViewPanel
        isOpen={treeVisible}
        onClose={() => setTreeVisible(false)}
        treeData={treeData || []}
        urn={norma.urn || ''}
        title="Struttura dell'Atto"
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
        <div className="bg-slate-50/50 dark:bg-slate-900/30">
          {/* Internal Navigation bar */}
          {(allArticleIds && allArticleIds.length > 1) || articles.length > 1 ? (
            <div className="hidden md:flex px-6 py-4 items-center justify-between border-b border-slate-200/50 dark:border-slate-800/50 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
              <ArticleNavigation
                allArticleIds={allArticleIds}
                loadedArticleIds={loadedArticleIds}
                activeArticleId={activeTabId}
                onNavigate={setActiveTabId}
                onLoadArticle={handleLoadArticle}
              />
              <ArticleMinimap
                loadedArticleIds={loadedArticleIds}
                activeArticleId={activeTabId}
                onArticleClick={handleArticleSelect}
                className="max-w-[400px]"
              />
            </div>
          ) : null}

          {/* Desktop Article Tabs */}
          <div className="hidden md:flex px-6 border-b border-slate-200 dark:border-slate-800 gap-1 overflow-x-auto no-scrollbar relative bg-white dark:bg-slate-900">
            {articles.map((article) => {
              const id = article.norma_data.numero_articolo;
              const isActive = id === activeTabId;
              return (
                <div
                  key={id}
                  className={cn(
                    "relative px-6 py-4 text-sm font-bold transition-all group flex items-center gap-3 flex-shrink-0 cursor-pointer overflow-hidden",
                    isActive
                      ? "text-primary-600 dark:text-primary-400"
                      : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  )}
                  onClick={() => setActiveTabId(id)}
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
                        onCloseArticle(id);
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
              const isExpanded = expandedArticles.has(articleId);
              return (
                <div key={articleId} className="overflow-hidden">
                  <div
                    onClick={() => toggleArticleExpanded(articleId)}
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
                          onCloseArticle(articleId);
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
            className="hidden md:block bg-white dark:bg-slate-900 min-h-[400px] overflow-hidden"
          >
            <AnimatePresence mode="wait" initial={false}>
              {activeArticle && (
                <motion.div
                  key={activeArticle.norma_data.numero_articolo}
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
            {!activeArticle && (
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
