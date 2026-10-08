import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { collectSearchableText, findMatches, isSearchableQuery, rangesForMatches } from '../utils/findInText';
import { clearFindRanges, setFindRanges } from '../utils/findHighlights';

const DEBOUNCE_MS = 150;

export interface FindInText {
  /** Matches drawn (at most 1000). */
  count: number;
  /** Zero-based index of the current match, -1 when there is none. */
  index: number;
  /** More than the limit matched; only the first ones are drawn. */
  truncated: boolean;
  /** The applied query was long enough to search: tells «Nessun risultato» from «nothing typed». */
  searched: boolean;
  next: () => void;
  previous: () => void;
}

interface FindState {
  count: number;
  index: number;
  truncated: boolean;
  searched: boolean;
}

/**
 * Where `pos` of `oldText` sits in `newText`: unchanged before the common prefix, shifted by the length difference
 * after the common suffix, and at the start of the change when it falls inside what changed.
 */
function mapThroughEdit(oldText: string, newText: string, pos: number): number {
  const max = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < max && oldText[prefix] === newText[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < max - prefix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix += 1;
  if (pos < prefix) return pos;
  if (pos >= oldText.length - suffix) return pos + newText.length - oldText.length;
  return prefix;
}

const EMPTY: FindState = { count: 0, index: -1, truncated: false, searched: false };

/**
 * Find in the text of the element `rootRef` points to. The hook reads the
 * root's text nodes and paints through the highlight registry; it adds,
 * moves and changes nothing in the DOM (root rule 23). Typing is debounced,
 * navigation is not: `next`/`previous` first apply a query still waiting.
 */
export function useFindInText(
  rootRef: RefObject<HTMLElement | null>,
  // `open: false` is part of the hook's API (nothing is searched or drawn); the find box always passes true because it is mounted only while open.
  { open, query }: { open: boolean; query: string },
): FindInText {
  const ownerId = `find-${useId()}`;
  const [state, setState] = useState<FindState>(EMPTY);
  const stateRef = useRef<FindState>(EMPTY);
  const setLatest = useCallback((next: FindState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const rangesRef = useRef<Range[]>([]);
  const indexRef = useRef(-1);
  /** Start offset of every drawn match in the search string: how the current match is recognised after a redraw. */
  const startsRef = useRef<number[]>([]);
  /** The search string of the last run: a redraw maps the current match through what changed in it. */
  const textRef = useRef('');
  const appliedRef = useRef('');
  const queryRef = useRef(query);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const scrollToCurrent = useCallback(() => {
    const range = rangesRef.current[indexRef.current];
    const el = range?.startContainer.parentElement;
    el?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  }, []);

  const commit = useCallback(
    (ranges: Range[], starts: number[], index: number, truncated: boolean, searched: boolean, scroll: boolean) => {
      rangesRef.current = ranges;
      startsRef.current = starts;
      indexRef.current = index;
      // The ranges may sit on new nodes even when nothing moved: the registry always gets them.
      setFindRanges(ownerId, ranges, index >= 0 ? ranges[index] : null);
      // Nothing a reader sees changed (same count, current match, flags): no render.
      const prev = stateRef.current;
      if (
        prev.count !== ranges.length ||
        prev.index !== index ||
        prev.truncated !== truncated ||
        prev.searched !== searched
      ) {
        setLatest({ count: ranges.length, index, truncated, searched });
      }
      if (scroll && index >= 0) scrollToCurrent();
    },
    [ownerId, scrollToCurrent, setLatest],
  );

  /** Search `q` in the root now; `keep` leaves the current match where it still is (same start, else the next one). */
  const run = useCallback(
    (q: string, keep: boolean) => {
      appliedRef.current = q;
      const root = rootRef.current;
      if (!root) {
        commit([], [], -1, false, false, false);
        return;
      }
      const collected = collectSearchableText(root);
      const { matches, truncated } = findMatches(collected.text, q);
      const ranges = rangesForMatches(collected.nodes, matches);
      const segmentStart = new Map(collected.nodes.map((seg) => [seg.node, seg.start] as const));
      const starts = ranges.map((r) => (segmentStart.get(r.startContainer as Text) ?? 0) + r.startOffset);
      let index = ranges.length ? 0 : -1;
      let scroll = true;
      const previous = indexRef.current >= 0 ? startsRef.current[indexRef.current] : undefined;
      if (keep && previous !== undefined && ranges.length) {
        // The old start, carried through the edit of the text before it: the same match, or the first after it.
        const oldStart = mapThroughEdit(textRef.current, collected.text, previous);
        const after = starts.findIndex((v) => v >= oldStart);
        index = after >= 0 ? after : 0;
        scroll = starts[index] !== oldStart;
      }
      textRef.current = collected.text;
      commit(ranges, starts, index, truncated, isSearchableQuery(q), scroll);
    },
    [rootRef, commit],
  );

  /** Apply a query still waiting; true when there was one. */
  const flush = useCallback((): boolean => {
    if (timerRef.current === null) return false;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    run(queryRef.current, false);
    return true;
  }, [run]);

  // Typing: apply the query after a pause.
  useEffect(() => {
    if (!open || query === appliedRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      run(query, false);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [open, query, run]);

  // The text under the root changes (a version loads, a note folds, a class hides text): search again.
  useEffect(() => {
    const root = rootRef.current;
    if (!open || !root || typeof MutationObserver === 'undefined') return;
    let frame: number | null = null;
    const observer = new MutationObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (timerRef.current === null && isSearchableQuery(appliedRef.current)) run(appliedRef.current, true);
      });
    });
    // Attributes too: a class or style that hides or shows text (a folded note) changes what is searchable.
    observer.observe(root, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
    });
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [open, rootRef, run]);

  // Closed or unmounted: nothing stays drawn.
  useEffect(() => {
    if (!open) return;
    return () => {
      clearFindRanges(ownerId);
      rangesRef.current = [];
      indexRef.current = -1;
      startsRef.current = [];
      textRef.current = '';
      appliedRef.current = '';
      setLatest(EMPTY);
    };
  }, [open, ownerId, setLatest]);

  const step = useCallback(
    (delta: 1 | -1) => {
      // A fresh query lands on its first match: that is where the move ends.
      if (flush()) return;
      const n = rangesRef.current.length;
      if (n === 0) return;
      const index = (indexRef.current + delta + n) % n;
      indexRef.current = index;
      setFindRanges(ownerId, rangesRef.current, rangesRef.current[index]);
      setLatest({ ...stateRef.current, index });
      scrollToCurrent();
    },
    [flush, ownerId, scrollToCurrent, setLatest],
  );

  const next = useCallback(() => step(1), [step]);
  const previous = useCallback(() => step(-1), [step]);

  return { ...state, next, previous };
}
