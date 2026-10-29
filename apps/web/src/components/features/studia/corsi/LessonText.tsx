import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Highlighter, X } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { FOCUS_RING, INK_BG, ON_INK } from '../progress/tokens';
import { addSpan, numberLeaves, parseLesson, removeSpan, splitLeaf, type Inline, type LessonNode, type Span } from './lessonFormat';

/** The lesson's reading type: the reader's serif at a reading measure (as a card, a step larger: it is read at length). */
export const LESSON_TEXT = 'max-w-[65ch] break-words font-serif text-lg leading-[1.75] text-slate-900 dark:text-slate-100';

/** One colour for every highlight (§5, step 3), legible in both themes. */
const MARK = 'rounded-[2px] bg-amber-200 text-inherit dark:bg-amber-400/35';

/** The floating «Evidenzia» and «Togli»: 44 px, the ink key's colours. */
const FLOATING = cn(
  'absolute z-10 inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 font-sans text-sm font-semibold shadow-md',
  INK_BG,
  ON_INK,
  FOCUS_RING,
);

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

/** Where a floating button goes: under the rectangle, inside the text's box. */
function placeUnder(rect: DOMRect, box: HTMLElement): { top: number; left: number } {
  const frame = box.getBoundingClientRect();
  const left = Math.max(0, Math.min(rect.left - frame.left, frame.width - 160));
  return { top: rect.bottom - frame.top + 6, left };
}

type Floating = { kind: 'add'; span: Span; top: number; left: number } | { kind: 'remove'; start: number; top: number; left: number } | null;

/**
 * A block's text in the lesson's format (§10.3), drawn by the web's own parser: every character React text, never HTML.
 * A citation is a button that opens the cited norm or decision beside the text. With `spans`, the reader highlights for
 * the session (§5, step 3): words selected (by mouse, by touch, or from the keyboard: the text is a Tab stop, and Shift
 * with the arrows extends a selection from its start, a word at a time with Ctrl or Alt — `Selection.modify`, since a
 * text that is not editable has no caret of its own) bring «Evidenzia», a 44 px button under the selection, which Tab
 * from the text reaches next; a highlight pressed (a click, or Enter on it: each highlight is one Tab stop) brings
 * «Togli». One colour, no notes, nothing sent.
 */
export function LessonText({ text, spans, onSpans, onCite, citations, headingLevel = 3 }: LessonTextProps) {
  const nodes = useMemo(() => numberLeaves(parseLesson(text)), [text]);
  const root = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState<Floating>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // A finger on «Evidenzia»: a tap outside a selection collapses it on a phone before the click arrives, so the button
  // stays for the press it is under — until its click has been handled, or 400 ms after the release (a press dragged off
  // the button brings no click, and must not leave the button stuck on words no longer selected).
  const pressing = useRef(false);
  useEffect(() => {
    let timer = 0;
    const onUp = () => {
      if (!pressing.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        pressing.current = false;
      }, 400);
    };
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointerup', onUp);
      window.clearTimeout(timer);
    };
  }, []);
  const hintId = useId();
  const keysId = useId();
  const highlighting = spans !== undefined && onSpans !== undefined;

  // The selection's words, read as it changes; a selection that leaves the block (or collapses) takes the button away,
  // but not while the focus is on the button itself (Tab from the text keeps the selection in most browsers).
  useEffect(() => {
    if (!highlighting) return;
    const onSelection = () => {
      const el = root.current;
      const frame = box.current;
      const selection = document.getSelection();
      if (!el || !frame || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
        if (pressing.current) return;
        setFloating((f) => (f?.kind === 'add' && !frame?.contains(document.activeElement) ? null : f));
        return;
      }
      const range = selection.getRangeAt(0);
      const start = offsetAt(el, range.startContainer, range.startOffset);
      const end = offsetAt(el, range.endContainer, range.endOffset);
      if (start === null || end === null || end <= start) {
        setFloating((f) => (f?.kind === 'add' ? null : f));
        return;
      }
      setFloating({ kind: 'add', span: [start, end], ...placeUnder(range.getBoundingClientRect(), frame) });
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, [highlighting]);

  // «Togli» takes the focus as it appears, so Enter on a highlight and Enter again removes it.
  const removing = floating?.kind === 'remove' ? floating.start : null;
  useEffect(() => {
    if (removing !== null) removeButton.current?.focus({ preventScroll: true });
  }, [removing]);

  const add = (span: Span) => {
    if (!spans || !onSpans) return;
    pressing.current = false;
    onSpans(addSpan(spans, span));
    document.getSelection()?.removeAllRanges();
    setFloating(null);
    root.current?.focus({ preventScroll: true });
  };
  // From the keyboard: Shift and an arrow start a selection at the text's start when none is in it, then extend it.
  const onTextKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const el = root.current;
    if (!highlighting || !el) return;
    if (event.key === 'Tab' && !event.shiftKey && floating?.kind === 'add' && event.target === el) {
      event.preventDefault();
      addButton.current?.focus({ preventScroll: true });
      return;
    }
    const by = extendBy(event);
    const selection = document.getSelection();
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

  const remove = (start: number) => {
    if (!spans || !onSpans) return;
    onSpans(removeSpan(spans, start));
    setFloating(null);
    root.current?.focus({ preventScroll: true });
  };
  const offerRemoval = (start: number, target: HTMLElement) => {
    const frame = box.current;
    if (!frame) return;
    setFloating({ kind: 'remove', start, ...placeUnder(target.getBoundingClientRect(), frame) });
  };

  // Each leaf carries its offset in the plain text (`numberLeaves`); a highlight's first piece is its one Tab stop.
  const firstPiece = new Set<number>();
  const leaf = (value: string, from: number, key: string): ReactNode =>
    splitLeaf(value, from, spans ?? []).map((piece) => {
      if (piece.highlight === null) {
        return (
          <span key={`${key}-${piece.at}`} data-o={piece.at}>
            {piece.text}
          </span>
        );
      }
      // One Tab stop per highlight, on its first piece; every piece answers a click.
      const first = !firstPiece.has(piece.highlight);
      firstPiece.add(piece.highlight);
      const start = piece.highlight;
      return (
        <mark
          key={`${key}-${piece.at}`}
          data-o={piece.at}
          data-highlight={start}
          className={cn(MARK, highlighting && 'cursor-pointer', first && highlighting && FOCUS_RING)}
          {...(highlighting && first ? { tabIndex: 0, 'aria-describedby': hintId } : {})}
          onClick={highlighting ? (event) => offerRemoval(start, event.currentTarget) : undefined}
          onKeyDown={
            highlighting && first
              ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    offerRemoval(start, event.currentTarget);
                  }
                }
              : undefined
          }
        >
          {piece.text}
        </mark>
      );
    });
  const inline = (items: Inline[], key: string): ReactNode =>
    items.map((item, i) => {
      const k = `${key}.${i}`;
      switch (item.kind) {
        case 'text':
          return <Fragment key={k}>{leaf(item.text, item.at ?? 0, k)}</Fragment>;
        case 'strong':
          return <strong key={k} className="font-semibold">{inline(item.children, k)}</strong>;
        case 'em':
          return <em key={k}>{inline(item.children, k)}</em>;
        case 'cite': {
          const label = citations?.get(item.marker);
          if (!onCite || label === undefined) return <Fragment key={k}>{inline(item.children, k)}</Fragment>;
          return (
            <button
              key={k}
              type="button"
              onClick={(event) => onCite(item.marker, event.currentTarget)}
              title={label}
              className={cn(
                'rounded-sm text-left text-primary-800 underline decoration-primary-400 decoration-1 underline-offset-[3px] hover:decoration-2 dark:text-primary-200',
                FOCUS_RING,
              )}
            >
              {inline(item.children, k)}
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
    <div
      ref={box}
      className="relative"
      // Esc takes the floating button away first, wherever the focus is in the text or on it; the lesson's Esc waits.
      onKeyDown={(event) => {
        if (event.key === 'Escape' && floating) {
          event.stopPropagation();
          setFloating(null);
          root.current?.focus({ preventScroll: true });
        }
      }}
    >
      <div
        ref={root}
        tabIndex={highlighting ? 0 : undefined}
        aria-describedby={highlighting ? keysId : undefined}
        data-lesson-text
        onKeyDown={onTextKeyDown}
        className={cn(LESSON_TEXT, 'space-y-4 rounded-sm', highlighting ? FOCUS_RING : 'focus:outline-none')}
      >
        {nodes.map(block)}
      </div>
      {highlighting && (
        <>
          <p id={hintId} className="sr-only">
            Evidenziato. Premi Invio per toglierlo.
          </p>
          <p id={keysId} className="sr-only">
            Per evidenziare, seleziona con Maiusc e le frecce, poi premi Tab per «Evidenzia».
          </p>
        </>
      )}
      {floating?.kind === 'add' && (
        <button
          ref={addButton}
          type="button"
          // A press must not take the selection away before the click reads it.
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={() => {
            pressing.current = true;
          }}
          onPointerCancel={() => {
            pressing.current = false;
          }}
          onClick={() => add(floating.span)}
          className={FLOATING}
          style={{ top: floating.top, left: floating.left }}
        >
          <Highlighter size={16} aria-hidden />
          Evidenzia
        </button>
      )}
      {floating?.kind === 'remove' && (
        <button
          type="button"
          ref={removeButton}
          onClick={() => remove(floating.start)}
          onBlur={(event) => {
            if (!box.current?.contains(event.relatedTarget as Node | null)) setFloating(null);
          }}
          className={FLOATING}
          style={{ top: floating.top, left: floating.left }}
        >
          <X size={16} aria-hidden />
          Togli
        </button>
      )}
    </div>
  );
}
