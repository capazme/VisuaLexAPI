import { useState } from 'react';
import { FileText, GripVertical, ChevronRight, ChevronDown, Trash2 } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useDraggable } from '@dnd-kit/core';
import type { LooseArticle } from '../../../store/useAppStore';
import { ArticleTabContent } from '../search/ArticleTabContent';
import { StudyMode } from './StudyMode';
import { cn } from '../../../lib/utils';
import type { ArticleData } from '../../../types';

interface LooseArticleCardProps {
  tabId: string;
  looseArticle: LooseArticle;
  onViewPdf: (urn: string) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
  onRemove?: () => void;
}

export function LooseArticleCard({
  tabId,
  looseArticle,
  onViewPdf,
  onCrossReference,
  onRemove
}: LooseArticleCardProps) {
  const { article, sourceNorma } = looseArticle;
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [studyModeOpen, setStudyModeOpen] = useState(false);

  // Make this loose article draggable
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `loose-${looseArticle.id}`,
    data: {
      type: 'loose-article',
      itemId: looseArticle.id,
      sourceTabId: tabId,
      sourceNorma: sourceNorma, // For compatibility check when dropping on NormaBlock
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "bg-white dark:bg-slate-800 rounded-xl border border-amber-200 dark:border-amber-800/50 overflow-hidden transition-all shadow-sm hover:shadow-md",
        isDragging && "opacity-50 scale-95"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-3 sm:p-4 bg-gradient-to-r from-amber-50 to-white dark:from-amber-950/30 dark:to-slate-900/30 border-b border-amber-100 dark:border-amber-900/30">
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded transition-colors"
          title="Trascina articolo"
        >
          <GripVertical size={16} className="text-amber-400" />
        </div>

        {/* Delete button with confirmation */}
        {onRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm('Eliminare questo articolo?')) {
                onRemove();
              }
            }}
            className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
            title="Elimina articolo"
          >
            <Trash2 size={14} className="text-red-500 opacity-70 hover:opacity-100" />
          </button>
        )}

        {/* Collapse toggle */}
        <div
          className="flex items-center gap-3 flex-1 cursor-pointer min-w-0"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? (
            <ChevronRight size={16} className="text-amber-500 shrink-0" />
          ) : (
            <ChevronDown size={16} className="text-amber-500 shrink-0" />
          )}

          <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800/50 flex items-center justify-center shadow-sm shrink-0">
            <FileText size={16} className="text-amber-500 dark:text-amber-400" />
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-sm text-slate-900 dark:text-white truncate">
              Art. {article.norma_data.numero_articolo}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              da {sourceNorma.tipo_atto}
              {sourceNorma.numero_atto && ` n. ${sourceNorma.numero_atto}`}
              {sourceNorma.data && ` del ${sourceNorma.data}`}
            </p>
          </div>
        </div>

        {article.norma_data.url && !isCollapsed && (
          <button
            className="px-2 py-1 text-xs font-medium text-amber-600 bg-white hover:bg-amber-50 dark:text-amber-400 dark:bg-slate-800 border border-amber-200 dark:border-amber-800/50 rounded-lg transition-colors"
            onClick={() => onViewPdf(article.norma_data.url!)}
          >
            PDF
          </button>
        )}
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div className="p-4 sm:p-5">
          <ArticleTabContent
            data={article}
            onCrossReferenceNavigate={onCrossReference}
            onOpenStudyMode={() => setStudyModeOpen(true)}
          />
        </div>
      )}

      {/* Study Mode */}
      <AnimatePresence>
        {studyModeOpen && (
          <StudyMode
            article={article}
            onClose={() => setStudyModeOpen(false)}
            onCrossReferenceNavigate={onCrossReference}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
