import { useState, useEffect } from 'react';
import { Book, ChevronDown, ChevronRight, ExternalLink, X, GripVertical, GitBranch, Trash2, BookOpen } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useAppStore, type NormaBlock } from '../../../store/useAppStore';
import { ArticleTabContent } from '../search/ArticleTabContent';
import { ArticleNavigation } from './ArticleNavigation';
import { TreeViewPanel } from '../search/TreeViewPanel';
import { StudyMode } from './StudyMode';
import { cn } from '../../../lib/utils';
import { extractArticleIdsFromTree, normalizeArticleId } from '../../../utils/treeUtils';
import type { ArticleData } from '../../../types';

interface NormaBlockComponentProps {
  tabId: string;
  normaBlock: NormaBlock;
  onViewPdf: (urn: string) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
  onExtractArticle: (articleId: string) => void;
  onRemoveArticle: (articleId: string) => void;
  onRemoveNorma?: () => void;
}

export function NormaBlockComponent({
  tabId,
  normaBlock,
  onViewPdf,
  onCrossReference,
  onExtractArticle,
  onRemoveArticle,
  onRemoveNorma
}: NormaBlockComponentProps) {
  const [activeArticleId, setActiveArticleId] = useState<string | null>(
    normaBlock.articles[0]?.norma_data?.numero_articolo || null
  );
  const [treeVisible, setTreeVisible] = useState(false);
  const [treeData, setTreeData] = useState<any[] | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [studyModeOpen, setStudyModeOpen] = useState(false);

  const { toggleNormaCollapse, triggerSearch, addNormaToTab } = useAppStore();
  const [loadingArticle, setLoadingArticle] = useState<string | null>(null);

  const fetchTree = async () => {
    if (!normaBlock.norma.urn || treeData) return; // Don't refetch if already loaded
    try {
      setTreeLoading(true);
      const res = await fetch('/fetch_tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urn: normaBlock.norma.urn, link: false, details: true })
      });
      if (!res.ok) throw new Error('Impossibile caricare la struttura');
      const payload = await res.json();
      setTreeData(payload.articles || payload);
    } catch (e) {
      console.error('Error fetching tree:', e);
    } finally {
      setTreeLoading(false);
    }
  };

  // Auto-fetch tree structure when norma has URN
  useEffect(() => {
    if (normaBlock.norma.urn && !treeData && !treeLoading) {
      fetchTree();
    }
  }, [normaBlock.norma.urn]);

  // Make this norma draggable
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `norma-${normaBlock.id}`,
    data: {
      type: 'norma',
      itemId: normaBlock.id,
      sourceTabId: tabId,
    },
  });

  // Make this norma a drop target for loose articles
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `norma-drop-${normaBlock.id}`,
    data: {
      type: 'norma-drop-zone',
      normaId: normaBlock.id,
      tabId: tabId,
      norma: normaBlock.norma, // For compatibility check
    },
  });

  // Combine refs for both draggable and droppable
  const setNodeRef = (node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  const activeArticle = normaBlock.articles.find(
    a => a.norma_data.numero_articolo === activeArticleId
  );

  // Loaded article IDs
  const loadedArticleIds = normaBlock.articles.map(a => a.norma_data.numero_articolo);

  // Normalized set for faster lookups (handles "3 bis" vs "3-bis" differences)
  const loadedArticleIdsNormalized = new Set(loadedArticleIds.map(normalizeArticleId));

  // Helper to check if an article is loaded (handles format differences)
  const isArticleLoaded = (articleId: string) => loadedArticleIdsNormalized.has(normalizeArticleId(articleId));

  // All article IDs from structure (if available)
  const allArticleIds = treeData ? extractArticleIdsFromTree(treeData) : undefined;

  // Function to load a new article directly into this tab
  const handleLoadArticle = async (articleNumber: string) => {
    // Don't load if already loading or already loaded
    if (loadingArticle) return;
    if (isArticleLoaded(articleNumber)) {
      // Find the actual ID in loadedArticleIds (might have different format)
      const actualId = loadedArticleIds.find(id => normalizeArticleId(id) === normalizeArticleId(articleNumber));
      setActiveArticleId(actualId || articleNumber);
      return;
    }

    setLoadingArticle(articleNumber);

    try {
      const response = await fetch('/fetch_all_data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          act_type: normaBlock.norma.tipo_atto,
          act_number: normaBlock.norma.numero_atto || '',
          date: normaBlock.norma.data || '',
          article: articleNumber,
          version: 'vigente',
          version_date: '',
          show_brocardi_info: true
        })
      });

      if (!response.ok) throw new Error('Errore nel caricamento');

      const data = await response.json();
      const articles = Array.isArray(data) ? data : [data];

      // Filter out any errors
      const validArticles = articles.filter((a: any) => !a.error && a.norma_data);

      if (validArticles.length > 0) {
        // Add to current tab's norma block
        addNormaToTab(tabId, normaBlock.norma, validArticles);
        // Set active to the newly loaded article using the actual ID from response
        const loadedArticleId = validArticles[0].norma_data?.numero_articolo;
        setActiveArticleId(loadedArticleId || articleNumber);
      }
    } catch (e) {
      console.error('Error loading article:', e);
    } finally {
      setLoadingArticle(null);
    }
  };

  // Function to navigate to a loaded article or load it if not present
  const handleArticleSelect = (articleNumber: string) => {
    if (isArticleLoaded(articleNumber)) {
      // Find the actual ID in loadedArticleIds (might have different format)
      const actualId = loadedArticleIds.find(id => normalizeArticleId(id) === normalizeArticleId(articleNumber));
      setActiveArticleId(actualId || articleNumber);
    } else {
      handleLoadArticle(articleNumber);
    }
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "bg-white dark:bg-gray-800 rounded-xl border-2 overflow-hidden transition-all shadow-sm hover:shadow-md",
        isDragging && "opacity-50 scale-95",
        isOver
          ? "border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800 bg-blue-50/50 dark:bg-blue-900/20"
          : "border-gray-200 dark:border-gray-700"
      )}
    >
      {/* Norma Header */}
      <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-blue-50/50 dark:from-blue-900/20 dark:to-blue-900/10 border-b border-blue-200 dark:border-blue-800">
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

          {/* Delete button with confirmation */}
          {onRemoveNorma && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm('Eliminare questa norma e tutti i suoi articoli?')) {
                  onRemoveNorma();
                }
              }}
              className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
              title="Elimina norma"
            >
              <Trash2 size={14} className="text-red-500" />
            </button>
          )}

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

        {!normaBlock.isCollapsed && (
          <div className="flex items-center gap-2">
            {/* Study Mode Button */}
            <button
              className="px-2 py-1 text-xs font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 dark:text-purple-400 dark:bg-purple-900/20 rounded transition-colors flex items-center gap-1"
              onClick={(e) => {
                e.stopPropagation();
                setStudyModeOpen(true);
              }}
              title="Modalità studio"
            >
              <BookOpen size={12} />
              Studio
            </button>
            {normaBlock.norma.urn && (
              <button
                className="px-2 py-1 text-xs font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/20 rounded transition-colors flex items-center gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  setTreeVisible(!treeVisible);
                  if (!treeData) {
                    fetchTree();
                  }
                }}
              >
                <GitBranch size={12} />
                {treeLoading ? 'Carico...' : 'Struttura'}
              </button>
            )}
            {normaBlock.norma.urn && (
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
        )}
      </div>

      {/* Tree View Side Panel */}
      <TreeViewPanel
        isOpen={treeVisible}
        onClose={() => setTreeVisible(false)}
        treeData={treeData || []}
        urn={normaBlock.norma.urn || ''}
        title="Struttura Atto"
        loadedArticles={loadedArticleIds}
        onArticleSelect={(articleNumber) => {
          handleLoadArticle(articleNumber);
          setTreeVisible(false);
        }}
      />

      {/* Articles */}
      {!normaBlock.isCollapsed && (
        <div className="bg-gray-50/50 dark:bg-gray-900/50">
          {/* Navigation bar - show when structure available OR multiple articles loaded */}
          {((allArticleIds && allArticleIds.length > 1) || normaBlock.articles.length > 1) && (
            <div className="px-3 pt-2 flex items-center justify-end">
              <ArticleNavigation
                allArticleIds={allArticleIds}
                loadedArticleIds={loadedArticleIds}
                activeArticleId={activeArticleId}
                onNavigate={setActiveArticleId}
                onLoadArticle={handleLoadArticle}
              />
            </div>
          )}

          {/* Article tabs */}
          <div className="px-3 pt-3 border-b border-gray-200 dark:border-gray-700 flex gap-2 overflow-x-auto no-scrollbar">
            {normaBlock.articles.map((article) => {
              const id = article.norma_data.numero_articolo;
              const isActive = id === activeArticleId;

              return (
                <div
                  key={id}
                  className={cn(
                    "group flex items-center gap-1 px-2 py-1.5 rounded-t-lg text-xs font-medium cursor-pointer transition-all whitespace-nowrap",
                    isActive
                      ? "bg-white dark:bg-gray-800 border border-b-0 border-gray-200 dark:border-gray-700 text-blue-600 dark:text-blue-400 relative -bottom-px z-10"
                      : "bg-gray-100 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700/50"
                  )}
                  onClick={() => setActiveArticleId(id)}
                >
                  <span>Art. {id}</span>
                  {isActive && (
                    <div className="flex items-center gap-0.5 ml-1">
                      <button
                        className="p-0.5 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
                        onClick={(e) => {
                          e.stopPropagation();
                          onExtractArticle(id);
                        }}
                        title="Estrai come articolo loose"
                      >
                        <ExternalLink size={10} />
                      </button>
                      <button
                        className="p-0.5 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveArticle(id);
                        }}
                        title="Chiudi articolo"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  )}
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

      {/* Study Mode Overlay */}
      <StudyMode
        isOpen={studyModeOpen}
        onClose={() => setStudyModeOpen(false)}
        article={activeArticle || normaBlock.articles[0]}
        articles={normaBlock.articles}
        onNavigate={(articleId) => setActiveArticleId(articleId)}
        onCrossReferenceNavigate={onCrossReference}
        normaLabel={`${normaBlock.norma.tipo_atto}${normaBlock.norma.numero_atto ? ` n. ${normaBlock.norma.numero_atto}` : ''}`}
        allArticleIds={allArticleIds}
        onLoadArticle={handleLoadArticle}
      />
    </div>
  );
}
