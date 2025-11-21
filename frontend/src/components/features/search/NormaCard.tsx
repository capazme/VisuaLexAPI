import React, { useState } from 'react';
import { Book, ChevronDown, X, GitBranch, ExternalLink } from 'lucide-react';
import type { Norma, ArticleData } from '../../../types';
import { cn } from '../../../lib/utils';
import { ArticleTabContent } from './ArticleTabContent';

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

      {/* Content */}
      {isOpen && (
        <div className="bg-gray-50/50 dark:bg-gray-900/50">
          {treeVisible && (
            <div className="px-4 pt-4">
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3 max-h-60 overflow-y-auto text-sm">
                    <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-gray-700 dark:text-gray-200">Struttura Atto</span>
                        {treeLoading && <span className="text-xs text-gray-400">Caricamento...</span>}
                    </div>
                    {treeError && <div className="text-xs text-red-500">{treeError}</div>}
                    {!treeLoading && !treeError && treeData && renderTreeNodes(treeData)}
                    {!treeLoading && !treeError && !treeData && (
                        <div className="text-xs text-gray-400">Struttura non disponibile.</div>
                    )}
                </div>
            </div>
          )}

          {/* Tabs */}
          <div className="px-4 pt-4 border-b border-gray-200 dark:border-gray-700 flex gap-2 overflow-x-auto no-scrollbar">
            {articles.map((article) => {
                const id = article.norma_data.numero_articolo;
                const isActive = id === activeTabId;
                return (
                    <div 
                        key={id}
                        className={cn(
                            "group flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-medium border-t border-x border-b-0 cursor-pointer transition-all min-w-[100px] justify-between",
                            isActive 
                                ? "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-blue-600 dark:text-blue-400 relative -bottom-px z-10" 
                                : "bg-gray-100 dark:bg-gray-800/50 border-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700/50"
                        )}
                        onClick={() => setActiveTabId(id)}
                    >
                        <span>Art. {id}</span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
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

function renderTreeNodes(nodes: any, depth = 0) {
  if (!nodes) return null;
  const list = Array.isArray(nodes) ? nodes : Object.values(nodes);
  return (
    <ul className={cn('space-y-1 text-gray-600 dark:text-gray-300', depth > 0 && 'ml-4 text-xs')}>
      {list.map((node: any, idx: number) => {
        const label = node?.title || node?.label || node?.name || node?.numero || (typeof node === 'string' ? node : `Nodo ${idx + 1}`);
        const children = node?.children || node?.items || node?.articoli;
        return (
          <li key={node?.id || idx}>
            <div className="flex items-start gap-2">
              <span className="mt-1 h-1 w-1 rounded-full bg-gray-400" />
              <span>{label}</span>
            </div>
            {children && renderTreeNodes(children, depth + 1)}
          </li>
        );
      })}
    </ul>
  );
}
