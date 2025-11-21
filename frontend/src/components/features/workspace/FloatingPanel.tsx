import { useState } from 'react';
import { Rnd } from 'react-rnd';
import { X, Minimize2, Pin, PinOff, GripVertical, Edit2 } from 'lucide-react';
import { useAppStore, type FloatingPanel as FloatingPanelType } from '../../../store/useAppStore';
import { NormaCard } from '../search/NormaCard';
import { cn } from '../../../lib/utils';
import type { ArticleData } from '../../../types';
import { applyMagneticSnap } from '../../../utils/magnetSnap';

interface FloatingPanelProps {
  panel: FloatingPanelType;
  onViewPdf: (urn: string) => void;
  onCompareArticle: (article: ArticleData) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
}

export function FloatingPanel({
  panel,
  onViewPdf,
  onCompareArticle,
  onCrossReference
}: FloatingPanelProps) {
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelInput, setLabelInput] = useState(panel.label || '');

  const {
    updateFloatingPanel,
    removeFloatingPanel,
    bringPanelToFront,
    togglePanelPin,
    togglePanelMinimize,
    floatingPanels,
    popOutArticle,
    setPanelLabel
  } = useAppStore();

  const handleDrag = (_e: any, data: { x: number; y: number }) => {
    // Apply magnetic snap during drag
    const snappedPosition = applyMagneticSnap(
      panel.id,
      { x: data.x, y: data.y },
      panel.size,
      floatingPanels.map(p => ({
        id: p.id,
        position: p.position,
        size: p.size
      }))
    );

    // Update position in real-time with snap
    updateFloatingPanel(panel.id, {
      position: snappedPosition
    });
  };

  const handleDragStop = (_e: any, data: { x: number; y: number }) => {
    // Final snap on drag stop
    const snappedPosition = applyMagneticSnap(
      panel.id,
      { x: data.x, y: data.y },
      panel.size,
      floatingPanels.map(p => ({
        id: p.id,
        position: p.position,
        size: p.size
      }))
    );

    updateFloatingPanel(panel.id, {
      position: snappedPosition
    });
  };

  const handleResizeStop = (
    _e: any,
    _direction: any,
    ref: HTMLElement,
    _delta: any,
    position: { x: number; y: number }
  ) => {
    updateFloatingPanel(panel.id, {
      size: {
        width: parseInt(ref.style.width),
        height: parseInt(ref.style.height)
      },
      position
    });
  };

  const handleMouseDown = () => {
    bringPanelToFront(panel.id);
  };

  const handleCloseArticle = (articleId: string) => {
    const updatedArticles = panel.articles.filter(
      a => a.norma_data.numero_articolo !== articleId
    );

    if (updatedArticles.length === 0) {
      // If no articles left, remove the panel
      removeFloatingPanel(panel.id);
    } else {
      // Update panel with remaining articles
      updateFloatingPanel(panel.id, {
        articles: updatedArticles,
        activeArticleId: updatedArticles[0]?.norma_data?.numero_articolo || null
      });
    }
  };

  return (
    <Rnd
      position={panel.position}
      size={panel.size}
      onDrag={handleDrag}
      onDragStop={handleDragStop}
      onResizeStop={handleResizeStop}
      dragHandleClassName="drag-handle"
      bounds="window"
      minWidth={400}
      minHeight={300}
      style={{ zIndex: panel.zIndex }}
      onMouseDown={handleMouseDown}
      className={cn(
        "transition-shadow",
        panel.isPinned && "ring-2 ring-blue-500"
      )}
      enableResizing={{
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
      <div className="h-full flex flex-col bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header with drag handle and controls */}
        <div className="drag-handle cursor-move flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <GripVertical size={16} className="text-gray-400 shrink-0" />

            {isEditingLabel ? (
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onBlur={() => {
                  if (labelInput.trim()) {
                    setPanelLabel(panel.id, labelInput.trim());
                  }
                  setIsEditingLabel(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (labelInput.trim()) {
                      setPanelLabel(panel.id, labelInput.trim());
                    }
                    setIsEditingLabel(false);
                  }
                  if (e.key === 'Escape') {
                    setLabelInput(panel.label || '');
                    setIsEditingLabel(false);
                  }
                }}
                autoFocus
                className="flex-1 px-2 py-1 text-sm font-semibold bg-white dark:bg-gray-800 border border-blue-500 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Etichetta personalizzata"
              />
            ) : (
              <div
                className="flex items-center gap-2 flex-1 min-w-0 group"
                onDoubleClick={() => {
                  setLabelInput(panel.label || '');
                  setIsEditingLabel(true);
                }}
              >
                <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate">
                  {panel.label || `${panel.norma.tipo_atto}${panel.norma.numero_atto ? ` n. ${panel.norma.numero_atto}` : ''}${panel.norma.data ? ` del ${panel.norma.data}` : ''}`}
                </h3>
                <button
                  onClick={() => {
                    setLabelInput(panel.label || '');
                    setIsEditingLabel(true);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-opacity"
                  title="Modifica etichetta"
                >
                  <Edit2 size={12} className="text-gray-500" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {panel.isPinned && (
              <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded">
                Pinned
              </span>
            )}

            <button
              onClick={() => togglePanelPin(panel.id)}
              className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
              title={panel.isPinned ? "Rimuovi pin" : "Fissa in alto"}
            >
              {panel.isPinned ? (
                <PinOff size={14} className="text-gray-600 dark:text-gray-400" />
              ) : (
                <Pin size={14} className="text-gray-600 dark:text-gray-400" />
              )}
            </button>

            <button
              onClick={() => togglePanelMinimize(panel.id)}
              className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
              title="Minimizza"
            >
              <Minimize2 size={14} className="text-gray-600 dark:text-gray-400" />
            </button>

            <button
              onClick={() => removeFloatingPanel(panel.id)}
              className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900 rounded transition-colors"
              title="Chiudi"
            >
              <X size={14} className="text-gray-600 dark:text-gray-400 hover:text-red-600" />
            </button>
          </div>
        </div>

        {/* Content area - NormaCard without its own header */}
        {!panel.isMinimized && (
          <div className="flex-1 overflow-auto">
            <NormaCard
              norma={panel.norma}
              articles={panel.articles}
              onCloseArticle={handleCloseArticle}
              onViewPdf={onViewPdf}
              onPinArticle={() => {}}
              onCompareArticle={onCompareArticle}
              onCrossReference={onCrossReference}
              onPopOut={(articleId) => popOutArticle(panel.id, articleId)}
              isNew={false}
            />
          </div>
        )}
      </div>
    </Rnd>
  );
}
