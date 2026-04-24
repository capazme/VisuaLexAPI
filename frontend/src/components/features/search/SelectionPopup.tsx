import { useState, useEffect, useRef, useCallback } from 'react';
import { Highlighter, StickyNote, Copy, Search, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { HIGHLIGHT_COLORS, getHighlightSwatch, type HighlightColor } from '../../../utils/highlightColors';
import { getPlainTextOffset } from '../../../utils/selectionOffset';

interface SelectionPopupProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onHighlight: (text: string, color: HighlightColor, startOffset: number) => void;
  // rect is the viewport-space bounding box of the selection at the moment the
  // action was fired; consumers can use it to anchor a tooltip composer on the
  // span itself (the actual selection gets cleared right after).
  onAddNote: (text: string, startOffset: number, rect: { x: number; y: number; width: number; height: number }) => void;
  onCopy: (text: string) => void;
  onSearch?: (text: string) => void;
}

interface PopupState {
  visible: boolean;
  x: number;
  y: number;
  text: string;
  startOffset: number; // plain-text offset of the selection start in container.textContent
}

export function SelectionPopup({
  containerRef,
  onHighlight,
  onAddNote,
  onCopy,
  onSearch
}: SelectionPopupProps) {
  const [popup, setPopup] = useState<PopupState>({ visible: false, x: 0, y: 0, text: '', startOffset: -1 });
  const [showColorPicker, setShowColorPicker] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const hidePopup = useCallback(() => {
    setPopup(prev => ({ ...prev, visible: false }));
    setShowColorPicker(false);
  }, []);

  const handleMouseUp = useCallback(() => {
    // Clear any pending hide timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    // Small delay to let selection finalize
    setTimeout(() => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();

      if (!selectedText || selectedText.length < 2) {
        // Delay hiding to allow clicking on popup
        hideTimeoutRef.current = setTimeout(hidePopup, 200);
        return;
      }

      // Check if selection is within our container
      if (!selection?.rangeCount || !containerRef.current) return;

      const range = selection.getRangeAt(0);
      if (!containerRef.current.contains(range.commonAncestorContainer)) {
        hideTimeoutRef.current = setTimeout(hidePopup, 200);
        return;
      }

      // Get position for popup
      const rect = range.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();

      // Position above the selection, centered
      const x = rect.left + rect.width / 2 - containerRect.left;
      const y = rect.top - containerRect.top - 10;

      // Capture the plain-text offset of the selection start so the renderer
      // can pin the mark to this exact occurrence (not every copy of the string).
      const startOffset = getPlainTextOffset(containerRef.current, range.startContainer, range.startOffset);

      setPopup({
        visible: true,
        x: Math.max(80, Math.min(x, containerRect.width - 80)), // Keep within bounds
        y: Math.max(50, y), // Ensure not too high
        text: selectedText,
        startOffset,
      });
    }, 10);
  }, [containerRef, hidePopup]);

  // Handle mousedown outside popup to hide it
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        // Don't hide immediately if clicking within container (might be selecting)
        if (containerRef.current?.contains(e.target as Node)) {
          return;
        }
        hidePopup();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [containerRef, hidePopup]);

  // Attach mouseup listener to container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('mouseup', handleMouseUp);
    return () => container.removeEventListener('mouseup', handleMouseUp);
  }, [containerRef, handleMouseUp]);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!popup.visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        hidePopup();
        window.getSelection()?.removeAllRanges();
      } else if (e.key === 'h' && !e.metaKey && !e.ctrlKey) {
        // Quick highlight with default color
        onHighlight(popup.text, 'yellow', popup.startOffset);
        hidePopup();
        window.getSelection()?.removeAllRanges();
      } else if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
        const selRange = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).getBoundingClientRect() : null;
        const r = selRange ?? { x: popup.x, y: popup.y, width: 0, height: 0 };
        onAddNote(popup.text, popup.startOffset, { x: r.x, y: r.y, width: r.width, height: r.height });
        hidePopup();
        window.getSelection()?.removeAllRanges();
      } else if ((e.key === 'c' && (e.metaKey || e.ctrlKey))) {
        // Let browser handle copy, then hide
        setTimeout(hidePopup, 100);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [popup.visible, popup.text, popup.startOffset, popup.x, popup.y, onHighlight, onAddNote, hidePopup]);

  const handleAction = (action: 'highlight' | 'note' | 'copy' | 'search') => {
    switch (action) {
      case 'highlight':
        setShowColorPicker(true);
        break;
      case 'note': {
        // Capture the live selection rect BEFORE hiding / clearing — the
        // composer will anchor on this rect (viewport coords).
        const selRange = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).getBoundingClientRect() : null;
        const r = selRange ?? { x: popup.x, y: popup.y, width: 0, height: 0 };
        onAddNote(popup.text, popup.startOffset, { x: r.x, y: r.y, width: r.width, height: r.height });
        hidePopup();
        window.getSelection()?.removeAllRanges();
        break;
      }
      case 'copy':
        onCopy(popup.text);
        hidePopup();
        window.getSelection()?.removeAllRanges();
        break;
      case 'search':
        onSearch?.(popup.text);
        hidePopup();
        window.getSelection()?.removeAllRanges();
        break;
    }
  };

  const handleHighlightColor = (color: HighlightColor) => {
    onHighlight(popup.text, color, popup.startOffset);
    hidePopup();
    setShowColorPicker(false);
    window.getSelection()?.removeAllRanges();
  };

  if (!popup.visible) return null;

  return (
    <div
      ref={popupRef}
      className={cn(
        'absolute transform -translate-x-1/2 -translate-y-full',
        'animate-in fade-in zoom-in-95 duration-150',
        Z_INDEX.floating
      )}
      style={{
        left: popup.x,
        top: popup.y
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Main popup */}
      <div className="bg-slate-900 dark:bg-slate-800 text-white rounded-lg shadow-2xl border border-slate-700 overflow-hidden">
        {showColorPicker ? (
          /* Color picker view */
          <div className="p-2 flex items-center gap-1">
            <button
              onClick={() => setShowColorPicker(false)}
              className="p-1.5 rounded hover:bg-slate-700 text-slate-400"
            >
              <X size={14} />
            </button>
            <div className="w-px h-5 bg-slate-700 mx-1" />
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => handleHighlightColor(color)}
                className="w-7 h-7 rounded-full border-2 border-white/40 transition-transform hover:scale-110 hover:ring-2 hover:ring-white/60"
                style={{ backgroundColor: getHighlightSwatch(color) }}
                title={`Evidenzia in ${color}`}
              />
            ))}
          </div>
        ) : (
          /* Main actions */
          <div className="flex items-center">
            <button
              onClick={() => handleAction('highlight')}
              className="p-2.5 hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-sm"
              title="Evidenzia (H)"
            >
              <Highlighter size={16} className="text-yellow-400" />
            </button>
            <div className="w-px h-5 bg-slate-700" />
            <button
              onClick={() => handleAction('note')}
              className="p-2.5 hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-sm"
              title="Aggiungi nota (N)"
            >
              <StickyNote size={16} className="text-blue-400" />
            </button>
            <div className="w-px h-5 bg-slate-700" />
            <button
              onClick={() => handleAction('copy')}
              className="p-2.5 hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-sm"
              title="Copia (Cmd+C)"
            >
              <Copy size={16} className="text-green-400" />
            </button>
            {onSearch && (
              <>
                <div className="w-px h-5 bg-slate-700" />
                <button
                  onClick={() => handleAction('search')}
                  className="p-2.5 hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-sm"
                  title="Cerca"
                >
                  <Search size={16} className="text-purple-400" />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Arrow pointing down */}
      <div className="absolute left-1/2 transform -translate-x-1/2 top-full">
        <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[8px] border-t-slate-900 dark:border-t-slate-800" />
      </div>
    </div>
  );
}
