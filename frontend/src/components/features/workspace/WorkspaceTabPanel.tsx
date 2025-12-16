import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, useMotionValue, useDragControls } from 'framer-motion';
import type { PanInfo } from 'framer-motion';
import { X, Edit2, FolderPlus, Check, Plus } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { useAppStore, appStore, type WorkspaceTab } from '../../../store/useAppStore';
import { NormaBlockComponent } from './NormaBlockComponent';
import { LooseArticleCard } from './LooseArticleCard';
import { ArticleCollectionComponent } from './ArticleCollectionComponent';
import { cn } from '../../../lib/utils';
import type { ArticleData } from '../../../types';
import { useTour } from '../../../hooks/useTour';



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
    settings
  } = useAppStore();

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
  const springX = x;  // Renamed for compatibility but no spring
  const springY = y;  // Renamed for compatibility but no spring

  // Sync with store when tab position/size changes externally
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number; direction: string } | null>(null);

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
    const momentumX = info.velocity.x * 0.15;
    const momentumY = info.velocity.y * 0.15;

    // Clamp to window bounds
    const currentWidth = tab.isMinimized ? 300 : width.get();
    const currentHeight = tab.isMinimized ? 44 : height.get();
    const maxX = window.innerWidth - currentWidth;
    const maxY = window.innerHeight - currentHeight;

    const finalX = Math.max(0, Math.min(maxX, currentX + momentumX));
    const finalY = Math.max(0, Math.min(maxY, currentY + momentumY));

    // Animate to final position
    x.set(finalX);
    y.set(finalY);

    // Save to store
    updateTab(tab.id, { position: { x: finalX, y: finalY } });
  }, [tab.id, tab.isMinimized, updateTab, x, y, width, height]);

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

  return (
    <motion.div
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      style={{
        x: springX,
        y: springY,
        width: tab.isMinimized ? 300 : width,
        height: tab.isMinimized ? 44 : height,
        zIndex: tab.zIndex
      }}
      className={cn(
        "fixed",
        tab.isPinned && "ring-2 ring-blue-500",
        isDragging && "cursor-grabbing"
      )}
      onMouseDown={handleMouseDown}
    >
      <div
        ref={setNodeRef}
        className={cn(
          // Liquid Glass container
          "workspace-tab-panel h-full flex flex-col rounded-2xl shadow-glass-lg overflow-hidden",
          "bg-white/75 dark:bg-gray-900/75 backdrop-blur-2xl",
          "border",
          isOver
            ? "border-blue-500 border-2 bg-blue-50/80 dark:bg-blue-950/80"
            : "border-white/20 dark:border-white/10"
        )}
      >
        {/* Header with macOS-style controls - Liquid Glass */}
        <div
          onPointerDown={(e) => {
            // Only start drag if not clicking a button or interactive element
            const target = e.target as HTMLElement;
            if (target.closest('button') || target.closest('input')) return;
            dragControls.start(e);
          }}
          className="cursor-grab active:cursor-grabbing flex items-center justify-between px-4 py-3 bg-white/30 dark:bg-white/5 border-b border-white/10 dark:border-white/5 select-none touch-none">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* macOS traffic lights */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => removeTab(tab.id)}
                onPointerDown={(e) => e.stopPropagation()}
                className="w-3 h-3 bg-red-500 hover:bg-red-600 rounded-full transition-colors group/close"
                title="Chiudi"
              >
                <X size={10} className="text-red-900 opacity-0 group-hover/close:opacity-100 transition-opacity mx-auto" />
              </button>
              <button
                onClick={() => toggleTabMinimize(tab.id)}
                onPointerDown={(e) => e.stopPropagation()}
                className="w-3 h-3 bg-yellow-500 hover:bg-yellow-600 rounded-full transition-colors"
                title="Minimizza"
              />
              <button
                onClick={() => toggleTabPin(tab.id)}
                onPointerDown={(e) => e.stopPropagation()}
                className={cn(
                  "w-3 h-3 rounded-full transition-colors",
                  tab.isPinned ? "bg-blue-500 hover:bg-blue-600" : "bg-green-500 hover:bg-green-600"
                )}
                title={tab.isPinned ? "Rimuovi pin" : "Fissa"}
              />
            </div>

            <div className="w-px h-4 bg-gray-300 dark:bg-gray-600" />

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
                className="flex-1 px-2 py-1 text-sm font-semibold bg-white dark:bg-gray-800 border border-blue-500 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate">
                  {tab.label}
                </h3>
                <button
                  onClick={() => {
                    setLabelInput(tab.label);
                    setIsEditingLabel(true);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-opacity"
                  title="Modifica nome"
                >
                  <Edit2 size={12} className="text-gray-500" />
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
                  "p-1.5 rounded transition-colors",
                  showDossierMenu
                    ? "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300"
                    : "text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/30"
                )}
                title="Aggiungi a dossier"
              >
                <FolderPlus size={16} />
              </button>

              {/* Dossier dropdown menu */}
              {showDossierMenu && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                      Aggiungi a Dossier
                    </span>
                  </div>

                  <div className="max-h-48 overflow-y-auto">
                    {dossiers.length === 0 && !isCreatingDossier ? (
                      <div className="px-3 py-4 text-center text-sm text-gray-500">
                        Nessun dossier disponibile
                      </div>
                    ) : (
                      dossiers.map(dossier => (
                        <button
                          key={dossier.id}
                          onClick={() => handleAddToDossier(dossier.id)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-purple-50 dark:hover:bg-purple-900/30 flex items-center gap-2 transition-colors"
                        >
                          <FolderPlus size={14} className="text-purple-500 shrink-0" />
                          <span className="truncate text-gray-700 dark:text-gray-300">{dossier.title}</span>
                          <span className="text-xs text-gray-400 ml-auto">{dossier.items.length}</span>
                        </button>
                      ))
                    )}
                  </div>

                  {/* Create new dossier */}
                  <div className="border-t border-gray-200 dark:border-gray-700">
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
                          className="flex-1 text-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500"
                          autoFocus
                        />
                        <button
                          onClick={handleCreateAndAdd}
                          disabled={!newDossierName.trim()}
                          className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded disabled:opacity-50"
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
              <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full font-medium">
                Pinned
              </span>
            )}
          </div>
        </div>

        {/* Content area */}
        {!tab.isMinimized && (
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {tab.content.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-400">
                <p className="text-sm">Tab vuota - trascina qui norme o articoli</p>
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

        {/* Resize handles - only show when not minimized */}
        {!tab.isMinimized && (
          <>
            {/* Edges */}
            <div onMouseDown={(e) => handleResizeStart(e, 'right')} className="absolute right-0 top-2 bottom-2 w-1 cursor-ew-resize hover:bg-blue-400/50 transition-colors" />
            <div onMouseDown={(e) => handleResizeStart(e, 'bottom')} className="absolute bottom-0 left-2 right-2 h-1 cursor-ns-resize hover:bg-blue-400/50 transition-colors" />
            <div onMouseDown={(e) => handleResizeStart(e, 'left')} className="absolute left-0 top-2 bottom-2 w-1 cursor-ew-resize hover:bg-blue-400/50 transition-colors" />
            <div onMouseDown={(e) => handleResizeStart(e, 'top')} className="absolute top-0 left-2 right-2 h-1 cursor-ns-resize hover:bg-blue-400/50 transition-colors" />
            {/* Corners */}
            <div onMouseDown={(e) => handleResizeStart(e, 'top-left')} className="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize" />
            <div onMouseDown={(e) => handleResizeStart(e, 'top-right')} className="absolute top-0 right-0 w-3 h-3 cursor-nesw-resize" />
            <div onMouseDown={(e) => handleResizeStart(e, 'bottom-left')} className="absolute bottom-0 left-0 w-3 h-3 cursor-nesw-resize" />
            <div onMouseDown={(e) => handleResizeStart(e, 'bottom-right')} className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize" />
          </>
        )}
      </div>
    </motion.div>
  );
}
