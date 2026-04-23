import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Book, ChevronDown, ChevronRight, ExternalLink, X, GripVertical, GitBranch, Trash2, BookOpen, Loader2 } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useAppStore, type NormaBlock } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { ArticleTabContent } from '../search/ArticleTabContent';
import { ArticleNavigation } from './ArticleNavigation';
import { TreeViewPanel } from '../search/TreeViewPanel';
import { AnnexSuggestion } from '../search/AnnexSuggestion';
import { StudyMode } from './StudyMode';
import { cn } from '../../../lib/utils';
import type { ArticleData } from '../../../types';
import { useTour } from '../../../hooks/useTour';
import { useAnnexNavigation } from '../../../hooks/useAnnexNavigation';
import { formatDateItalianLong, abbreviateActType } from '../../../utils/dateUtils';
import { getUniqueArticleId, filterLoadedIdsForAnnex, findArticleByNormalizedId } from '../../../utils/articleIds';

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
  const { toggleNormaCollapse, settings, consumeAutoFocusArticle } = useAppStore(useShallow(s => ({
    toggleNormaCollapse: s.toggleNormaCollapse,
    settings: s.settings,
    consumeAutoFocusArticle: s.consumeAutoFocusArticle,
  })));
  const [studyModeOpen, setStudyModeOpen] = useState(false);

  const [activeArticleId, setActiveArticleId] = useState<string | null>(
    normaBlock.articles[0] ? getUniqueArticleId(normaBlock.articles[0]) : null
  );

  // Articles the user has actually opened in this block. Every chip that
  // arrives via streaming but has never been focused stays visually marked
  // as "non visualizzato" until clicked. Maintained together with
  // activeArticleId via focusArticle() so no effect is needed.
  const [viewedArticleIds, setViewedArticleIds] = useState<Set<string>>(() => {
    const first = normaBlock.articles[0] ? getUniqueArticleId(normaBlock.articles[0]) : null;
    return new Set(first ? [first] : []);
  });

  // Single entry point for changing the focused article: updates active +
  // viewed atomically so we never drift. The incoming uniqueId may be
  // non-canonical (e.g. "1-bis" from the tree while the article stores
  // "1 bis"); we canonicalize against the loaded list before writing to
  // state so that viewedArticleIds and the chip comparisons line up.
  const focusArticle = useCallback((uniqueId: string) => {
    const match = findArticleByNormalizedId(normaBlock.articles, uniqueId);
    const canonical = match ? getUniqueArticleId(match) : uniqueId;
    setActiveArticleId(canonical);
    setViewedArticleIds(prev => prev.has(canonical) ? prev : new Set(prev).add(canonical));
  }, [normaBlock.articles]);

  // R1 (streaming-ux): don't steal focus when new articles stream in.
  // Resolve the active article tolerantly (see focusArticle for why), then
  // fall back to the first loaded article when the stored id is stale or
  // null. effectiveActiveId exposes the canonical uniqueId so strict ===
  // comparisons below align. Explicit focus changes come through R2.
  const resolvedActive = activeArticleId
    ? findArticleByNormalizedId(normaBlock.articles, activeArticleId)
    : undefined;
  const effectiveActiveId = resolvedActive
    ? getUniqueArticleId(resolvedActive)
    : normaBlock.articles[0]
      ? getUniqueArticleId(normaBlock.articles[0])
      : null;

  // R2 (streaming-ux): consume one-shot focus signal from the store. Used
  // when a single-article search merges into this block — we deliberately
  // DO jump focus because that's what the user just asked for.
  // Effect is required here because consumeAutoFocusArticle mutates external
  // store state, which cannot happen during render.
  useEffect(() => {
    const target = normaBlock.autoFocusArticleId;
    if (!target) return;

    const exists = normaBlock.articles.some(a => getUniqueArticleId(a) === target);
    if (exists) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot sync with external store signal
      focusArticle(target);
    }
    consumeAutoFocusArticle(tabId, normaBlock.id);
  }, [normaBlock.autoFocusArticleId, normaBlock.articles, normaBlock.id, tabId, consumeAutoFocusArticle, focusArticle]);

  // Active article: resolved tolerantly above, with fallback to first loaded.
  const activeArticle = resolvedActive ?? normaBlock.articles[0];

  // Stable local reference so TypeScript can narrow the value inside the
  // button onClick closures below, and so the JSX reads cleaner.
  const normaUrn = normaBlock.norma.urn;

  // Use the shared annex navigation hook - pass activeArticle for correct annex detection
  const {
    treeData,
    treeMetadata,
    treeLoading,
    treeVisible,
    setTreeVisible,
    currentAnnex,
    allArticleIds,
    loadingArticle,
    fetchTree,
    handleAnnexSelect,
    handleLoadArticle,
    isArticleLoaded,
    loadedArticleIds
  } = useAnnexNavigation({
    norma: normaBlock.norma,
    articles: normaBlock.articles,
    tabId, // Enable direct article loading into this tab
    activeArticle
  });

  // Trigger NormaBlock tour on first render
  const { tryStartTour } = useTour({ theme: settings.theme as 'light' | 'dark' });
  useEffect(() => {
    tryStartTour('normaBlock');
  }, [tryStartTour]);

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

  // Wraps handleLoadArticle to also navigate to the active article unique ID
  // targetAnnex: if provided, use it (null = dispositivo); if undefined, use currentAnnex
  const handleLoadArticleWithNavigation = (articleNumber: string, targetAnnex?: string | null) => {
    // Determine which annex context to use
    const annexContext = targetAnnex !== undefined ? targetAnnex : currentAnnex;
    // Construct unique ID based on annex context
    const constructUniqueId = (num: string) => annexContext ? `all${annexContext}:${num}` : num;

    const uniqueIdToCheck = constructUniqueId(articleNumber);
    if (isArticleLoaded(uniqueIdToCheck)) {
      // Already loaded - just navigate to it
      focusArticle(uniqueIdToCheck);
      return;
    }
    // Load the article via the hook, passing the target annex
    handleLoadArticle(articleNumber, targetAnnex);
    // Note: The hook loading is async. We rely on the user clicking again or effect logic if auto-switch is needed.
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "bg-white dark:bg-slate-800 rounded-xl border overflow-hidden transition-all shadow-sm hover:shadow-md",
        isDragging && "opacity-50 scale-95",
        isOver
          ? "border-primary-500 ring-2 ring-primary-200 dark:ring-primary-900 bg-primary-50/50 dark:bg-primary-900/20"
          : "border-slate-200 dark:border-slate-700"
      )}
    >
      {/* Norma Header */}
      <div className="norma-block-header flex items-center justify-between p-3 sm:p-4 bg-gradient-to-r from-primary-50 to-white dark:from-primary-950/40 dark:to-slate-900/40">
        <div className="flex items-center gap-2 min-w-0">
          {/* Drag handle */}
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
            title="Trascina norma"
          >
            <GripVertical size={16} className="text-slate-400" />
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
              <Trash2 size={14} className="text-red-500 opacity-70 hover:opacity-100" />
            </button>
          )}

          <div
            className="flex items-center gap-3 cursor-pointer flex-1 min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            role="button"
            tabIndex={0}
            aria-expanded={!normaBlock.isCollapsed}
            aria-label={`${normaBlock.norma.tipo_atto}${normaBlock.norma.numero_atto ? ` n. ${normaBlock.norma.numero_atto}` : ''} — ${normaBlock.isCollapsed ? 'espandi' : 'comprimi'}`}
            onClick={() => toggleNormaCollapse(tabId, normaBlock.id)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleNormaCollapse(tabId, normaBlock.id);
              }
            }}
          >
            {normaBlock.isCollapsed ? (
              <ChevronRight size={16} className="text-primary-400 shrink-0" />
            ) : (
              <ChevronDown size={16} className="text-primary-400 shrink-0" />
            )}

            <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 border border-primary-200 dark:border-primary-800/50 flex items-center justify-center shadow-sm shrink-0">
              <Book size={16} className="text-primary-600 dark:text-primary-400" />
            </div>

            <div className="min-w-0">
              <h4 className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                {normaBlock.norma.tipo_atto}
                {/* Show number only if NOT an alias (no tipo_atto_reale) */}
                {!normaBlock.norma.tipo_atto_reale && normaBlock.norma.numero_atto && ` n. ${normaBlock.norma.numero_atto}`}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {normaBlock.norma.tipo_atto_reale ? (
                  // For aliases: show real type abbreviation + date + number
                  <>
                    {abbreviateActType(normaBlock.norma.tipo_atto_reale)}
                    {normaBlock.norma.data && ` ${formatDateItalianLong(normaBlock.norma.data)}`}
                    {normaBlock.norma.numero_atto && `, n. ${normaBlock.norma.numero_atto}`}
                    {` · ${normaBlock.articles.length} articoli`}
                  </>
                ) : (
                  // For regular norms: just date + count
                  <>
                    {normaBlock.norma.data ? formatDateItalianLong(normaBlock.norma.data) : 'Estremi non disponibili'} · {normaBlock.articles.length} articoli
                  </>
                )}
              </p>
            </div>
          </div>
        </div>

        {!normaBlock.isCollapsed && (
          <div className="flex items-center gap-2 ml-4 shrink-0">
            {/* Study Mode Button - Visible on all screen sizes */}
            <button
              className="flex norma-study-mode-btn px-2 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 active:bg-purple-200 dark:text-purple-400 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/30 rounded-lg transition-colors items-center gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                setStudyModeOpen(true);
              }}
              title="Modalità studio"
            >
              <BookOpen size={12} />
              <span className="hidden sm:inline">Studio</span>
            </button>
            {normaUrn && (
              <button
                className="norma-structure-btn px-2 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30 rounded-lg transition-colors flex items-center gap-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                  setTreeVisible(!treeVisible);
                  if (!treeData) {
                    fetchTree();
                  }
                }}
              >
                <GitBranch size={12} />
                <span className="hidden sm:inline">{treeLoading ? 'Carico…' : 'Struttura'}</span>
              </button>
            )}
            {normaUrn && (
              <button
                className="px-2 py-1.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-50 dark:text-slate-300 dark:bg-slate-700 hover:text-red-600 dark:hover:text-red-400 border border-slate-200 dark:border-slate-600 rounded-lg transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewPdf(normaUrn);
                }}
              >
                PDF
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tree View Side Panel - Now includes annex selection */}
      <TreeViewPanel
        isOpen={treeVisible}
        onClose={() => setTreeVisible(false)}
        treeData={treeData || []}
        urn={normaUrn || ''}
        title="Struttura Atto"
        loadedArticles={loadedArticleIds}
        onArticleSelect={(articleNumber, targetAnnex) => {
          handleLoadArticleWithNavigation(articleNumber, targetAnnex);
          setTreeVisible(false);
        }}
        annexes={treeMetadata?.annexes}
        currentAnnex={currentAnnex}
      />

      {/* Articles */}
      {!normaBlock.isCollapsed && (
        <div className="bg-slate-50 dark:bg-slate-900">
          {/* Annex suggestion - show when article exists in other annexes */}
          {treeMetadata?.annexes && treeMetadata.annexes.length > 1 && activeArticle && (
            <div className="px-3 pt-3">
              <AnnexSuggestion
                articleNumber={activeArticle.norma_data.numero_articolo}
                currentAnnex={activeArticle.norma_data.allegato || null}
                annexes={treeMetadata.annexes}
                onSwitchAnnex={async (annexNumber): Promise<string | null> => {
                  const articleId = await handleAnnexSelect(annexNumber);
                  if (articleId) {
                    const uniqueId = annexNumber ? `all${annexNumber}:${articleId}` : articleId;
                    focusArticle(uniqueId);
                  }
                  return articleId;
                }}
              />
            </div>
          )}

          {/* Top bar above the tab chip row — holds the article navigation
              counter on the right and (when active) the loading chip on
              the left. Shown whenever either needs to appear, so the chip
              never lands among the tabs and never gets covered. */}
          {(((allArticleIds && allArticleIds.length > 1) || normaBlock.articles.length > 1) || loadingArticle) && (
            <div className="hidden md:flex px-3 pt-2 items-center gap-3 min-h-[28px]">
              <AnimatePresence>
                {loadingArticle && (
                  <motion.div
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -4 }}
                    transition={{ duration: 0.18 }}
                    className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/95 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm pointer-events-none"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader2 size={12} className="text-primary-600 dark:text-primary-400 animate-spin" />
                    <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                      Caricamento…
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="flex-1" />
              {((allArticleIds && allArticleIds.length > 1) || normaBlock.articles.length > 1) && (
                <ArticleNavigation
                  allArticleIds={allArticleIds}
                  loadedArticleIds={filterLoadedIdsForAnnex(loadedArticleIds, currentAnnex)}
                  activeArticleId={activeArticle?.norma_data.numero_articolo || null}
                  loadingArticleId={loadingArticle}
                  onNavigate={(number) => {
                    const uniqueId = currentAnnex ? `all${currentAnnex}:${number}` : number;
                    focusArticle(uniqueId);
                  }}
                  onLoadArticle={handleLoadArticleWithNavigation}
                />
              )}
            </div>
          )}

          <div className="md:hidden bg-white dark:bg-slate-800 divide-y divide-slate-100 dark:divide-slate-700">
            {normaBlock.articles.map((article, idx) => {
              const uniqueId = getUniqueArticleId(article);
              return (
                <div key={uniqueId || `idx-${idx}`} className="p-4">
                  {/* Article header with close button */}
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-bold text-slate-900 dark:text-white">
                      Art. {article.norma_data.numero_articolo}
                      {article.norma_data.allegato && (
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          (Allegato {article.norma_data.allegato})
                        </span>
                      )}
                    </h4>
                    <button
                      onClick={() => onRemoveArticle(uniqueId)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition-colors"
                      title="Chiudi articolo"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <ArticleTabContent
                    data={article}
                    onCrossReferenceNavigate={onCrossReference}
                    onOpenStudyMode={() => setStudyModeOpen(true)}
                  />
                </div>
              );
            })}
          </div>

          <div className="norma-article-tabs hidden md:flex relative z-30 px-3 pt-3 gap-2 overflow-x-auto overflow-y-hidden custom-scrollbar items-end">
            {normaBlock.articles.map((article, idx) => {
              const uniqueId = getUniqueArticleId(article);
              const isActive = uniqueId === effectiveActiveId;
              const isUnread = !isActive && !viewedArticleIds.has(uniqueId);

              return (
                <div
                  key={uniqueId || `idx-${idx}`}
                  className={cn(
                    "group flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-semibold cursor-pointer transition-all whitespace-nowrap border-t border-x",
                    isActive
                      ? "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 border-b-0 text-primary-600 dark:text-primary-400 relative -bottom-px z-10"
                      : "bg-slate-100 dark:bg-slate-800/50 border-transparent text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700/50"
                  )}
                  onClick={() => focusArticle(uniqueId)}
                  aria-label={isUnread ? `Art. ${article.norma_data.numero_articolo} (non visualizzato)` : undefined}
                >
                  {isUnread && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-primary-500 dark:bg-primary-400 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  <div className="flex flex-col items-start leading-tight">
                    <span>Art. {article.norma_data.numero_articolo}</span>
                    {article.norma_data.allegato && (
                      <span className="text-[9px] opacity-60">All. {article.norma_data.allegato}</span>
                    )}
                  </div>
                  {isActive && (
                    <div className="flex items-center gap-0.5 ml-1">
                      <button
                        className="p-0.5 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          onExtractArticle(uniqueId);
                        }}
                        title="Estrai come articolo loose"
                      >
                        <ExternalLink size={10} />
                      </button>
                      <button
                        className="p-0.5 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveArticle(uniqueId);
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

          <div className="hidden md:block bg-white dark:bg-slate-800 min-h-[250px] overflow-hidden relative">
            <AnimatePresence mode="wait" initial={false}>
              {activeArticle && (
                <motion.div
                  key={effectiveActiveId || 'empty'}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12, ease: 'easeOut' }}
                  className="p-5"
                >
                  <ArticleTabContent
                    data={activeArticle}
                    onCrossReferenceNavigate={onCrossReference}
                    onOpenStudyMode={() => setStudyModeOpen(true)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
            {!activeArticle && !loadingArticle && (
              <div className="flex items-center justify-center h-40 text-slate-400">
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
        onNavigate={(articleId) => focusArticle(articleId)}
        onCrossReferenceNavigate={onCrossReference}
        normaLabel={`${normaBlock.norma.tipo_atto}${normaBlock.norma.numero_atto ? ` n. ${normaBlock.norma.numero_atto}` : ''}`}
        allArticleIds={allArticleIds}
        onLoadArticle={handleLoadArticleWithNavigation}
      />
    </div>
  );
}
