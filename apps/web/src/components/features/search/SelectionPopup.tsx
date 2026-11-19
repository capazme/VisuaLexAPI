import { useId, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Eraser, Highlighter, StickyNote, Copy, Search, Flag, MessageCircle, GraduationCap, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { HIGHLIGHT_ICON_ON_DARK, highlightColorName } from '../../../utils/highlightColors';
import { useAppStore } from '../../../store/useAppStore';
import { getSelectionAnchor, inReaderSlot, READER_SLOT_ATTR } from '../../../utils/selectionOffset';
import { isEditableTarget } from '../../ui/notifications/undoShortcut';
import { getInkAnchor } from '../../../utils/inkSelection';
import type { Ink } from '../../../utils/highlighterRules';
import { registerInkTarget, type NoteKind } from '../../../utils/inkTargets';
import { useInkOnRelease } from '../../../hooks/useInkOnRelease';
import { useHighlighterInk } from '../../../hooks/useHighlighterInk';
import { Button } from '../../ui/Button';
import { BlockSpace } from './BlockSpace';
import { focusOn, useOneSpaceAtATime } from './textSpaces';
import { IslandSurface } from '../../ui/IslandSurface';
import { IconButton } from '../../ui/IconButton';
import { CARD_RADIUS } from '../../ui/controlStyles';
import { REPEAT_CLOSE, REPEAT_OPEN } from '../../../lib/motion';
import { fitsInView, opensUnder, revealBy, scrollViewBy, viewOf } from '../../../utils/selectionSpace';

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
  /** The words and the highlighter's ink (a colour, or «Nessun colore»): the reader applies its rules (A4). */
  onHighlight: (text: string, ink: Ink, startOffset: number) => void;
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
  /**
   * The actions open under the paragraph the selection ends in, in the text (`BlockSpace`, LC142, L-73), with their
   * words. Off, the dark bar over the selection: Study Mode's, itself still over the page (F2).
   */
  inPage?: boolean;
}

interface PopupState {
  visible: boolean;
  x: number;
  y: number;
  /** The anchor text, read from the DOM text nodes (matches the stored projection). */
  text: string;
  /** Plain-text offset of `text` in the text root. */
  startOffset: number;
  /** What the highlighter takes of it: whole words, or the piece exactly with Alt (`getInkAnchor`). */
  ink: { text: string; startOffset: number };
  /** What the reader sees (line breaks included) — for copy and search only. */
  displayText: string;
  /** In the page: the block the selection ends in, the space's place. */
  block: HTMLElement | null;
  /**
   * In the page: the actions open under the paragraph (its end within about one view of the words), else as an island
   * from the words (L-74; a text drawn flat too). Measured as the selection is released (LC142, Luca's option A).
   */
  under: boolean;
  /** The selected words' box on screen as they were released: the island grows from it. */
  words: { top: number; right: number; bottom: number; left: number };
  /** The island's top in the container: under the words, never over them. */
  below: number;
  /** The paragraph's place among the text's, to find it again once the text is redrawn (a highlight saved). */
  ordinal: number;
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
  inPage = false,
}: SelectionPopupProps) {
  const [popup, setPopup] = useState<PopupState>({ visible: false, x: 0, y: 0, text: '', startOffset: -1, ink: { text: '', startOffset: -1 }, displayText: '', block: null, under: false, words: { top: 0, right: 0, bottom: 0, left: 0 }, below: 0, ordinal: -1 });
  // The highlighter's ink, chosen in the reading bar (H1, A4): a colour, or «Nessun colore», which takes highlights away.
  const ink = useHighlighterInk();
  // The highlighter on (A4): every selection takes the ink as it is released, and this bar does not appear. Not on a
  // text that takes no highlight. The note tool on (§6): every selection opens the editor of a note on it, as selected.
  const inking = useAppStore((s) => s.readingTool === 'highlight') && !copyOnly;
  const noting = useAppStore((s) => s.readingTool === 'note') && !copyOnly;
  const noteKind = useAppStore((s) => s.noteToolKind);
  const tooling = inking || noting;
  const popupRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const hidePopup = useCallback(() => {
    setPopup(prev => ({ ...prev, visible: false }));
  }, []);

  // The reader's handlers as they are now, for the registered target and the tools' release.
  const highlightRef = useRef(onHighlight);
  const noteRef = useRef({ onAddNote, onDiscuss });
  useEffect(() => {
    highlightRef.current = onHighlight;
    noteRef.current = { onAddNote, onDiscuss };
  });

  /**
   * A note on the words selected, as selected (a note keeps them exactly, A4), read now — the words and their box,
   * before a press or the clearing takes the selection away (gotcha 16) —, and the editor it opens once asked: a gloss
   * opens the discussion's composer where the reader has one, else it is a personal note. Null with no words to anchor.
   */
  const noteOn = useCallback((selection: Selection): ((kind: NoteKind) => void) | null => {
    const anchor = getSelectionAnchor(textRootRef?.current ?? containerRef.current, selection);
    if (!anchor) return null;
    const box = selection.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
    const rect = { x: box?.x ?? 0, y: box?.y ?? 0, width: box?.width ?? 0, height: box?.height ?? 0 };
    return (kind) => {
      const { onAddNote: addNote, onDiscuss: discuss } = noteRef.current;
      if (kind === 'gloss' && discuss) discuss(anchor.text, anchor.startOffset);
      else addNote(anchor.text, anchor.startOffset, rect);
    };
  }, [containerRef, textRootRef]);

  // The words selected here, as this text stores them: the highlighter's button applies its ink to them (A4).
  useEffect(() => {
    if (copyOnly) return;
    return registerInkTarget({
      holds: (range) => !!containerRef.current?.contains(range.commonAncestorContainer),
      read: (selection) => {
        const anchor = getInkAnchor(textRootRef?.current ?? containerRef.current, selection);
        if (!anchor) return null;
        // Read as the press starts, as the ink's words are: by the click the selection may be gone (a touch).
        const write = noteOn(selection);
        return {
          apply: (chosen) => {
            highlightRef.current(anchor.text, chosen, anchor.startOffset);
            hidePopup();
            window.getSelection()?.removeAllRanges();
          },
          ...(write ? {
            note: (kind: NoteKind) => {
              write(kind);
              hidePopup();
              window.getSelection()?.removeAllRanges();
            },
          } : {}),
        };
      },
    });
  }, [copyOnly, containerRef, textRootRef, hidePopup, noteOn]);

  // A tool on: the selection takes the ink, or opens a note's editor, as it is released, with no bar.
  useInkOnRelease(containerRef, tooling, (selection) => {
    if (noting) {
      const write = noteOn(selection);
      if (!write) return;
      write(noteKind);
      selection.removeAllRanges();
      return;
    }
    const anchor = getInkAnchor(textRootRef?.current ?? containerRef.current, selection);
    if (!anchor) return;
    highlightRef.current(anchor.text, ink, anchor.startOffset);
    selection.removeAllRanges();
  });
  // Turned on with the bar open: the bar goes, adjusted during render (gotcha 11), so it never comes back stale.
  const [wasTooling, setWasTooling] = useState(tooling);
  if (wasTooling !== tooling) {
    setWasTooling(tooling);
    if (tooling && popup.visible) setPopup((prev) => ({ ...prev, visible: false }));
  }
  // The text's cursor says the tool is on (`index.css`), the eraser's for «Nessun colore»: a class on the container,
  // never in the text (root rule 23).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !inking) return;
    container.classList.add('vlx-inking');
    container.dataset.ink = ink;
    return () => {
      container.classList.remove('vlx-inking');
      delete container.dataset.ink;
    };
  }, [containerRef, inking, ink]);

  const handleMouseUp = useCallback((event: Event) => {
    // A tool takes the selection itself (`useInkOnRelease`).
    if (tooling) return;
    // A press in the space open in the text (its buttons, a note's words) is not a selection of the text.
    if (event.target instanceof Node && inReaderSlot(event.target)) return;
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
      // A note anchors the words as selected; the highlighter takes them whole (A4).
      const inkAnchor = getInkAnchor(textRootRef?.current ?? containerRef.current, selection) ?? anchor;

      setPopup({
        visible: true,
        x: Math.max(80, Math.min(x, containerRect.width - 80)), // Keep within bounds
        y: Math.max(50, y), // Ensure not too high
        text: anchor.text,
        startOffset: anchor.startOffset,
        ink: inkAnchor,
        // Across a space open in the text, the words as seen hold the space's too: the article's alone, then.
        displayText: crossesSlot(range, textRootRef?.current ?? containerRef.current) ? anchor.text : rawSelected.trim(),
        ...placeOf(inPage ? blockOf(range.endContainer, textRootRef?.current ?? containerRef.current) : null, rect, containerRect, textRootRef?.current ?? containerRef.current),
      });
    }, 10);
  }, [containerRef, textRootRef, hidePopup, tooling, inPage]);

  // Moved sideways to stay 8 px inside the window, from its measured box, once drawn and again when it moves: the
  // position's clamp counts in the container, not the window, and a phone's edge once cut the popup (D7b). A style
  // written on the element, not state: nothing else draws again.
  useLayoutEffect(() => {
    const el = popupRef.current;
    if (!popup.visible || !el || (inPage && popup.under)) return;
    el.style.marginLeft = '0px';
    // The box drawn. The positioning element is `w-max` (absolute in a narrow container it shrank to the room left
    // while the box inside kept its width, and its centring took half the shrunk width: 149–398 in a 390 px window);
    // the box is measured all the same, should anything else ever size that element.
    const box = (el.firstElementChild ?? el).getBoundingClientRect();
    const margin = 8;
    let nudge = 0;
    if (box.left < margin) nudge = margin - box.left;
    else if (box.right > window.innerWidth - margin) nudge = window.innerWidth - margin - box.right;
    el.style.marginLeft = `${nudge}px`;
  }, [popup.visible, popup.x, popup.y, inPage, popup.under]);

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
      // Typed in a field (a note being written in a space open in the text, or anywhere else): not a shortcut.
      if (isEditableTarget(e.target)) return;
      if (e.key === 'Escape') {
        hidePopup();
        window.getSelection()?.removeAllRanges();
      } else if (e.key === 'h' && !copyOnly && !e.metaKey && !e.ctrlKey && !e.repeat) {
        // Quick highlight, with the ink chosen in the reading bar (H1), by the highlighter's rules (A4); once for a key
        // held down, whose repeats would come before the bar is gone (the owner's duplicates, 5 November)
        // Taken: the letter is not typed where the focus lands next.
        e.preventDefault();
        onHighlight(popup.ink.text, ink, popup.ink.startOffset);
        hidePopup();
        window.getSelection()?.removeAllRanges();
      } else if (e.key === 'n' && !copyOnly && !e.metaKey && !e.ctrlKey) {
        // Taken: the note's field opens with the focus, and would get the «n» (LC142, Papiniano on #717).
        e.preventDefault();
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
  }, [popup.visible, popup.text, popup.startOffset, popup.ink, popup.x, popup.y, onHighlight, onAddNote, copyOnly, hidePopup, ink]);

  // The live selection rect (viewport coords), read BEFORE the popup hides
  // and the selection is cleared (gotcha 16); falls back to the popup anchor.
  const captureSelectionRect = () => {
    const selRange = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).getBoundingClientRect() : null;
    const r = selRange ?? { x: popup.x, y: popup.y, width: 0, height: 0 };
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };

  const handleAction = (action: 'highlight' | 'note' | 'copy' | 'search' | 'report' | 'discuss' | 'card') => {
    switch (action) {
      // The ink chosen in the reading bar (H1, A4): never asked here.
      case 'highlight':
        onHighlight(popup.ink.text, ink, popup.ink.startOffset);
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

  const closeInPage = () => {
    hidePopup();
    window.getSelection()?.removeAllRanges();
  };
  const actions = (
    <div className="flex flex-wrap gap-1">
      {!copyOnly && (
        <>
          <Button
            variant="quiet"
            size="sm"
            onClick={() => handleAction('highlight')}
            title={ink === 'none' ? 'Togli l’evidenziazione (H)' : 'Evidenzia (H)'}
            aria-keyshortcuts="h"
            icon={ink === 'none' ? <Eraser size={16} aria-hidden /> : <Highlighter size={16} aria-hidden />}
          >
            {ink === 'none' ? 'Togli l’evidenziazione' : `Evidenzia in ${highlightColorName(ink)}`}
          </Button>
          <Button variant="quiet" size="sm" onClick={() => handleAction('note')} title="Aggiungi nota (N)" aria-keyshortcuts="n" icon={<StickyNote size={16} aria-hidden />}>
            Aggiungi nota
          </Button>
          {onDiscuss && (
            <Button variant="quiet" size="sm" onClick={() => handleAction('discuss')} icon={<MessageCircle size={16} aria-hidden />}>
              Discuti con i colleghi
            </Button>
          )}
          {onCreateCard && (
            <Button variant="quiet" size="sm" onClick={() => handleAction('card')} icon={<GraduationCap size={16} aria-hidden />}>
              Crea scheda
            </Button>
          )}
        </>
      )}
      <Button variant="quiet" size="sm" onClick={() => handleAction('copy')} title="Copia (Cmd+C)" icon={<Copy size={16} aria-hidden />}>
        Copia
      </Button>
      {onSearch && (
        <Button variant="quiet" size="sm" onClick={() => handleAction('search')} icon={<Search size={16} aria-hidden />}>
          Cerca
        </Button>
      )}
      {onReportCitation && !copyOnly && (
        <Button variant="quiet" size="sm" onClick={() => handleAction('report')} icon={<Flag size={16} aria-hidden />}>
          Segnala come citazione
        </Button>
      )}
    </div>
  );
  const quote = <span className="line-clamp-2">&ldquo;{popup.displayText || popup.text}&rdquo;</span>;

  if (inPage) {
    return (
      <>
        <BlockSpace
          // The same selection released again (a press on its own words) is the same space.
          value={popup.visible && popup.under ? `${popup.startOffset}:${popup.text.length}` : null}
          rootRef={textRootRef ?? containerRef}
          block={() => (popup.block?.isConnected ? popup.block : null)}
          onClose={closeInPage}
          title={() => 'Testo selezionato'}
          line={() => quote}
          // Into view only as far as the selected words stay in it. Drawn taller than the estimate (a phone's commands
          // on several rows) and past the bars at the foot even then, the actions go to the island, the page still.
          reveal={(space) => {
            const words = liveWordsBox() ?? popup.words;
            const view = viewOf(space);
            const bottom = space.getBoundingClientRect().bottom;
            if (!fitsInView(bottom, words.top, view)) {
              // Gone at once: under reduced motion its closing fade would leave an empty box pushing the text down.
              space.style.display = 'none';
              setPopup((prev) => ({ ...prev, under: false }));
              return;
            }
            scrollViewBy(space, revealBy(bottom, words.top, view));
          }}
        >
          {() => <div ref={popupRef}>{actions}</div>}
        </BlockSpace>
        <SelectionIsland
          open={popup.visible && !popup.under}
          words={popup.words}
          x={popup.x}
          top={popup.below}
          rootRef={containerRef}
          paragraph={() => {
            if (popup.block?.isConnected) return popup.block;
            const root = textRootRef?.current ?? containerRef.current;
            return root?.querySelectorAll<HTMLElement>(PARAGRAPHS)[popup.ordinal] ?? root;
          }}
          onClose={closeInPage}
          line={quote}
          islandRef={popupRef}
        >
          {actions}
        </SelectionIsland>
      </>
    );
  }

  if (!popup.visible) return null;

  return (
    <div
      ref={popupRef}
      className={cn(
        // As wide as what it holds, not as the room left in its container: centred on the selection as it is.
        'absolute w-max max-w-[calc(100vw-16px)] transform -translate-x-1/2 -translate-y-full',
        'animate-in fade-in zoom-in-95 duration-(--dur-pop)',
        Z_INDEX.floating
      )}
      style={{
        left: popup.x,
        top: popup.y
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Main popup */}
      <div className="bg-slate-900 dark:bg-slate-800 text-white rounded-[8px] shadow-md border border-slate-700 overflow-hidden">
        {/* Main actions */}
          <div className="flex items-center">
            {!copyOnly && (
              <>
                {/* bare-button: an icon of the selection's dark bar, dark in both themes. */}
                <button
                  onClick={() => handleAction('highlight')}
                  className="p-2.5 hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-sm"
                  title={ink === 'none' ? 'Togli l’evidenziazione (H)' : 'Evidenzia (H)'}
                  aria-label={ink === 'none' ? 'Togli l’evidenziazione' : `Evidenzia in ${highlightColorName(ink)}`}
                  aria-keyshortcuts="h"
                >
                  {/* In the colour it will take; «Nessun colore» is the eraser. */}
                  {ink === 'none'
                    ? <Eraser size={16} aria-hidden className="text-slate-200" />
                    : <Highlighter size={16} aria-hidden className={HIGHLIGHT_ICON_ON_DARK[ink]} />}
                </button>
                <div className="w-px h-5 bg-slate-700" />
                {/* bare-button: an icon of the selection's dark bar, dark in both themes. */}
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
                    {/* bare-button: an icon of the selection's dark bar, dark in both themes. */}
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
                    {/* bare-button: an icon of the selection's dark bar, dark in both themes. */}
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
            {/* bare-button: an icon of the selection's dark bar, dark in both themes. */}
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
                {/* bare-button: an icon of the selection's dark bar, dark in both themes. */}
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
                {/* bare-button: an icon of the selection's dark bar, dark in both themes. */}
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

/** The block a selection ends in, the space's place: an article's comma or item, a decision's paragraph. */
function blockOf(node: Node, root: HTMLElement | null): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : node.parentElement;
  const block = el?.closest<HTMLElement>(PARAGRAPHS) ?? null;
  return block && root?.contains(block) ? block : null;
}

/** Whether a range runs across a space open in the text (`BlockSpace`). */
function crossesSlot(range: Range, root: HTMLElement | null): boolean {
  return Array.from(root?.querySelectorAll(`[${READER_SLOT_ATTR}]`) ?? []).some((slot) => !!slot.textContent && range.intersectsNode(slot));
}

/** The live selection's box on screen, or null with none. */
function liveWordsBox(): DOMRect | null {
  const selection = window.getSelection();
  return selection && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0).getBoundingClientRect() : null;
}

/** Where the actions open: under the paragraph when its end is within about one view of the words (LC142, option A). */
function placeOf(block: HTMLElement | null, words: DOMRect, container: DOMRect, root: HTMLElement | null): Pick<PopupState, 'block' | 'under' | 'words' | 'below' | 'ordinal'> {
  const box = { top: words.top, right: words.right, bottom: words.bottom, left: words.left };
  const under = !!block && opensUnder(block.getBoundingClientRect().bottom, words.top, viewOf(block));
  const ordinal = block && root ? Array.from(root.querySelectorAll(PARAGRAPHS)).indexOf(block) : -1;
  return { block, under, words: box, below: words.bottom - container.top + 8, ordinal };
}

const PARAGRAPHS = '.vlx-b, .vlx-dec-para';

/**
 * The selection's actions where the paragraph goes on far below the words (LC142, Luca's option A; L-74's «strictly
 * necessary» exception): an island that grows from the words and sits under them, never over them; the page does not
 * move. The focus goes to it without scrolling; Esc and «Chiudi» clear the selection and give the focus to the
 * paragraph. One at a time with the spaces in the text.
 */
function SelectionIsland({ open, words, x, top, rootRef, paragraph, onClose, line, islandRef, children }: {
  open: boolean;
  words: { top: number; right: number; bottom: number; left: number };
  x: number;
  top: number;
  rootRef: React.RefObject<HTMLElement | null>;
  /** What takes the focus on closing: the paragraph the selection ended in. */
  paragraph: () => HTMLElement | null;
  onClose: () => void;
  line: React.ReactNode;
  islandRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  const headingId = useId();
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useOneSpaceAtATime(open, rootRef, el, onClose);
  // In, without moving the page; out, to the paragraph, if the focus was left in it or dropped to the page.
  const wasOpen = useRef(false);
  const gaveTo = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    // Drawn first, then focused: `el` comes with the commit that draws it.
    if (!el || open === wasOpen.current) return;
    wasOpen.current = open;
    const active = document.activeElement;
    if (open) el.focus({ preventScroll: true });
    else if (active === document.body || active === null || el.contains(active)) gaveTo.current = focusOn(paragraph());
    // `paragraph` reads the props of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, el]);
  // The paragraph redrawn after (a highlight saved later): the focus would fall to the page; it goes to the new one.
  // After every render on purpose: a redraw comes with no prop of this one.
  useLayoutEffect(() => {
    const given = gaveTo.current;
    if (!given || open) return;
    const active = document.activeElement;
    if (!given.isConnected && (active === document.body || active === null)) gaveTo.current = focusOn(paragraph());
    else if (active !== given) gaveTo.current = null;
  });
  if (!shown) return null;
  return (
    <div
      ref={(node) => { setEl(node); islandRef.current = node; }}
      role="region"
      aria-labelledby={headingId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className={cn('absolute w-max max-w-[min(32rem,calc(100vw-16px))] -translate-x-1/2 focus:outline-none', Z_INDEX.floating)}
      style={{ left: x, top }}
    >
      <IslandSurface
        open={open}
        onClosed={() => setShown(false)}
        source={() => words}
        timing={{ open: REPEAT_OPEN, close: REPEAT_CLOSE }}
        surfaceClassName={cn('border border-slate-200 bg-card shadow-lg dark:border-slate-700', CARD_RADIUS)}
        contentClassName={cn('relative', CARD_RADIUS)}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 py-2 pl-4 pr-2 font-sans dark:border-slate-700">
          <div className="min-w-0 pt-1.5">
            <h2 id={headingId} className="text-sm font-semibold text-slate-900 dark:text-white">Testo selezionato</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">{line}</p>
          </div>
          <IconButton onClick={onClose} aria-label="Chiudi" icon={<X aria-hidden />} variant="quiet" className="shrink-0" />
        </div>
        <div className="px-3 py-2 font-sans">{children}</div>
      </IslandSurface>
    </div>
  );
}
