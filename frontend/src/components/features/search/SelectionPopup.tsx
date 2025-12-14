import { useState, useEffect, useRef, useCallback } from 'react';
import { Highlighter, StickyNote, Copy, Search, X } from 'lucide-react';
import { cn } from '../../../lib/utils';

interface SelectionPopupProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onHighlight: (text: string, color: 'yellow' | 'green' | 'red' | 'blue') => void;
  onAddNote: (text: string) => void;
  onCopy: (text: string) => void;
  onSearch?: (text: string) => void;
}

interface PopupState {
  visible: boolean;
  x: number;
  y: number;
  text: string;
}

const HIGHLIGHT_COLORS = [
  { name: 'yellow', bg: 'bg-yellow-200', border: 'border-yellow-400', hover: 'hover:bg-yellow-300' },
  { name: 'green', bg: 'bg-green-200', border: 'border-green-400', hover: 'hover:bg-green-300' },
  { name: 'blue', bg: 'bg-blue-200', border: 'border-blue-400', hover: 'hover:bg-blue-300' },
  { name: 'red', bg: 'bg-red-200', border: 'border-red-400', hover: 'hover:bg-red-300' },
] as const;

export function SelectionPopup({
  containerRef,
  onHighlight,
  onAddNote,
  onCopy,
  onSearch
}: SelectionPopupProps) {
  const [popup, setPopup] = useState<PopupState>({ visible: false, x: 0, y: 0, text: '' });
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

      setPopup({
        visible: true,
        x: Math.max(80, Math.min(x, containerRect.width - 80)), // Keep within bounds
        y: Math.max(50, y), // Ensure not too high
        text: selectedText
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
        onHighlight(popup.text, 'yellow');
        hidePopup();
        window.getSelection()?.removeAllRanges();
      } else if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
        onAddNote(popup.text);
        hidePopup();
        window.getSelection()?.removeAllRanges();
      } else if ((e.key === 'c' && (e.metaKey || e.ctrlKey))) {
        // Let browser handle copy, then hide
        setTimeout(hidePopup, 100);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [popup.visible, popup.text, onHighlight, onAddNote, hidePopup]);

  const handleAction = (action: 'highlight' | 'note' | 'copy' | 'search') => {
    switch (action) {
      case 'highlight':
        setShowColorPicker(true);
        break;
      case 'note':
        onAddNote(popup.text);
        hidePopup();
        window.getSelection()?.removeAllRanges();
        break;
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

  const handleHighlightColor = (color: 'yellow' | 'green' | 'red' | 'blue') => {
    onHighlight(popup.text, color);
    hidePopup();
    setShowColorPicker(false);
    window.getSelection()?.removeAllRanges();
  };

  if (!popup.visible) return null;

  return (
    <div
      ref={popupRef}
      className={cn(
        "absolute z-50 transform -translate-x-1/2 -translate-y-full",
        "animate-in fade-in zoom-in-95 duration-150"
      )}
      style={{
        left: popup.x,
        top: popup.y
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Main popup */}
      <div className="bg-gray-900 dark:bg-gray-800 text-white rounded-lg shadow-2xl border border-gray-700 overflow-hidden">
        {showColorPicker ? (
          /* Color picker view */
          <div className="p-2 flex items-center gap-1">
            <button
              onClick={() => setShowColorPicker(false)}
              className="p-1.5 rounded hover:bg-gray-700 text-gray-400"
            >
              <X size={14} />
            </button>
            <div className="w-px h-5 bg-gray-700 mx-1" />
            {HIGHLIGHT_COLORS.map(({ name, bg, border, hover }) => (
              <button
                key={name}
                onClick={() => handleHighlightColor(name as 'yellow' | 'green' | 'red' | 'blue')}
                className={cn(
                  "w-7 h-7 rounded-full border-2 transition-transform hover:scale-110",
                  bg, border, hover
                )}
                title={`Evidenzia in ${name}`}
              />
            ))}
          </div>
        ) : (
          /* Main actions */
          <div className="flex items-center">
            <button
              onClick={() => handleAction('highlight')}
              className="p-2.5 hover:bg-gray-700 transition-colors flex items-center gap-1.5 text-sm"
              title="Evidenzia (H)"
            >
              <Highlighter size={16} className="text-yellow-400" />
            </button>
            <div className="w-px h-5 bg-gray-700" />
            <button
              onClick={() => handleAction('note')}
              className="p-2.5 hover:bg-gray-700 transition-colors flex items-center gap-1.5 text-sm"
              title="Aggiungi nota (N)"
            >
              <StickyNote size={16} className="text-blue-400" />
            </button>
            <div className="w-px h-5 bg-gray-700" />
            <button
              onClick={() => handleAction('copy')}
              className="p-2.5 hover:bg-gray-700 transition-colors flex items-center gap-1.5 text-sm"
              title="Copia (Cmd+C)"
            >
              <Copy size={16} className="text-green-400" />
            </button>
            {onSearch && (
              <>
                <div className="w-px h-5 bg-gray-700" />
                <button
                  onClick={() => handleAction('search')}
                  className="p-2.5 hover:bg-gray-700 transition-colors flex items-center gap-1.5 text-sm"
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
        <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[8px] border-t-gray-900 dark:border-t-gray-800" />
      </div>
    </div>
  );
}
