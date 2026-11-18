import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { ArticleDiscussionThread } from '../../../types';
import type { LocatedThread } from '../../../utils/articleAnnotations';
import { cn } from '../../../lib/utils';
import { ease } from '../../../lib/motion';
import { placeGlossCards } from '../../../utils/glossLayout';
import { rangeFromPlainOffsets } from '../../../utils/selectionOffset';

/** Where the glosses on a passage are measured against: the text on screen and where each passage lands in it. */
export interface GlossAlignment {
  /** The reader's text root (the one `located`'s offsets count in). */
  textRootRef: RefObject<HTMLElement | null>;
  /** The passages that land in the text on screen. */
  located: readonly LocatedThread[];
  /** The HTML on screen: a redraw moves the words, the glosses follow. */
  contentKey: string;
}

interface Props extends GlossAlignment {
  /** The glosses on a passage, in any order: drawn in the order of the text, those not found under the last one. */
  threads: readonly ArticleDiscussionThread[];
  /** The gloss chosen (its passage lit in the text): the thread joins it to its words. */
  litId: string | null;
  render: (thread: ArticleDiscussionThread) => ReactNode;
}

type Wire = { id: string; d: string };

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The glosses on a passage in the margin beside the text (LC90), as a word processor's comments: each at the height of
 * the first line of its words (read from a DOM range, nothing added to the text), pushed down under the one above when
 * they would overlap (`placeGlossCards`, as `AnnotationMargin`). Placed again when the text is drawn again, when it or
 * the margin changes size (a narrower window, a gloss opened above), and when a gloss grows (its replies opened). The
 * chosen gloss is joined to its words by a thin thread, from the text's right edge at its line to the card: the only
 * decoration, drawn in 200 ms, at once under reduced motion.
 */
export function AlignedGlosses({ threads, located, textRootRef, contentKey, litId, render }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const at = new Map(located.map((l) => [l.thread.id, l]));
  // Those found, in the order of the text; the others after them, as they came.
  const startOf = (thread: ArticleDiscussionThread) => at.get(thread.id)?.start ?? Number.MAX_SAFE_INTEGER;
  const ordered = [...threads].sort((x, y) => startOf(x) - startOf(y));
  const orderKey = ordered.map((t) => `${t.id}:${at.get(t.id)?.start ?? ''}-${at.get(t.id)?.end ?? ''}`).join('|');

  const [layout, setLayout] = useState<{ tops: Record<string, number>; height: number; wire: Wire | null } | null>(null);
  const latest = useRef({ ordered, at, litId });
  useLayoutEffect(() => { latest.current = { ordered, at, litId }; });

  const measure = useCallback(() => {
    const list = listRef.current;
    const root = textRootRef.current;
    if (!list || !root) return;
    const { ordered: items, at: where, litId: lit } = latest.current;
    const box = list.getBoundingClientRect();
    let previous = 0;
    const lines = new Map<string, DOMRect>();
    const slots = items.map((thread) => {
      const words = where.get(thread.id);
      const rect = words ? rangeFromPlainOffsets(root, words.start, words.end)?.getClientRects?.()[0] : undefined;
      if (rect) lines.set(thread.id, rect);
      // Words with no box: under the gloss before it, never at the top.
      const want = rect ? rect.top - box.top : previous;
      previous = want;
      return { id: thread.id, want, height: cards.current.get(thread.id)?.offsetHeight ?? 0 };
    });
    const placed = placeGlossCards(slots);
    const line = lit ? lines.get(lit) : undefined;
    let wire: Wire | null = null;
    if (lit && line && placed.tops[lit] !== undefined) {
      // From the text's right edge at the middle of its line, across the gap, down to the card if it was pushed.
      const from = { x: Math.round(root.getBoundingClientRect().right - box.left), y: Math.round(line.top + line.height / 2 - box.top) };
      const to = { x: 0, y: Math.round(placed.tops[lit] + line.height / 2) };
      const bend = Math.round(from.x / 2);
      wire = { id: lit, d: from.y === to.y ? `M${from.x} ${from.y}H${to.x}` : `M${from.x} ${from.y}H${bend}V${to.y}H${to.x}` };
    }
    setLayout((prev) => (prev && prev.height === placed.height && prev.wire?.d === wire?.d && prev.wire?.id === wire?.id
      && slots.every((s) => prev.tops[s.id] === placed.tops[s.id]) ? prev : { ...placed, wire }));
  }, [textRootRef]);

  const frame = useRef(0);
  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(measure);
  }, [measure]);
  useLayoutEffect(() => {
    schedule();
    return () => cancelAnimationFrame(frame.current);
  }, [schedule, contentKey, orderKey, litId]);

  // The text and the margin resized (the window, a gloss opened above these), and every gloss (its replies opened).
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(schedule);
    if (textRootRef.current) observer.observe(textRootRef.current);
    const margin = listRef.current?.parentElement;
    if (margin) observer.observe(margin);
    for (const card of cards.current.values()) observer.observe(card);
    return () => observer.disconnect();
  }, [schedule, textRootRef, contentKey, orderKey]);

  // A gloss's first place is taken at once (it would slide down from the top); its moves after, smoothly.
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!layout) return undefined;
    const placed = Object.keys(layout.tops);
    if (placed.every((id) => settled.has(id))) return undefined;
    const handle = requestAnimationFrame(() => setSettled(new Set(placed)));
    return () => cancelAnimationFrame(handle);
  }, [layout, settled]);

  // The thread drawn from the text to the card when a gloss is chosen; under reduced motion it is simply there.
  const wireRef = useRef<SVGPathElement>(null);
  const wireId = layout?.wire?.id ?? null;
  useLayoutEffect(() => {
    const path = wireRef.current;
    if (!wireId || !path || typeof path.animate !== 'function' || reduced()) return;
    path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 200, easing: `cubic-bezier(${ease.out.join(', ')})` });
  }, [wireId]);

  return (
    <div ref={listRef} data-gloss-aligned="" className="relative" style={layout ? { height: layout.height } : undefined}>
      {ordered.map((thread) => {
        const top = layout?.tops[thread.id];
        return (
          <div
            key={thread.id}
            ref={(el) => { if (el) cards.current.set(thread.id, el); else cards.current.delete(thread.id); }}
            // Transparent, not hidden, until placed: a hidden gloss would refuse a focus given meanwhile.
            className={cn('vlx-gloss-card', top === undefined && 'pointer-events-none opacity-0', !settled.has(thread.id) && 'vlx-gloss-card-fresh')}
            style={top === undefined ? undefined : { transform: `translateY(${top}px)` }}
          >
            <div data-gloss-row="">{render(thread)}</div>
          </div>
        );
      })}
      {layout?.wire && (
        <svg aria-hidden="true" data-gloss-wire={layout.wire.id} className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
          <path ref={wireRef} d={layout.wire.d} pathLength={1} strokeDasharray="1" fill="none" strokeWidth={1} style={{ stroke: 'hsl(var(--primary) / 0.55)' }} />
        </svg>
      )}
    </div>
  );
}
