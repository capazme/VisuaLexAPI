import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Highlighter, StickyNote, Copy, Search, Flag, MessageCircle, GraduationCap } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { HIGHLIGHT_ICON_ON_DARK, highlightColorName, type HighlightColor } from '../../../utils/highlightColors';
import { useAppStore } from '../../../store/useAppStore';
import { getSelectionAnchor } from '../../../utils/selectionOffset';

interface SelectionPopupProps {
  /** Where selections are listened for (mouseup) and where the popup is positioned. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * The element that holds the article text and nothing else — the root the
   * stored offsets are measured from. Defaults to `containerRef`. It must not
   * contain this popup: a text label added to the popup would otherwise shift
   * every offset measured while it is open.
   */
  textRootRef?: React.RefObject<HTMLElement | null>;
  onHighlight: (text: string, color: HighlightColor, startOffset: number) => void;
  // rect is the viewport-space bounding box of the selection at the moment the
  // action was fired; consumers can use it to anchor a tooltip composer on the
  // span itself (the actual selection gets cleared right after).
  onAddNote: (text: string, startOffset: number, rect: { x: number; y: number; width: number; height: number }) => void;
  onCopy: (text: string) => void;
  onSearch?: (text: string) => void;
  // Optional "Segnala come citazione" action: rendered only when the host
  // passes it (same rect contract as onAddNote). The popup knows nothing about
  // who consumes it; hosts that do not pass it keep the three core actions.
  onReportCitation?: (text: string, startOffset: number, rect: { x: number; y: number; width: number; height: number }) => void;
  // Optional "Discuti" action: rendered only when the host passes it.
  // Starts a discussion on the selected passage.
  onDiscuss?: (text: string, startOffset: number) => void;
  // Optional "Crea scheda" action: rendered only when the host passes it. Gets the words as the
  // reader sees them (the way copy does), to open a VisuaLex Studia card with them.
  onCreateCard?: (text: string) => void;
  // A past text takes no highlight, note or discussion (they are keyed by
  // article, not by version): only "Copia" is offered, and the shortcuts of the
  // others are off too.
  copyOnly?: boolean;
}

interface PopupState {
  visible: boolean;
  x: number;
  y: number;
  /** The anchor text, read from the DOM text nodes (matches the stored projection). */
  text: string;
  /** Plain-text offset of `text` in the text root. */
  startOffset: number;
  /** What the reader sees (line breaks included) — for copy and search only. */
  displayText: string;
}

export function SelectionPopup({
  containerRef,
  textRootRef,
  onHighlight,
  onAddNote,
  onCopy,
  onSearch,
  onReportCitation,
  onDiscuss,
  onCreateCard,
  copyOnly = false,
}: SelectionPopupProps) {
  const [popup, setPopup] = useState<PopupState>({ visible: false, x: 0, y: 0, text: '', startOffset: -1, displayText: '' });
  // Every new highlight takes the colour chosen once in the reading bar (H1, `HighlightColorMenu`).
  const highlightColor = useAppStore((s) => s.settings.highlightColor);
  const popupRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const hidePopup = useCallback(() => {
    setPopup(prev => ({ ...prev, visible: false }));
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
      // The rendered text: it decides whether there is a selection at all and
      // is what copy and search use. The stored anchor is read separately.
      const rawSelected = selection?.toString() ?? '';

      if (rawSelected.trim().length < 2) {
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

      // The anchor (text + plain-text offset) is read from the text root's
      // DOM text, so it pins the mark to this exact occurrence and always
      // matches what the renderer checks — Selection.toString() would add a
      // newline for every line or comma boundary the selection crosses.
      const anchor = getSelectionAnchor(textRootRef?.current ?? containerRef.current, selection);
      if (!anchor) {
        hideTimeoutRef.current = setTimeout(hidePopup, 200);
        return;
      }

      setPopup({
        visible: true,
        x: Math.max(80, Math.min(x, containerRect.width - 80)), // Keep within bounds
        y: Math.max(50, y), // Ensure not too high
        text: anchor.text,
        startOffset: anchor.startOffset,
        displayText: rawSelected.trim(),
      });
    }, 10);
  }, [containerRef, textRootRef, hidePopup]);

  // Moved sideways to stay 8 px inside the window, from its measured box, once drawn and again when it moves: the
  // position's clamp counts in the container, not the window, and a phone's edge once cut the popup (D7b). A style
  // written on the element, not state: nothing else draws again.
  useLayoutEffect(() => {
    const el = popupRef.current;
    if (!popup.visible || !el) return;
    el.style.marginLeft = '0px';
    const box = el.getBoundingClientRect();
    const margin = 8;
    let nudge = 0;
    if (box.left < margin) nudge = margin - box.left;
    else if (box.right > window.innerWidth - margin) nudge = window.innerWidth - margin - box.right;
    el.style.marginLeft = `${nudge}px`;
  }, [popup.visible, popup.x, popup.y]);

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

  // Attach mouseup + touchend listeners to container so selection works
  // with both pointer types
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('touchend', handleMouseUp);
    return () => {
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('touchend', handleMouseUp);
    };
  }, [containerRef, handleMouseUp]);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!popup.visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        hidePopup();
        window.getSelection()?.removeAllRanges();
      } else if (e.key === 'h' && !copyOnly && !e.metaKey && !e.ctrlKey) {
        // Quick highlight, in the colour chosen in the reading bar (H1)
        onHighlight(popup.text, highlightColor, popup.startOffset);
        hidePopup();
        window.getSelection()?.removeAllRanges();
      } else if (e.key === 'n' && !copyOnly && !e.metaKey && !e.ctrlKey) {
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
  }, [popup.visible, popup.text, popup.startOffset, popup.x, popup.y, onHighlight, onAddNote, copyOnly, hidePopup, highlightColor]);

  // The live selection rect (viewport coords), read BEFORE the popup hides
  // and the selection is cleared (gotcha 16); falls back to the popup anchor.
  const captureSelectionRect = () => {
    const selRange = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).getBoundingClientRect() : null;
    const r = selRange ?? { x: popup.x, y: popup.y, width: 0, height: 0 };
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };

  const handleAction = (action: 'highlight' | 'note' | 'copy' | 'search' | 'report' | 'discuss' | 'card') => {
    switch (action) {
      // The colour chosen once in the reading bar (H1): never asked here.
      case 'highlight':
        onHighlight(popup.text, highlightColor, popup.startOffset);
        hidePopup();
        window.getSelection()?.removeAllRanges();
        break;
      case 'note': {
        // Capture the live selection rect BEFORE hiding / clearing — the
        // composer will anchor on this rect (viewport coords).
        onAddNote(popup.text, popup.startOffset, captureSelectionRect());
        hidePopup();
        window.getSelection()?.removeAllRanges();
        break;
      }
      case 'discuss': {
        onDiscuss?.(popup.text, popup.startOffset);
        hidePopup();
        window.getSelection()?.removeAllRanges();
        break;
      }
      case 'card':
        onCreateCard?.(popup.displayText || popup.text);
        hidePopup();
        window.getSelection()?.removeAllRanges();
        break;
      case 'copy':
        onCopy(popup.displayText || popup.text);
        hidePopup();
        window.getSelection()?.removeAllRanges();
        break;
      case 'search':
        onSearch?.(popup.displayText || popup.text);
        hidePopup();
        window.getSelection()?.removeAllRanges();
        break;
      case 'report': {
        const rect = captureSelectionRect();
        onReportCitation?.(popup.text, popup.startOffset, rect);
        hidePopup();
        window.getSelection()?.removeAllRanges();
        break;
      }
    }
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
      <div className="bg-slate-900 dark:bg-slate-800 text-white rounded-lg shadow-md border border-slate-700 overflow-hidden">
        {/* Main actions */}
          <div className="flex items-center">
            {!copyOnly && (
              <>
                <button
                  onClick={() => handleAction('highlight')}
                  className="p-2.5 hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-sm"
                  title="Evidenzia (H)"
                  aria-label={`Evidenzia in ${highlightColorName(highlightColor)}`}
                  aria-keyshortcuts="h"
                >
                  {/* In the colour it will take. */}
                  <Highlighter size={16} aria-hidden className={HIGHLIGHT_ICON_ON_DARK[highlightColor]} />
                </button>
                <div className="w-px h-5 bg-slate-700" />
                <button
                  onClick={() => handleAction('note')}
                  className="p-2.5 hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-sm"
                  title="Aggiungi nota (N)"
                >
                  <StickyNote size={16} className="text-primary-400" />
                </button>
                {onDiscuss && (
                  <>
                    <div className="w-px h-5 bg-slate-700" />
                    <button
                      onClick={() => handleAction('discuss')}
                      className="p-2.5 hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-sm"
                      title="Discuti con i colleghi"
                      aria-label="Discuti con i colleghi"
                    >
                      <MessageCircle size={16} className="text-sky-400" />
                    </button>
                  </>
                )}
                {onCreateCard && (
                  <>
                    <div className="w-px h-5 bg-slate-700" />
                    <button
                      onClick={() => handleAction('card')}
                      className="p-2.5 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      title="Crea scheda"
                      aria-label="Crea scheda"
                    >
                      <GraduationCap size={16} className="text-teal-400" />
                    </button>
                  </>
                )}
                <div className="w-px h-5 bg-slate-700" />
              </>
            )}
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
                  <Search size={16} className="text-primary-300" aria-hidden />
                </button>
              </>
            )}
            {onReportCitation && !copyOnly && (
              <>
                <div className="w-px h-5 bg-slate-700" />
                <button
                  onClick={() => handleAction('report')}
                  className="p-2.5 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  title="Segnala come citazione"
                  aria-label="Segnala come citazione"
                >
                  <Flag size={16} className="text-sky-400" />
                </button>
              </>
            )}
          </div>
      </div>

      {/* Arrow pointing down */}
      <div className="absolute left-1/2 transform -translate-x-1/2 top-full">
        <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[8px] border-t-slate-900 dark:border-t-slate-800" />
      </div>
    </div>
  );
}
