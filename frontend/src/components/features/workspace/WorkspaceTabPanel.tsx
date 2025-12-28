import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, useMotionValue, useDragControls } from 'framer-motion';
import type { PanInfo } from 'framer-motion';
import { X, Edit2, FolderPlus, Check, Plus, FileText } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { useAppStore, appStore, type WorkspaceTab } from '../../../store/useAppStore';
import { NormaBlockComponent } from './NormaBlockComponent';
import { LooseArticleCard } from './LooseArticleCard';
import { ArticleCollectionComponent } from './ArticleCollectionComponent';
import { cn } from '../../../lib/utils';
import type { ArticleData } from '../../../types';
import { useTour } from '../../../hooks/useTour';
import { useCompare } from '../../../hooks/useCompare';
import { Z_INDEX_VALUES } from '../../../constants/zIndex';

interface WorkspaceTabPanelProps {
  tab: WorkspaceTab;
  onViewPdf: (urn: string) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
}

export function WorkspaceTabPanel({
  tab,
  onViewPdf,
  onCrossReference
}: WorkspaceTabPanelProps) {
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelInput, setLabelInput] = useState(tab.label);
  const [showDossierMenu, setShowDossierMenu] = useState(false);
  const [newDossierName, setNewDossierName] = useState('');
  const [isCreatingDossier, setIsCreatingDossier] = useState(false);
  const dossierMenuRef = useRef<HTMLDivElement>(null);

  const {
    updateTab,
    removeTab,
    bringTabToFront,
    toggleTabPin,
    toggleTabMinimize,
    setTabLabel,
    extractArticleFromNorma,
    removeArticleFromNorma,
    removeContentFromTab,
    dossiers,
    addToDossier,
    createDossier,
    settings,
    commandPaletteOpen,
  } = useAppStore();

  // Check if overlays are open that should hide workspace tabs
  const { isOpen: isCompareOpen } = useCompare();
  const shouldHide = isCompareOpen || commandPaletteOpen;

  // Trigger workspace tab tour on first tab render
  const { tryStartTour } = useTour({ theme: settings.theme as 'light' | 'dark' });
  useEffect(() => {
    tryStartTour('workspaceTab');
  }, [tryStartTour]);

  // Close dossier menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dossierMenuRef.current && !dossierMenuRef.current.contains(e.target as Node)) {
        setShowDossierMenu(false);
        setIsCreatingDossier(false);
        setNewDossierName('');
      }
    };
    if (showDossierMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDossierMenu]);

  // Add all articles from tab to a dossier
  const handleAddToDossier = (dossierId: string) => {
    tab.content.forEach(item => {
      if (item.type === 'norma') {
        // Add each article from the norma block
        item.articles.forEach(article => {
          const normaData = {
            tipo_atto: item.norma.tipo_atto,
            numero_atto: item.norma.numero_atto,
            data: item.norma.data,
            numero_articolo: article.norma_data.numero_articolo,
            urn: item.norma.urn
          };
          addToDossier(dossierId, normaData, 'norma');
        });
      } else if (item.type === 'loose-article') {
        const normaData = {
          tipo_atto: item.sourceNorma.tipo_atto,
          numero_atto: item.sourceNorma.numero_atto,
          data: item.sourceNorma.data,
          numero_articolo: item.article.norma_data.numero_articolo,
          urn: item.sourceNorma.urn
        };
        addToDossier(dossierId, normaData, 'norma');
      } else if (item.type === 'collection') {
        // Add each article from the collection
        item.articles.forEach(({ article, sourceNorma }) => {
          const normaData = {
            tipo_atto: sourceNorma.tipo_atto,
            numero_atto: sourceNorma.numero_atto,
            data: sourceNorma.data,
            numero_articolo: article.norma_data.numero_articolo,
            urn: sourceNorma.urn
          };
          addToDossier(dossierId, normaData, 'norma');
        });
      }
    });
    setShowDossierMenu(false);
  };

  // Create new dossier and add articles
  const handleCreateAndAdd = () => {
    if (!newDossierName.trim()) return;
    createDossier(newDossierName.trim());
    // Get the newly created dossier (it's the last one)
    setTimeout(() => {
      const state = appStore.getState();
      const newDossier = state.dossiers[state.dossiers.length - 1];
      if (newDossier) {
        handleAddToDossier(newDossier.id);
      }
    }, 0);
    setNewDossierName('');
    setIsCreatingDossier(false);
  };

  // Make this tab a drop zone
  const { setNodeRef, isOver } = useDroppable({
    id: tab.id,
  });

  // Drag controls for handle-based dragging
  const dragControls = useDragControls();

  // Motion values for physics-based dragging
  const x = useMotionValue(tab.position.x);
  const y = useMotionValue(tab.position.y);
  const width = useMotionValue(tab.size.width);
  const height = useMotionValue(tab.size.height);

  // Motion values for position (no spring - direct values)
  const springX = x;
  const springY = y;

  // Sync with store when tab position/size changes externally
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number; direction: string } | null>(null);

  // Track window size for drag constraints
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800
  });

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Very permissive drag constraints
  const tabWidth = tab.isMinimized ? 300 : tab.size.width;
  const minVisible = 50;

  const dragConstraints = useMemo(() => ({
    left: -(tabWidth - minVisible),
    top: 0,
    right: windowSize.width - minVisible,
    bottom: windowSize.height - minVisible
  }), [windowSize.width, windowSize.height, tabWidth]);

  useEffect(() => {
    if (!isDragging) {
      x.set(tab.position.x);
      y.set(tab.position.y);
    }
  }, [tab.position.x, tab.position.y, isDragging, x, y]);

  useEffect(() => {
    if (!isResizing) {
      width.set(tab.size.width);
      height.set(tab.size.height);
    }
  }, [tab.size.width, tab.size.height, isResizing, width, height]);

  const handleDragStart = useCallback(() => {
    setIsDragging(true);
    bringTabToFront(tab.id);
  }, [bringTabToFront, tab.id]);

  const handleDragEnd = useCallback((_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsDragging(false);

    const currentX = x.get();
    const currentY = y.get();

    // Apply momentum
    const momentumX = info.velocity.x * 0.1;
    const momentumY = info.velocity.y * 0.1;

    // Use dragConstraints limits
    const finalX = Math.max(dragConstraints.left, Math.min(dragConstraints.right, currentX + momentumX));
    const finalY = Math.max(dragConstraints.top, Math.min(dragConstraints.bottom, currentY + momentumY));

    x.set(finalX);
    y.set(finalY);

    updateTab(tab.id, { position: { x: finalX, y: finalY } });
  }, [tab.id, updateTab, x, y, dragConstraints]);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    bringTabToFront(tab.id);
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: width.get(),
      startH: height.get(),
      direction
    };
  }, [bringTabToFront, tab.id, width, height]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !resizeRef.current) return;

    const { startX, startY, startW, startH, direction } = resizeRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newW = startW;
    let newH = startH;
    let newX = x.get();
    let newY = y.get();

    if (direction.includes('right')) newW = Math.max(200, startW + dx);
    if (direction.includes('bottom')) newH = Math.max(100, startH + dy);
    if (direction.includes('left')) {
      const deltaW = Math.min(dx, startW - 200);
      newW = startW - deltaW;
      newX = tab.position.x + deltaW;
    }
    if (direction.includes('top')) {
      const deltaH = Math.min(dy, startH - 100);
      newH = startH - deltaH;
      newY = tab.position.y + deltaH;
    }

    width.set(newW);
    height.set(newH);
    if (direction.includes('left')) x.set(newX);
    if (direction.includes('top')) y.set(newY);
  }, [isResizing, x, y, width, height, tab.position.x, tab.position.y]);

  const handleResizeEnd = useCallback(() => {
    if (!isResizing) return;
    setIsResizing(false);

    updateTab(tab.id, {
      size: { width: width.get(), height: height.get() },
      position: { x: x.get(), y: y.get() }
    });
    resizeRef.current = null;
  }, [isResizing, tab.id, updateTab, width, height, x, y]);

  // Global mouse listeners for resize
  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleResizeMove);
      window.addEventListener('mouseup', handleResizeEnd);
      return () => {
        window.removeEventListener('mousemove', handleResizeMove);
        window.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  const handleMouseDown = () => {
    bringTabToFront(tab.id);
  };

  // When heavy overlays are open, hide the tab panels
  if (shouldHide) return null;

  // Clamp tab zIndex to stay below overlays (max 79, since dock is 80 and compare is 90)
  const effectiveZIndex = Math.min(tab.zIndex, Z_INDEX_VALUES.dock - 1);

  return (
    <motion.div
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0.1}
      dragConstraints={dragConstraints}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      style={{
        x: springX,
        y: springY,
        width: tab.isMinimized ? 300 : width,
        height: tab.isMinimized ? 44 : height,
        zIndex: effectiveZIndex
      }}
      className={cn(
        "fixed",
        tab.isPinned && "ring-2 ring-primary-500 rounded-2xl",
        isDragging && "cursor-grabbing"
      )}
      onMouseDown={handleMouseDown}
    >
      <div
        ref={setNodeRef}
        className={cn(
          // Liquid Glass container - Slate 800-900 based
          "workspace-tab-panel h-full flex flex-col rounded-2xl shadow-glass overflow-hidden",
          "bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl",
          "border transition-colors",
          isOver
            ? "border-primary-500 border-2 bg-primary-50/80 dark:bg-primary-950/80"
            : "border-slate-200/60 dark:border-slate-800"
        )}
      >
        {/* Header with macOS-style controls */}
        <div
          onPointerDown={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest('button') || target.closest('input')) return;
            dragControls.start(e);
          }}
          className="cursor-grab active:cursor-grabbing flex items-center justify-between px-4 py-3 bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-200/60 dark:border-slate-800 select-none touch-none"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* macOS traffic lights */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => removeTab(tab.id)}
                onPointerDown={(e) => e.stopPropagation()}
                className="w-3 h-3 bg-red-400 hover:bg-red-500 rounded-full transition-colors group/close flex items-center justify-center"
                title="Chiudi"
              >
                <X size={8} className="text-red-900 opacity-0 group-hover/close:opacity-100 transition-opacity" />
              </button>
              <button
                onClick={() => toggleTabMinimize(tab.id)}
                onPointerDown={(e) => e.stopPropagation()}
                className="w-3 h-3 bg-amber-400 hover:bg-amber-500 rounded-full transition-colors"
                title="Minimizza"
              />
              <button
                onClick={() => toggleTabPin(tab.id)}
                onPointerDown={(e) => e.stopPropagation()}
                className={cn(
                  "w-3 h-3 rounded-full transition-colors",
                  tab.isPinned ? "bg-primary-500 hover:bg-primary-600" : "bg-emerald-400 hover:bg-emerald-500"
                )}
                title={tab.isPinned ? "Rimuovi pin" : "Fissa"}
              />
            </div>

            <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />

            {isEditingLabel ? (
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onBlur={() => {
                  if (labelInput.trim()) {
                    setTabLabel(tab.id, labelInput.trim());
                  }
                  setIsEditingLabel(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (labelInput.trim()) {
                      setTabLabel(tab.id, labelInput.trim());
                    }
                    setIsEditingLabel(false);
                  }
                  if (e.key === 'Escape') {
                    setLabelInput(tab.label);
                    setIsEditingLabel(false);
                  }
                }}
                autoFocus
                className="flex-1 px-2 py-0.5 text-sm font-semibold bg-white dark:bg-slate-800 border border-primary-500 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-900 dark:text-white"
                placeholder="Nome tab"
              />
            ) : (
              <div
                className="flex items-center gap-2 flex-1 min-w-0 group"
                onDoubleClick={() => {
                  setLabelInput(tab.label);
                  setIsEditingLabel(true);
                }}
              >
                <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm truncate">
                  {tab.label}
                </h3>
                <button
                  onClick={() => {
                    setLabelInput(tab.label);
                    setIsEditingLabel(true);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-opacity"
                  title="Modifica nome"
                >
                  <Edit2 size={12} className="text-slate-500" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Add to Dossier button with dropdown */}
            <div className="relative" ref={dossierMenuRef} onPointerDown={(e) => e.stopPropagation()}>
              <button
                onClick={() => setShowDossierMenu(!showDossierMenu)}
                className={cn(
                  "p-1.5 rounded-lg transition-colors border border-transparent",
                  showDossierMenu
                    ? "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300 border-purple-200 dark:border-purple-800"
                    : "text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/30 dark:hover:border-purple-800/50"
                )}
                title="Aggiungi a dossier"
              >
                <FolderPlus size={16} />
              </button>

              {/* Dossier dropdown menu */}
              {showDossierMenu && (
                <div className="absolute right-0 top-full mt-2 w-60 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Aggiungi a Dossier
                    </span>
                  </div>

                  <div className="max-h-48 overflow-y-auto custom-scrollbar">
                    {dossiers.length === 0 && !isCreatingDossier ? (
                      <div className="px-3 py-4 text-center text-sm text-slate-500">
                        Nessun dossier disponibile
                      </div>
                    ) : (
                      dossiers.map(dossier => (
                        <button
                          key={dossier.id}
                          onClick={() => handleAddToDossier(dossier.id)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-purple-50 dark:hover:bg-purple-900/30 flex items-center gap-2 transition-colors border-b border-transparent hover:border-purple-100 dark:hover:border-purple-900/20"
                        >
                          <FolderPlus size={14} className="text-purple-500 shrink-0" />
                          <span className="truncate text-slate-700 dark:text-slate-300 flex-1">{dossier.title}</span>
                          <span className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">{dossier.items.length}</span>
                        </button>
                      ))
                    )}
                  </div>

                  {/* Create new dossier */}
                  <div className="border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50">
                    {isCreatingDossier ? (
                      <div className="p-2 flex gap-2">
                        <input
                          type="text"
                          value={newDossierName}
                          onChange={(e) => setNewDossierName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCreateAndAdd();
                            if (e.key === 'Escape') {
                              setIsCreatingDossier(false);
                              setNewDossierName('');
                            }
                          }}
                          placeholder="Nome dossier..."
                          className="flex-1 text-sm px-2 py-1.5 border border-primary-300 dark:border-primary-700 rounded-lg bg-white dark:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-primary-500"
                          autoFocus
                        />
                        <button
                          onClick={handleCreateAndAdd}
                          disabled={!newDossierName.trim()}
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-lg disabled:opacity-50 transition-colors"
                        >
                          <Check size={16} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setIsCreatingDossier(true)}
                        className="w-full px-3 py-2 text-left text-sm text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/30 flex items-center gap-2 transition-colors"
                      >
                        <Plus size={14} />
                        <span>Crea nuovo dossier</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {tab.isPinned && (
              <span className="text-[10px] px-2 py-0.5 bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-300 rounded-full font-bold uppercase tracking-wider border border-primary-100 dark:border-primary-800">
                Pinned
              </span>
            )}
          </div>
        </div>

        {/* Content area */}
        {!tab.isMinimized && (
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {tab.content.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800/50 rounded-full flex items-center justify-center mb-3">
                  <FileText size={24} className="opacity-50" />
                </div>
                <p className="text-sm font-medium">Tab vuota</p>
                <p className="text-xs text-slate-500 mt-1">Trascina qui norme o articoli</p>
              </div>
            ) : (
              tab.content.map((item) => {
                if (item.type === 'norma') {
                  return (
                    <NormaBlockComponent
                      key={item.id}
                      tabId={tab.id}
                      normaBlock={item}
                      onViewPdf={onViewPdf}
                      onCrossReference={onCrossReference}
                      onExtractArticle={(articleId) => extractArticleFromNorma(tab.id, item.id, articleId)}
                      onRemoveArticle={(articleId) => removeArticleFromNorma(tab.id, item.id, articleId)}
                      onRemoveNorma={() => removeContentFromTab(tab.id, item.id)}
                    />
                  );
                } else if (item.type === 'collection') {
                  return (
                    <ArticleCollectionComponent
                      key={item.id}
                      tabId={tab.id}
                      collection={item}
                      onViewPdf={onViewPdf}
                      onCrossReference={onCrossReference}
                    />
                  );
                } else {
                  return (
                    <LooseArticleCard
                      key={item.id}
                      tabId={tab.id}
                      looseArticle={item}
                      onViewPdf={onViewPdf}
                      onCrossReference={onCrossReference}
                      onRemove={() => removeContentFromTab(tab.id, item.id)}
                    />
                  );
                }
              })
            )}
          </div>
        )}

        {/* Resize handles */}
        {!tab.isMinimized && (
          <>
            <div onMouseDown={(e) => handleResizeStart(e, 'right')} className="absolute right-0 top-2 bottom-2 w-1.5 cursor-ew-resize hover:bg-primary-400/30 transition-colors z-10" />
            <div onMouseDown={(e) => handleResizeStart(e, 'bottom')} className="absolute bottom-0 left-2 right-2 h-1.5 cursor-ns-resize hover:bg-primary-400/30 transition-colors z-10" />
            <div onMouseDown={(e) => handleResizeStart(e, 'left')} className="absolute left-0 top-2 bottom-2 w-1.5 cursor-ew-resize hover:bg-primary-400/30 transition-colors z-10" />
            <div onMouseDown={(e) => handleResizeStart(e, 'top')} className="absolute top-0 left-2 right-2 h-1.5 cursor-ns-resize hover:bg-primary-400/30 transition-colors z-10" />

            <div onMouseDown={(e) => handleResizeStart(e, 'top-left')} className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize z-20" />
            <div onMouseDown={(e) => handleResizeStart(e, 'top-right')} className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize z-20" />
            <div onMouseDown={(e) => handleResizeStart(e, 'bottom-left')} className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize z-20" />
            <div onMouseDown={(e) => handleResizeStart(e, 'bottom-right')} className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-20" />
          </>
        )}
      </div>
    </motion.div>
  );
}
