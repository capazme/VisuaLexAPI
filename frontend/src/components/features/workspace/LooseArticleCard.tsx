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
        "bg-white dark:bg-gray-800 rounded-xl border-2 border-amber-200 dark:border-amber-800 overflow-hidden transition-all shadow-sm hover:shadow-md",
        isDragging && "opacity-50 scale-95"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-amber-50 to-amber-50/50 dark:from-amber-900/20 dark:to-amber-900/10 border-b border-amber-200 dark:border-amber-800">
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 hover:bg-amber-100 dark:hover:bg-amber-800 rounded transition-colors"
          title="Trascina articolo"
        >
          <GripVertical size={16} className="text-amber-500" />
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
            <Trash2 size={14} className="text-red-500" />
          </button>
        )}

        {/* Collapse toggle */}
        <div
          className="flex items-center gap-2 flex-1 cursor-pointer"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? (
            <ChevronRight size={16} className="text-amber-500" />
          ) : (
            <ChevronDown size={16} className="text-amber-500" />
          )}

          <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
            <FileText size={16} className="text-amber-600 dark:text-amber-400" />
          </div>

          <div className="flex-1">
            <h4 className="font-semibold text-sm text-gray-900 dark:text-white">
              Art. {article.norma_data.numero_articolo}
            </h4>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              da {sourceNorma.tipo_atto}
              {sourceNorma.numero_atto && ` n. ${sourceNorma.numero_atto}`}
              {sourceNorma.data && ` del ${sourceNorma.data}`}
            </p>
          </div>
        </div>

        {article.norma_data.url && !isCollapsed && (
          <button
            className="px-2 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-900/20 rounded transition-colors"
            onClick={() => onViewPdf(article.norma_data.url!)}
          >
            PDF
          </button>
        )}
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div className="p-4">
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
