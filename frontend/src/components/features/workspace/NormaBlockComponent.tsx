import { useState } from 'react';
import { Book, ChevronDown, ChevronRight, ExternalLink, X, GripVertical } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { useAppStore, type NormaBlock } from '../../../store/useAppStore';
import { ArticleTabContent } from '../search/ArticleTabContent';
import { cn } from '../../../lib/utils';
import type { ArticleData } from '../../../types';

interface NormaBlockComponentProps {
  tabId: string;
  normaBlock: NormaBlock;
  onViewPdf: (urn: string) => void;
  onCompareArticle: (article: ArticleData) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
  onExtractArticle: (articleId: string) => void;
  onRemoveArticle: (articleId: string) => void;
}

export function NormaBlockComponent({
  tabId,
  normaBlock,
  onViewPdf,
  onCompareArticle,
  onCrossReference,
  onExtractArticle,
  onRemoveArticle
}: NormaBlockComponentProps) {
  const [activeArticleId, setActiveArticleId] = useState<string | null>(
    normaBlock.articles[0]?.norma_data?.numero_articolo || null
  );

  const { toggleNormaCollapse } = useAppStore();

  // Make this norma draggable
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `norma-${normaBlock.id}`,
    data: {
      type: 'norma',
      itemId: normaBlock.id,
      sourceTabId: tabId,
    },
  });

  const activeArticle = normaBlock.articles.find(
    a => a.norma_data.numero_articolo === activeArticleId
  );

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden transition-opacity",
        isDragging && "opacity-50"
      )}
    >
      {/* Norma Header */}
      <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          {/* Drag handle */}
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
            title="Trascina norma"
          >
            <GripVertical size={16} className="text-gray-400" />
          </div>

          <div
            className="flex items-center gap-2 cursor-pointer flex-1"
            onClick={() => toggleNormaCollapse(tabId, normaBlock.id)}
          >
          {normaBlock.isCollapsed ? (
            <ChevronRight size={16} className="text-gray-500" />
          ) : (
            <ChevronDown size={16} className="text-gray-500" />
          )}

          <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
            <Book size={16} className="text-blue-600 dark:text-blue-400" />
          </div>

          <div>
            <h4 className="font-semibold text-sm text-gray-900 dark:text-white">
              {normaBlock.norma.tipo_atto}
              {normaBlock.norma.numero_atto && ` n. ${normaBlock.norma.numero_atto}`}
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {normaBlock.norma.data || 'Estremi non disponibili'} · {normaBlock.articles.length} articoli
            </p>
          </div>
          </div>
        </div>

        {normaBlock.norma.urn && !normaBlock.isCollapsed && (
          <button
            className="px-2 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-900/20 rounded transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onViewPdf(normaBlock.norma.urn);
            }}
          >
            PDF
          </button>
        )}
      </div>

      {/* Articles */}
      {!normaBlock.isCollapsed && (
        <div className="bg-gray-50/50 dark:bg-gray-900/50">
          {/* Article tabs */}
          <div className="px-3 pt-3 border-b border-gray-200 dark:border-gray-700 flex gap-2 overflow-x-auto no-scrollbar">
            {normaBlock.articles.map((article) => {
              const id = article.norma_data.numero_articolo;
              const isActive = id === activeArticleId;

              return (
                <div
                  key={id}
                  className={cn(
                    "group flex items-center gap-2 px-3 py-2 rounded-t-lg text-xs font-medium border-t border-x border-b-0 cursor-pointer transition-all min-w-[100px] justify-between",
                    isActive
                      ? "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-blue-600 dark:text-blue-400 relative -bottom-px z-10"
                      : "bg-gray-100 dark:bg-gray-800/50 border-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700/50"
                  )}
                  onClick={() => setActiveArticleId(id)}
                >
                  <span>Art. {id}</span>
                  <div className={cn(
                    "flex items-center gap-1 transition-opacity",
                    isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  )}>
                    {normaBlock.articles.length > 1 && (
                      <button
                        className="p-1 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
                        onClick={(e) => {
                          e.stopPropagation();
                          onExtractArticle(id);
                        }}
                        title="Estrai come articolo loose"
                      >
                        <ExternalLink size={12} />
                      </button>
                    )}
                    <button
                      className="p-1 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveArticle(id);
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

          {/* Active article content */}
          <div className="p-4 bg-white dark:bg-gray-800 min-h-[200px]">
            {activeArticle ? (
              <ArticleTabContent
                key={activeArticle.norma_data.numero_articolo}
                data={activeArticle}
                onCompare={onCompareArticle}
                onCrossReferenceNavigate={onCrossReference}
              />
            ) : (
              <div className="flex items-center justify-center h-40 text-gray-400">
                <p className="text-sm">Nessun articolo selezionato</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
