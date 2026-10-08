import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { collectSearchableText, findMatches, rangesForMatches } from '../utils/findInText';
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

const EMPTY: FindState = { count: 0, index: -1, truncated: false, searched: false };

/** Where a match sits, to recognise it after the text is searched again. */
interface Anchor {
  sc: Node;
  so: number;
  ec: Node;
  eo: number;
}

function anchorOf(r: Range): Anchor {
  return { sc: r.startContainer, so: r.startOffset, ec: r.endContainer, eo: r.endOffset };
}

function sameAnchor(r: Range, a: Anchor): boolean {
  return r.startContainer === a.sc && r.startOffset === a.so && r.endContainer === a.ec && r.endOffset === a.eo;
}

/**
 * Find in the text of the element `rootRef` points to. The hook reads the
 * root's text nodes and paints through the highlight registry; it adds,
 * moves and changes nothing in the DOM (root rule 23). Typing is debounced,
 * navigation is not: `next`/`previous` first apply a query still waiting.
 */
export function useFindInText(
  rootRef: RefObject<HTMLElement | null>,
  { open, query }: { open: boolean; query: string },
): FindInText {
  const ownerId = `find-${useId()}`;
  const [state, setState] = useState<FindState>(EMPTY);
  const rangesRef = useRef<Range[]>([]);
  const indexRef = useRef(-1);
  const anchorRef = useRef<Anchor | null>(null);
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
    (ranges: Range[], index: number, truncated: boolean, searched: boolean, scroll: boolean) => {
      rangesRef.current = ranges;
      indexRef.current = index;
      anchorRef.current = index >= 0 ? anchorOf(ranges[index]) : null;
      setFindRanges(ownerId, ranges, index >= 0 ? ranges[index] : null);
      setState({ count: ranges.length, index, truncated, searched });
      if (scroll && index >= 0) scrollToCurrent();
    },
    [ownerId, scrollToCurrent],
  );

  /** Search `q` in the root now; `keep` leaves the current match where it still exists. */
  const run = useCallback(
    (q: string, keep: boolean) => {
      appliedRef.current = q;
      const root = rootRef.current;
      if (!root) {
        commit([], -1, false, false, false);
        return;
      }
      const { nodes, text } = collectSearchableText(root);
      const { matches, truncated } = findMatches(text, q);
      const ranges = rangesForMatches(nodes, matches);
      const searched = q.trim().length >= 2;
      let index = ranges.length ? 0 : -1;
      let scroll = true;
      if (keep && anchorRef.current) {
        const kept = ranges.findIndex((r) => sameAnchor(r, anchorRef.current as Anchor));
        if (kept >= 0) {
          index = kept;
          scroll = false;
        }
      }
      commit(ranges, index, truncated, searched, scroll);
    },
    [rootRef, commit],
  );

  const flush = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    run(queryRef.current, false);
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

  // The text under the root changes (a version loads, a note folds): search again.
  useEffect(() => {
    const root = rootRef.current;
    if (!open || !root || typeof MutationObserver === 'undefined') return;
    let frame: number | null = null;
    const observer = new MutationObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (timerRef.current === null) run(appliedRef.current, true);
      });
    });
    observer.observe(root, { childList: true, characterData: true, subtree: true });
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
      anchorRef.current = null;
      appliedRef.current = '';
      setState(EMPTY);
    };
  }, [open, ownerId]);

  const step = useCallback(
    (delta: 1 | -1) => {
      flush();
      const n = rangesRef.current.length;
      if (n === 0) return;
      const index = (indexRef.current + delta + n) % n;
      indexRef.current = index;
      anchorRef.current = anchorOf(rangesRef.current[index]);
      setFindRanges(ownerId, rangesRef.current, rangesRef.current[index]);
      setState((s) => ({ ...s, index }));
      scrollToCurrent();
    },
    [flush, ownerId, scrollToCurrent],
  );

  const next = useCallback(() => step(1), [step]);
  const previous = useCallback(() => step(-1), [step]);

  return { ...state, next, previous };
}
