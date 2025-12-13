import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Book, ChevronDown, X, GitBranch, ExternalLink, Plus, ArrowRight } from 'lucide-react';
import type { Norma, ArticleData } from '../../../types';
import { cn } from '../../../lib/utils';
import { ArticleTabContent } from './ArticleTabContent';
import { TreeViewPanel } from './TreeViewPanel';
import { useAppStore } from '../../../store/useAppStore';

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

export function NormaCard({ norma, articles, onCloseArticle, onViewPdf, onCompareArticle, onCrossReference, onPopOut, isNew }: NormaCardProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [treeVisible, setTreeVisible] = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeData, setTreeData] = useState<any[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddValue, setQuickAddValue] = useState('');
  const { triggerSearch } = useAppStore();

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
    if (!norma.urn) return;
    try {
        setTreeLoading(true);
        setTreeError(null);
        const res = await fetch('/fetch_tree', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urn: norma.urn, link: false, details: true })
        });
        if (!res.ok) throw new Error('Impossibile caricare la struttura');
        const payload = await res.json();
        setTreeData(payload.articles || payload);
    } catch (e: any) {
        setTreeError(e.message);
    } finally {
        setTreeLoading(false);
    }
  };

  // Set first tab active when articles change if no tab is active
  React.useEffect(() => {
    if (articles.length > 0 && !activeTabId) {
        setActiveTabId(articles[0].norma_data.numero_articolo);
    } else if (articles.length > 0 && activeTabId && !articles.find(a => a.norma_data.numero_articolo === activeTabId)) {
        // If active tab was closed, switch to first available
        setActiveTabId(articles[0].norma_data.numero_articolo);
    }
  }, [articles, activeTabId]);
  
  const activeArticle = articles.find(a => a.norma_data.numero_articolo === activeTabId);

  if (articles.length === 0) return null;

  return (
    <div className={cn(
      "bg-white dark:bg-gray-800 rounded-xl shadow-sm border overflow-hidden mb-6 transition-all duration-200 hover:shadow-md",
      isNew ? "border-blue-500 ring-2 ring-blue-500/20" : "border-gray-200 dark:border-gray-700"
    )}>
      {/* Header */}
      <div 
        className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between cursor-pointer bg-white dark:bg-gray-800"
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
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {norma.data ? `Data: ${norma.data}` : 'Estremi non disponibili'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
            {/* Quick Add Article */}
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
                  <Plus size={14} /> Articolo
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
                >
                    <span className="flex items-center gap-1"><GitBranch size={14} /> Struttura</span>
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
      />

      {/* Content */}
      {isOpen && (
        <div className="bg-gray-50/50 dark:bg-gray-900/50">
          {/* Modern Underline Tabs */}
          <div className="px-5 border-b border-gray-200 dark:border-gray-700 flex gap-0 overflow-x-auto no-scrollbar">
            {articles.map((article) => {
                const id = article.norma_data.numero_articolo;
                const isActive = id === activeTabId;
                return (
                    <button
                        key={id}
                        className={cn(
                            "relative px-6 py-3 text-sm font-medium transition-all group flex items-center gap-2",
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
                    </button>
                );
            })}
          </div>

          {/* Tab Pane */}
          <div className="p-6 bg-white dark:bg-gray-800 min-h-[300px]">
            {activeArticle ? (
                <ArticleTabContent 
                    key={activeArticle.norma_data.numero_articolo} 
                    data={activeArticle} 
                    onCompare={onCompareArticle}
                    onCrossReferenceNavigate={onCrossReference}
                />
            ) : (
                <div className="text-center py-10 text-gray-400">
                    Nessun articolo selezionato
                </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
