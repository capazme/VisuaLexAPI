import { useState, useRef } from 'react';
import { Rnd } from 'react-rnd';
import { X, GripVertical, Edit2 } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { useAppStore, type WorkspaceTab } from '../../../store/useAppStore';
import { NormaBlockComponent } from './NormaBlockComponent';
import { LooseArticleCard } from './LooseArticleCard';
import { cn } from '../../../lib/utils';
import type { ArticleData } from '../../../types';

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

  const {
    updateTab,
    removeTab,
    bringTabToFront,
    toggleTabPin,
    toggleTabMinimize,
    setTabLabel,
    workspaceTabs,
    extractArticleFromNorma,
    removeArticleFromNorma
  } = useAppStore();

  // Make this tab a drop zone
  const { setNodeRef, isOver } = useDroppable({
    id: tab.id,
  });

  // Track velocity for inertia
  const lastPositions = useRef<Array<{ x: number; y: number; time: number }>>([]);

  const handleDrag = (_e: any, data: { x: number; y: number }) => {
    const now = Date.now();
    lastPositions.current.push({ x: data.x, y: data.y, time: now });
    // Keep only last 5 positions
    if (lastPositions.current.length > 5) {
      lastPositions.current.shift();
    }
  };

  // Apply inertia on drag stop
  const handleDragStop = (_e: any, data: { x: number; y: number }) => {
    const positions = lastPositions.current;

    if (positions.length >= 2) {
      const last = positions[positions.length - 1];
      const prev = positions[0];
      const dt = (last.time - prev.time) / 1000; // seconds

      if (dt > 0 && dt < 0.3) { // Apply inertia for quick movements
        const vx = (last.x - prev.x) / dt;
        const vy = (last.y - prev.y) / dt;

        // Apply momentum (higher = more slide)
        const friction = 0.25;
        const finalX = Math.round(data.x + vx * friction);
        const finalY = Math.round(data.y + vy * friction);

        // Clamp to window bounds
        const maxX = window.innerWidth - tab.size.width;
        const maxY = window.innerHeight - tab.size.height;

        updateTab(tab.id, {
          position: {
            x: Math.max(0, Math.min(finalX, maxX)),
            y: Math.max(0, Math.min(finalY, maxY))
          }
        });
      } else {
        updateTab(tab.id, { position: { x: data.x, y: data.y } });
      }
    } else {
      updateTab(tab.id, { position: { x: data.x, y: data.y } });
    }

    // Clear positions
    lastPositions.current = [];
  };

  const handleResizeStop = (
    _e: any,
    _direction: any,
    ref: HTMLElement,
    _delta: any,
    position: { x: number; y: number }
  ) => {
    updateTab(tab.id, {
      size: {
        width: parseInt(ref.style.width),
        height: parseInt(ref.style.height)
      },
      position
    });
  };

  const handleMouseDown = () => {
    bringTabToFront(tab.id);
  };

  return (
    <Rnd
      position={tab.position}
      size={tab.isMinimized ? { width: 300, height: 44 } : tab.size}
      onDrag={handleDrag}
      onDragStop={handleDragStop}
      onResizeStop={handleResizeStop}
      dragHandleClassName="drag-handle"
      minWidth={200}
      minHeight={44}
      style={{ zIndex: tab.zIndex, transition: 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}
      onMouseDown={handleMouseDown}
      className={cn(
        tab.isPinned && "ring-2 ring-blue-500"
      )}
      enableResizing={tab.isMinimized ? false : {
        top: true,
        right: true,
        bottom: true,
        left: true,
        topRight: true,
        bottomRight: true,
        bottomLeft: true,
        topLeft: true
      }}
    >
      <div
        ref={setNodeRef}
        className={cn(
          "h-full flex flex-col bg-white dark:bg-gray-800 rounded-lg shadow-2xl border overflow-hidden transition-shadow hover:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)]",
          isOver
            ? "border-blue-500 border-2 bg-blue-50 dark:bg-blue-950"
            : "border-gray-200 dark:border-gray-700"
        )}
      >
        {/* Header with macOS-style controls */}
        <div className="drag-handle cursor-move flex items-center justify-between px-4 py-3 bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* macOS traffic lights */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => removeTab(tab.id)}
                className="w-3 h-3 bg-red-500 hover:bg-red-600 rounded-full transition-colors group/close"
                title="Chiudi"
              >
                <X size={10} className="text-red-900 opacity-0 group-hover/close:opacity-100 transition-opacity mx-auto" />
              </button>
              <button
                onClick={() => toggleTabMinimize(tab.id)}
                className="w-3 h-3 bg-yellow-500 hover:bg-yellow-600 rounded-full transition-colors"
                title="Minimizza"
              />
              <button
                onClick={() => toggleTabPin(tab.id)}
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
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-opacity"
                  title="Modifica nome"
                >
                  <Edit2 size={12} className="text-gray-500" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
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
                    />
                  );
                }
              })
            )}
          </div>
        )}
      </div>
    </Rnd>
  );
}
