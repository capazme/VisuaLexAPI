import { Fragment, useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { cn } from '../../../../lib/utils';
import { useAppStore } from '../../../../store/useAppStore';
import { HIGHLIGHT_COLORS, highlightColorName, HIGHLIGHT_STYLES, parseInlineStyle, type HighlightColor } from '../../../../utils/highlightColors';
import { registerInkTarget } from '../../../../utils/inkTargets';
import { inkRange, keepExact } from '../../../../utils/inkSelection';
import type { Ink } from '../../../../utils/highlighterRules';
import { useInkOnRelease } from '../../../../hooks/useInkOnRelease';
import { announce, offerShortcutUndo } from '../../../ui/notifications/notifications';
import { useHighlighterInk } from '../../../../hooks/useHighlighterInk';
import { HighlighterButton } from '../../search/HighlighterButton';
import { FOCUS_RING, INK_TEXT } from '../progress/tokens';
import { lineStarts, numberLeaves, paintSpans, parseLesson, plainText, spanColor, splitLeaf, type Inline, type LessonNode, type Span } from './lessonFormat';

/** The lesson's reading type: the reader's serif at a reading measure (as a card, a step larger: it is read at length). */
export const LESSON_TEXT = 'max-w-measure break-words font-serif text-lg leading-[1.75] text-slate-900 dark:text-slate-100';

/** A highlight's look: the reader's own tint and ink for its colour (A4), legible in both themes. */
const MARK_STYLE: Record<HighlightColor, React.CSSProperties> = {
  yellow: parseInlineStyle(HIGHLIGHT_STYLES.yellow),
  green: parseInlineStyle(HIGHLIGHT_STYLES.green),
  red: parseInlineStyle(HIGHLIGHT_STYLES.red),
  blue: parseInlineStyle(HIGHLIGHT_STYLES.blue),
};
const MARK = 'rounded-[2px]';

/** The highlighter over the text: the bars' quiet look, 44 px at every width (`corsi.guard.test.ts`). */
const TOOL = 'min-h-[44px] min-w-[44px] gap-1.5 rounded-lg px-2.5 text-slate-600 hover:bg-slate-100 md:min-w-[44px] dark:text-slate-300 dark:hover:bg-slate-800';

interface LessonTextProps {
  text: string;
  /** The session's highlights on this block; absent, the text takes none (the recall's comparison takes them, the preview too). */
  spans?: readonly Span[];
  onSpans?: (spans: Span[]) => void;
  /** A citation pressed: its marker (`c1`) and its button, which the focus goes back to; absent, citations are plain text. */
  onCite?: (marker: string, opener: HTMLElement) => void;
  /** The citations the block can open, by marker, with their labels; a marker missing here stays text. */
  citations?: ReadonlyMap<string, string>;
  /** The level of the lesson's `###`: one under the heading the text sits under (2 under the step's `h1`). */
  headingLevel?: 2 | 3;
}

/** The characters highlighted: a gesture that lowers it took highlights away. */
const covered = (spans: readonly Span[]) => spans.reduce((sum, [start, end]) => sum + end - start, 0);

/** The same highlights, a colour left out by an older save read as yellow. */
const sameSpans = (a: readonly Span[], b: readonly Span[]) =>
  a.length === b.length && a.every((span, i) => span[0] === b[i][0] && span[1] === b[i][1] && spanColor(span) === spanColor(b[i]));

/** What a gesture did, as a reader's says it (A4): to a screen reader, and «Annullato: …» once undone. */
function gestureMessage(before: readonly Span[], after: readonly Span[], ink: Ink): string {
  if (ink === 'none' || covered(after) < covered(before)) return 'Evidenziazione rimossa';
  const name = highlightColorName(ink);
  return covered(after) === covered(before) ? `Evidenziazione cambiata in ${name}` : `Testo evidenziato in ${name}`;
}

/** Shift and an arrow: what `Selection.modify` extends by (a word with Ctrl or Alt, as the reader's move bar does). */
function extendBy(event: React.KeyboardEvent): { direction: 'forward' | 'backward'; granularity: 'character' | 'word' | 'line' } | null {
  if (!event.shiftKey || event.metaKey) return null;
  const word = event.ctrlKey || event.altKey;
  switch (event.key) {
    case 'ArrowRight':
      return { direction: 'forward', granularity: word ? 'word' : 'character' };
    case 'ArrowLeft':
      return { direction: 'backward', granularity: word ? 'word' : 'character' };
    case 'ArrowDown':
      return { direction: 'forward', granularity: 'line' };
    case 'ArrowUp':
      return { direction: 'backward', granularity: 'line' };
    default:
      return null;
  }
}

/** Where a selection's edge falls in the block's plain text: a text node's own place, or the text after an element edge. */
function offsetAt(root: HTMLElement, node: Node, offset: number): number | null {
  if (!root.contains(node)) return null;
  if (node.nodeType === Node.TEXT_NODE) {
    const host = node.parentElement?.closest<HTMLElement>('[data-o]');
    return host && root.contains(host) ? Number(host.dataset.o) + offset : null;
  }
  const point = document.createRange();
  point.setStart(node, offset);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let last: number | null = null;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const host = text.parentElement?.closest<HTMLElement>('[data-o]');
    if (!host) continue;
    const start = Number(host.dataset.o);
    if (point.comparePoint(text, 0) >= 0) return start;
    last = start + (text.textContent ?? '').length;
  }
  return last;
}

/** The selection's `[start, end)` in the block's plain text, when it lies in the text: whole words, or the piece exactly
 * with Alt, as the highlighter takes them (A4). */
function selectedSpan(root: HTMLElement, selection: Selection): readonly [number, number] | null {
  const range = inkRange(root, selection);
  if (!range) return null;
  const start = offsetAt(root, range.startContainer, range.startOffset);
  const end = offsetAt(root, range.endContainer, range.endOffset);
  return start !== null && end !== null && end > start ? [start, end] : null;
}

/**
 * A block's text in the lesson's format (§10.3), drawn by the web's own parser: every character React text, never HTML.
 * A citation is a button that opens the cited norm or decision beside the text. With `spans`, the reader highlights for
 * the session (§5, step 3) with the reader's highlighter (A4, spec `2026-11-03-a4-highlighter-and-notes-design` §4): the
 * same button over the text, the same rules (`paintSpans`: the same colour over a highlight takes the piece away,
 * another colour paints over, «Nessun colore» clears) and the same tool, on which every selection takes the ink as it is
 * released. Words selected by mouse, by touch, or from the keyboard (the text is a Tab stop, and Shift with the arrows
 * extends a selection from its start, a word at a time with Ctrl or Alt — `Selection.modify`, since a text that is not
 * editable has no caret of its own) take it from the button, or from H. Each highlight is one Tab stop, where Enter
 * selects its words. Inside a citation's button a highlight is drawn but takes no press (nothing interactive in a
 * button): its pieces outside the citation carry the Tab stop. Four colours, no notes, nothing sent.
 */
export function LessonText({ text, spans, onSpans, onCite, citations, headingLevel = 3 }: LessonTextProps) {
  const nodes = useMemo(() => numberLeaves(parseLesson(text)), [text]);
  // What the offsets count in, and where its lines start: highlights of one colour apart by spaces alone, on one line,
  // are one (A4).
  const words = useMemo(() => ({ plain: plainText(nodes), breaks: lineStarts(nodes) }), [nodes]);
  const root = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const keysId = useId();
  const highlighting = spans !== undefined && onSpans !== undefined;
  const ink = useHighlighterInk();
  const inking = useAppStore((s) => s.readingTool === 'highlight') && highlighting;

  // The highlights and their handler as they are now, for the listeners below.
  const latest = useRef({ spans, onSpans, words });
  useEffect(() => {
    latest.current = { spans, onSpans, words };
  });
  /**
   * The ink over the words selected in the text: painted, the selection cleared, the focus back on the text. As a
   * reader's gesture (A4, 5 November): no notice, said to a screen reader, and Ctrl+Z (⌘Z) puts the highlights back as
   * they were while it is the last gesture and the text is on screen. One that changes nothing says nothing.
   */
  const paint = (span: readonly [number, number], chosen: Ink) => {
    const { spans: now, onSpans: set, words: text } = latest.current;
    if (!now || !set) return;
    const next = paintSpans(now, span, chosen, text);
    document.getSelection()?.removeAllRanges();
    root.current?.focus({ preventScroll: true });
    if (sameSpans(next, now)) return;
    set(next);
    const message = gestureMessage(now, next, chosen);
    offerShortcutUndo({
      message,
      ready: () => root.current?.isConnected === true,
      undo: () => latest.current.onSpans?.([...now]),
    });
    announce(message);
  };
  const paintRef = useRef(paint);
  useEffect(() => {
    paintRef.current = paint;
  });

  // The words selected here, for the highlighter's button.
  useEffect(() => {
    if (!highlighting) return;
    return registerInkTarget({
      holds: (range) => !!root.current?.contains(range.commonAncestorContainer),
      read: (selection) => {
        const el = root.current;
        const span = el ? selectedSpan(el, selection) : null;
        return span ? { apply: (chosen) => paintRef.current(span, chosen) } : null;
      },
    });
  }, [highlighting]);

  // The tool on: the selection takes the ink as it is released; the text takes the highlighter's cursor.
  useInkOnRelease(root, inking, (selection) => {
    const el = root.current;
    const span = el ? selectedSpan(el, selection) : null;
    if (span) paint(span, ink);
  });

  // From the keyboard: Shift and an arrow start a selection at the text's start when none is in it, then extend it;
  // H applies the ink to the words selected, as the reader's selection bar does.
  const onTextKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const el = root.current;
    if (!highlighting || !el) return;
    const selection = document.getSelection();
    if (event.key.toLowerCase() === 'h' && !event.metaKey && !event.ctrlKey && !event.altKey && selection) {
      // A key held down highlights once.
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      const span = selectedSpan(el, selection);
      if (!span) return;
      event.preventDefault();
      paint(span, ink);
      return;
    }
    const by = extendBy(event);
    if (!by || event.target !== el || !selection || typeof selection.modify !== 'function') return;
    event.preventDefault();
    const inside = selection.rangeCount > 0 && el.contains(selection.getRangeAt(0).commonAncestorContainer);
    if (!inside) {
      const first = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
      if (!first) return;
      selection.collapse(first, 0);
    }
    selection.modify('extend', by.direction, by.granularity);
  };

  /** Enter on a highlight: its words selected, every piece of it, so H or the highlighter's menu acts on them. */
  const selectHighlight = (start: number) => {
    const pieces = root.current?.querySelectorAll<HTMLElement>(`mark[data-highlight="${start}"]`);
    const first = pieces?.[0]?.firstChild;
    const last = pieces?.[pieces.length - 1]?.lastChild;
    const selection = document.getSelection();
    if (!first || !last || !selection) return;
    selection.setBaseAndExtent(first, 0, last, (last.textContent ?? '').length);
    // Its words as they are, never widened: a piece taken with Alt is acted on as it is.
    keepExact(selection);
  };

  // Each leaf carries its offset in the plain text (`numberLeaves`); a highlight's first piece is its one Tab stop.
  const firstPiece = new Set<number>();
  const leaf = (value: string, from: number, key: string, inButton: boolean): ReactNode =>
    splitLeaf(value, from, spans ?? []).map((piece) => {
      if (piece.highlight === null || piece.color === null) {
        return (
          <span key={`${key}-${piece.at}`} data-o={piece.at}>
            {piece.text}
          </span>
        );
      }
      // One Tab stop per highlight, on its first piece outside a citation. Inside a citation's button a piece is only
      // drawn: nothing interactive may sit in a button.
      const start = piece.highlight;
      const color = piece.color;
      const first = !inButton && !firstPiece.has(start);
      if (first) firstPiece.add(start);
      return (
        <mark
          key={`${key}-${piece.at}`}
          data-o={piece.at}
          data-highlight={start}
          data-color={color}
          className={cn(MARK, first && highlighting && FOCUS_RING)}
          style={MARK_STYLE[color]}
          // No name on a `mark` (ARIA forbids one): its colour and what Enter does are its description.
          {...(highlighting && first ? { tabIndex: 0, 'aria-describedby': `${hintId}-${color}` } : {})}
          onKeyDown={
            highlighting && first
              ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectHighlight(start);
                  }
                }
              : undefined
          }
        >
          {piece.text}
        </mark>
      );
    });
  const inline = (items: Inline[], key: string, inButton = false): ReactNode =>
    items.map((item, i) => {
      const k = `${key}.${i}`;
      switch (item.kind) {
        case 'text':
          return <Fragment key={k}>{leaf(item.text, item.at ?? 0, k, inButton)}</Fragment>;
        case 'strong':
          return <strong key={k} className="font-semibold">{inline(item.children, k, inButton)}</strong>;
        case 'em':
          return <em key={k}>{inline(item.children, k, inButton)}</em>;
        case 'cite': {
          const label = citations?.get(item.marker);
          if (!onCite || label === undefined) return <Fragment key={k}>{inline(item.children, k)}</Fragment>;
          return (
            <button
              key={k}
              type="button"
              onClick={(event) => onCite(item.marker, event.currentTarget)}
              title={label}
              // Its words can be selected like the rest of the text, so a highlight inside it can be taken away.
              className={cn('select-text rounded-sm text-left underline decoration-current/50 decoration-1 underline-offset-[3px] hover:decoration-2', INK_TEXT, FOCUS_RING)}
            >
              {inline(item.children, k, true)}
              <span className="sr-only"> (apri {label})</span>
            </button>
          );
        }
      }
    });
  const block = (node: LessonNode, i: number): ReactNode => {
    const k = `b${i}`;
    switch (node.kind) {
      case 'p':
        return <p key={k}>{inline(node.inline, k)}</p>;
      case 'h3': {
        const Heading = headingLevel === 2 ? 'h2' : 'h3';
        return (
          <Heading key={k} className="pt-2 font-serif text-xl font-medium tracking-tight">
            {inline(node.inline, k)}
          </Heading>
        );
      }
      case 'ul':
        return (
          <ul key={k} className="list-disc space-y-1 pl-6 marker:text-slate-400">
            {node.items.map((item, j) => (
              <li key={j}>{inline(item, `${k}.${j}`)}</li>
            ))}
          </ul>
        );
      case 'ol':
        return (
          <ol key={k} start={node.start} className="list-decimal space-y-1 pl-6 marker:text-slate-500">
            {node.items.map((item, j) => (
              <li key={j}>{inline(item, `${k}.${j}`)}</li>
            ))}
          </ol>
        );
      case 'quote':
        return (
          <blockquote key={k} className="space-y-3 border-l-2 border-slate-300 pl-4 text-slate-700 dark:border-slate-600 dark:text-slate-300">
            {node.paragraphs.map((p, j) => (
              <p key={j}>{inline(p, `${k}.${j}`)}</p>
            ))}
          </blockquote>
        );
    }
  };

  return (
    <div className="relative">
      {/* The reader's highlighter, over the text it acts on; the colours' meanings stay in Impostazioni. */}
      {highlighting && (
        <div className="mb-2 flex justify-end font-sans">
          <HighlighterButton meaningsGear={false} placement="auto" triggerClassName={TOOL} />
        </div>
      )}
      <div
        ref={root}
        tabIndex={highlighting ? 0 : undefined}
        aria-describedby={highlighting ? keysId : undefined}
        data-lesson-text
        data-ink={inking ? ink : undefined}
        onKeyDown={onTextKeyDown}
        className={cn(LESSON_TEXT, 'space-y-4 rounded-sm', highlighting ? FOCUS_RING : 'focus:outline-none', inking && 'vlx-inking')}
      >
        {nodes.map(block)}
      </div>
      {highlighting && (
        <>
          {HIGHLIGHT_COLORS.map((color) => (
            <p key={color} id={`${hintId}-${color}`} className="sr-only">
              Evidenziato in {highlightColorName(color)}. Invio seleziona queste parole: H, con il loro colore, toglie l’evidenziazione.
            </p>
          ))}
          <p id={keysId} className="sr-only">
            Per evidenziare, seleziona con Maiusc e le frecce, poi premi H. Il colore si sceglie con l’evidenziatore sopra il testo.
          </p>
        </>
      )}
    </div>
  );
}
