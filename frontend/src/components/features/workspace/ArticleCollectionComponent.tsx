import { useState, useRef, useEffect } from 'react';
import { Folder, ChevronDown, ChevronRight, X, GripVertical, Pencil, Check } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useAppStore, type ArticleCollection } from '../../../store/useAppStore';
import { ArticleTabContent } from '../search/ArticleTabContent';
import { ArticleNavigation } from './ArticleNavigation';
import { ArticleMinimap } from './ArticleMinimap';
import { StudyMode } from './StudyMode';
import { cn } from '../../../lib/utils';
import type { ArticleData } from '../../../types';

interface ArticleCollectionComponentProps {
  tabId: string;
  collection: ArticleCollection;
  onViewPdf: (urn: string) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
}

export function ArticleCollectionComponent({
  tabId,
  collection,
  onCrossReference
}: ArticleCollectionComponentProps) {
  const [activeArticleIndex, setActiveArticleIndex] = useState<number>(0);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [editedLabel, setEditedLabel] = useState(collection.label);
  const labelInputRef = useRef<HTMLInputElement>(null);

  // Study Mode state
  const [studyModeOpen, setStudyModeOpen] = useState(false);
  const [studyModeArticle, setStudyModeArticle] = useState<ArticleData | null>(null);

  const { toggleCollectionCollapse, renameCollection, removeArticleFromCollection } = useAppStore();

  const openStudyMode = (article: ArticleData) => {
    setStudyModeArticle(article);
    setStudyModeOpen(true);
  };

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingLabel && labelInputRef.current) {
      labelInputRef.current.focus();
      labelInputRef.current.select();
    }
  }, [isEditingLabel]);

  // Make this collection draggable
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `collection-${collection.id}`,
    data: {
      type: 'collection',
      itemId: collection.id,
      sourceTabId: tabId,
    },
  });

  // Make this collection a drop target for loose articles
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `collection-drop-${collection.id}`,
    data: {
      type: 'collection-drop-zone',
      collectionId: collection.id,
      tabId: tabId,
    },
  });

  // Combine refs
  const setNodeRef = (node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  const activeArticle = collection.articles[activeArticleIndex];

  const handleSaveLabel = () => {
    if (editedLabel.trim()) {
      renameCollection(tabId, collection.id, editedLabel.trim());
    } else {
      setEditedLabel(collection.label);
    }
    setIsEditingLabel(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveLabel();
    } else if (e.key === 'Escape') {
      setEditedLabel(collection.label);
      setIsEditingLabel(false);
    }
  };

  const getArticleKey = (item: typeof collection.articles[0]) => {
    return `${item.sourceNorma.tipo_atto}-${item.sourceNorma.numero_atto}-${item.article.norma_data.numero_articolo}`;
  };

  const handleRemoveArticle = (index: number) => {
    const item = collection.articles[index];
    const key = getArticleKey(item);
    removeArticleFromCollection(tabId, collection.id, key);

    // Adjust active index if needed
    if (activeArticleIndex >= collection.articles.length - 1) {
      setActiveArticleIndex(Math.max(0, collection.articles.length - 2));
    }
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "bg-white dark:bg-slate-800 rounded-xl border overflow-hidden transition-all shadow-sm hover:shadow-md",
        isDragging && "opacity-50 scale-95",
        isOver
          ? "border-purple-500 ring-2 ring-purple-200 dark:ring-purple-900 bg-purple-50/50 dark:bg-purple-900/20"
          : "border-purple-300 dark:border-purple-800"
      )}
    >
      {/* Collection Header */}
      <div className="flex items-center justify-between p-3 sm:p-4 bg-gradient-to-r from-purple-50 to-white dark:from-purple-950/40 dark:to-slate-900/40 border-b border-purple-200 dark:border-purple-900/50">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Drag handle */}
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing p-1 hover:bg-purple-100 dark:hover:bg-purple-900/30 rounded transition-colors"
            title="Trascina raccolta"
          >
            <GripVertical size={16} className="text-purple-400" />
          </div>

          <div
            className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
            onClick={() => toggleCollectionCollapse(tabId, collection.id)}
          >
            {collection.isCollapsed ? (
              <ChevronRight size={16} className="text-purple-400 shrink-0" />
            ) : (
              <ChevronDown size={16} className="text-purple-400 shrink-0" />
            )}

            <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-800/50 flex items-center justify-center shadow-sm shrink-0">
              <Folder size={16} className="text-purple-600 dark:text-purple-400" />
            </div>

            <div className="flex-1 min-w-0">
              {isEditingLabel ? (
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={labelInputRef}
                    type="text"
                    value={editedLabel}
                    onChange={(e) => setEditedLabel(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleSaveLabel}
                    className="w-full px-2 py-1 text-sm font-semibold bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <button
                    onClick={handleSaveLabel}
                    className="p-1 hover:bg-purple-100 dark:hover:bg-purple-900 rounded"
                  >
                    <Check size={14} className="text-purple-600" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 group">
                  <h4 className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                    {collection.label}
                  </h4>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsEditingLabel(true);
                    }}
                    className="p-1 opacity-0 group-hover:opacity-100 hover:bg-purple-100 dark:hover:bg-purple-900/30 rounded transition-opacity"
                    title="Rinomina raccolta"
                  >
                    <Pencil size={12} className="text-purple-500" />
                  </button>
                </div>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {collection.articles.length} {collection.articles.length === 1 ? 'articolo' : 'articoli'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Articles */}
      {!collection.isCollapsed && collection.articles.length > 0 && (
        <div className="bg-slate-50/50 dark:bg-slate-900/50">
          {/* Navigation bar */}
          {collection.articles.length > 1 && (
            <div className="px-3 pt-2 flex items-center justify-between">
              <ArticleNavigation
                loadedArticleIds={collection.articles.map((_, i) => i.toString())}
                activeArticleId={activeArticleIndex.toString()}
                onNavigate={(id) => setActiveArticleIndex(parseInt(id))}
              />
              <ArticleMinimap
                loadedArticleIds={collection.articles.map((_, i) => i.toString())}
                activeArticleId={activeArticleIndex.toString()}
                onArticleClick={(id) => setActiveArticleIndex(parseInt(id))}
                className="max-w-[200px]"
              />
            </div>
          )}

          {/* Article tabs */}
          <div className="px-3 pt-3 border-b border-slate-200 dark:border-slate-700 flex gap-2 overflow-x-auto custom-scrollbar">
            {collection.articles.map((item, index) => {
              const isActive = index === activeArticleIndex;
              const { article, sourceNorma } = item;

              return (
                <div
                  key={getArticleKey(item)}
                  className={cn(
                    "group flex items-center gap-2 px-3 py-2 rounded-t-lg text-xs font-semibold border-t border-x border-b-0 cursor-pointer transition-all min-w-[140px] justify-between",
                    isActive
                      ? "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-purple-600 dark:text-purple-400 relative -bottom-px z-10"
                      : "bg-slate-100 dark:bg-slate-800/50 border-transparent text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700/50"
                  )}
                  onClick={() => setActiveArticleIndex(index)}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="truncate">Art. {article.norma_data.numero_articolo}</span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate max-w-[100px]">
                      {sourceNorma.tipo_atto} {sourceNorma.numero_atto}
                    </span>
                  </div>
                  <button
                    className={cn(
                      "p-1 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-opacity shrink-0",
                      isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveArticle(index);
                    }}
                    title="Rimuovi dalla raccolta"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Active article content */}
          <div className="p-4 sm:p-5 bg-white dark:bg-slate-800 min-h-[200px]">
            {activeArticle ? (
              <ArticleTabContent
                key={getArticleKey(activeArticle)}
                data={activeArticle.article}
                onCrossReferenceNavigate={onCrossReference}
                onOpenStudyMode={() => openStudyMode(activeArticle.article)}
              />
            ) : (
              <div className="flex items-center justify-center h-40 text-slate-400">
                <p className="text-sm">Nessun articolo nella raccolta</p>
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

      {/* Empty state */}
      {!collection.isCollapsed && collection.articles.length === 0 && (
        <div className="p-8 text-center text-slate-400 dark:text-slate-500">
          <Folder size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">Trascina articoli qui per aggiungerli alla raccolta</p>
        </div>
      )}
    </div>
  );
}
