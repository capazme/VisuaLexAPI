import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/useAppStore';
import { useIsDesktop } from './useIsDesktop';
import {
  findTargetsInScope,
  frontTabId as computeFrontTabId,
  type FindScope,
  type FindTarget,
} from '../utils/findScope';
import { findRootsFor, subscribeFindRoots, type FindRoot } from '../utils/findTargets';
import {
  collectSearchableText,
  findMatches,
  isSearchableQuery,
  mapThroughEdit,
  rangesForMatches,
  type TextSegment,
} from '../utils/findInText';
import { clearFindRanges, setFindRanges } from '../utils/findHighlights';

const DEBOUNCE_MS = 150;
/** How long a "go to an undrawn match" request waits for the root to register before giving up
 *  (Task 33 ruling 3) — long enough for a block to mount and fetch, short enough that the window
 *  never looks stuck. */
const PENDING_TIMEOUT_MS = 3000;
const MATCH_LIMIT = 1000;

export type { FindScope };

export interface FindWindowLocation {
  tabId: string;
  targetKey: string;
  label: string;
  onScreen: boolean;
}

export interface UseFindWindowOptions {
  query: string;
  scope: FindScope;
  /** Nothing is searched, drawn or recomputed while false — the window is closed. */
  open: boolean;
}

export interface UseFindWindow {
  /** Matches counted (drawn and stored together), capped at 1000 across the whole scope. */
  count: number;
  /** Zero-based index of the current match among `count`, -1 when there is none. */
  index: number;
  /** More than 1000 matched across the scope; only the first ones are counted. */
  truncated: boolean;
  /** The applied query was long enough to search: tells «Nessun risultato» from «nothing typed». */
  searched: boolean;
  /** Where the current match is, for «Tutte le schede»'s location line; null with no match. */
  current: FindWindowLocation | null;
  next: () => void;
  previous: () => void;
}

/** One target's matches this run, over whichever text was actually searched. */
interface TargetMatches extends FindTarget {
  onScreen: boolean;
  text: string;
  nodes?: TextSegment[];
  element?: HTMLElement;
  matches: [number, number][];
}

/** One match, flattened across every target in scope order. */
interface FlatMatch {
  tabId: string;
  targetKey: string;
  label: string;
  articleId?: string;
  onScreen: boolean;
  /** Its position among its own target's matches alone — the ordinal Task 33 ruling 3 resolves a
   *  pending jump by, since the drawn and the stored count of the same text can differ. */
  ordinal: number;
  /** Offset in the text that was actually searched for this target this run. */
  start: number;
  range?: Range;
}

interface Pending {
  tabId: string;
  targetKey: string;
  ordinal: number;
}

type CurrentRef = { tabId: string; targetKey: string; start: number } | null;

const targetId = (tabId: string, targetKey: string): string => `${tabId}\u0000${targetKey}`;

function rootFor(roots: FindRoot[], tabId: string, targetKey: string): FindRoot | undefined {
  return roots.find((r) => r.tabId === tabId && r.targetKey === targetKey);
}

type FindWindowState = Omit<UseFindWindow, 'next' | 'previous'>;

const EMPTY: FindWindowState = { count: 0, index: -1, truncated: false, searched: false, current: null };

/** Whether two states would render the same: `current`'s `onScreen` can flip between two runs at
 *  the very same index (a pending target's root registering), so it is compared on its own fields
 *  rather than skipped because `index` alone looks unchanged. */
function sameState(a: FindWindowState, b: FindWindowState): boolean {
  return (
    a.count === b.count &&
    a.index === b.index &&
    a.truncated === b.truncated &&
    a.searched === b.searched &&
    a.current?.tabId === b.current?.tabId &&
    a.current?.targetKey === b.current?.targetKey &&
    a.current?.onScreen === b.current?.onScreen
  );
}

/**
 * The matches across every text the current scope reaches (spec §13.1, Task 33): a target with a
 * displayed registered root (`findRootsFor`) is searched in its text root, as PR 4c's
 * `useFindInText` does for one root; a target without one is searched in its stored projection and
 * only counted (ruling 2 — never both for the same target). `next`/`previous` step across every
 * match in scope order, wrapping; landing on a match that is not drawn raises its tab
 * (`bringTabToFront`) and shows its article (`focusArticleInTab`), then takes the match there by
 * its ordinal once a root registers for it (ruling 3) — dropped after three seconds with no root.
 * Recomputed on typing (debounced), on a displayed root's own mutations, on a root registering or
 * being removed anywhere, and on a workspace change; the current match is kept by target and
 * position, the way PR 4c's hook keeps it within one root (`mapThroughEdit`). Draws under one
 * registry owner for the whole window — nothing here adds, moves or changes the text DOM.
 */
export function useFindWindow({ query, scope, open }: UseFindWindowOptions): UseFindWindow {
  const ownerId = `find-window-${useId()}`;
  const workspaceTabs = useAppStore(useShallow((s) => s.workspaceTabs));
  const bringTabToFront = useAppStore((s) => s.bringTabToFront);
  const focusArticleInTab = useAppStore((s) => s.focusArticleInTab);
  const isDesktop = useIsDesktop();

  const [state, setState] = useState(EMPTY);
  const stateRef = useRef(EMPTY);
  const setLatest = useCallback((next: typeof EMPTY) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const allRef = useRef<FlatMatch[]>([]);
  const indexRef = useRef(-1);
  const currentRef = useRef<CurrentRef>(null);
  const textByTargetRef = useRef<Map<string, string>>(new Map());
  const pendingRef = useRef<Pending | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const appliedRef = useRef('');
  const queryRef = useRef(query);
  const scopeRef = useRef(scope);
  const workspaceTabsRef = useRef(workspaceTabs);
  const isDesktopRef = useRef(isDesktop);
  const bringTabToFrontRef = useRef(bringTabToFront);
  const focusArticleInTabRef = useRef(focusArticleInTab);
  useEffect(() => {
    queryRef.current = query;
    scopeRef.current = scope;
    workspaceTabsRef.current = workspaceTabs;
    isDesktopRef.current = isDesktop;
    bringTabToFrontRef.current = bringTabToFront;
    focusArticleInTabRef.current = focusArticleInTab;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPending = useCallback(() => {
    if (pendingTimerRef.current !== null) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = null;
    pendingRef.current = null;
  }, []);

  // `applyCurrent`'s pending timeout calls back into `run`, declared below it: a ref sidesteps the
  // circularity (both close over it; only its latest value, read when the timer fires, matters).
  const runRef = useRef<(q: string, keep: boolean) => void>(() => {});

  /** Builds this run's matches for every target, DOM-first, stored otherwise; `limit` is the
   *  1000-match budget shared across the whole scope. */
  const buildTargets = useCallback((targets: FindTarget[], q: string): { targets: TargetMatches[]; truncated: boolean } => {
    const roots = findRootsFor();
    let budget = MATCH_LIMIT;
    let truncated = false;
    const built: TargetMatches[] = [];
    for (const target of targets) {
      const root = rootFor(roots, target.tabId, target.targetKey);
      if (root) {
        const collected = collectSearchableText(root.element);
        const { matches, truncated: tr } = findMatches(collected.text, q, { limit: Math.max(0, budget) });
        if (tr) truncated = true;
        budget -= matches.length;
        built.push({ ...target, onScreen: true, text: collected.text, nodes: collected.nodes, element: root.element, matches });
      } else {
        const text = target.storedText ?? '';
        const { matches, truncated: tr } = findMatches(text, q, { limit: Math.max(0, budget) });
        if (tr) truncated = true;
        budget -= matches.length;
        built.push({ ...target, onScreen: false, text, matches });
      }
    }
    return { targets: built, truncated };
  }, []);

  function flatten(built: TargetMatches[]): FlatMatch[] {
    const all: FlatMatch[] = [];
    for (const target of built) {
      const ranges = target.onScreen && target.nodes ? rangesForMatches(target.nodes, target.matches) : undefined;
      target.matches.forEach(([start], ordinal) => {
        all.push({
          tabId: target.tabId,
          targetKey: target.targetKey,
          label: target.label,
          articleId: target.articleId,
          onScreen: target.onScreen,
          ordinal,
          start,
          range: ranges?.[ordinal],
        });
      });
    }
    return all;
  }

  const scrollToRange = useCallback((range: Range | undefined) => {
    range?.startContainer.parentElement?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  }, []);

  /** Draws every on-screen match under one owner, `current` the stronger colour (or none, when
   *  the current match is not drawn — it is still counted, just not painted). */
  const draw = useCallback(
    (all: FlatMatch[], currentIndex: number) => {
      const ranges = all.filter((m) => m.range).map((m) => m.range as Range);
      const current = currentIndex >= 0 ? all[currentIndex] : undefined;
      setFindRanges(ownerId, ranges, current?.range ?? null);
    },
    [ownerId],
  );

  /** Applies `newIndex` as the current match: identifies it for the next recompute to keep
   *  (`currentRef`), starts or clears the pending jump, and draws; returns it for the caller to
   *  commit to state (its `onScreen` can flip between two runs with the very same index — a root
   *  registering for a pending target — so the caller must not skip the update on index alone).
   *  `scroll` is true only when the reader actually moved (a step, or a pending jump that just
   *  resolved) — a passive recompute that keeps the same logical match never yanks the view. */
  const applyCurrent = useCallback(
    (all: FlatMatch[], newIndex: number, scroll: boolean): FindWindowLocation | null => {
      indexRef.current = newIndex;
      const match = newIndex >= 0 ? all[newIndex] : undefined;
      currentRef.current = match ? { tabId: match.tabId, targetKey: match.targetKey, start: match.start } : null;
      if (!match) {
        clearPending();
        draw(all, -1);
        return null;
      }
      const location: FindWindowLocation = { tabId: match.tabId, targetKey: match.targetKey, label: match.label, onScreen: match.onScreen };
      if (match.onScreen) {
        clearPending();
        draw(all, newIndex);
        if (scroll) scrollToRange(match.range);
        return location;
      }
      // Not drawn: show it, and wait for its root to register (ruling 3). A repeat recompute
      // landing on the very same target does not raise it again.
      const already = pendingRef.current;
      if (!already || already.tabId !== match.tabId || already.targetKey !== match.targetKey) {
        clearPending();
        pendingRef.current = { tabId: match.tabId, targetKey: match.targetKey, ordinal: match.ordinal };
        bringTabToFrontRef.current(match.tabId);
        if (match.articleId) focusArticleInTabRef.current(match.tabId, match.articleId);
        pendingTimerRef.current = setTimeout(() => {
          // No root came: move on as if the target had no matches, rather than stay stuck on a
          // match that can never be shown.
          pendingTimerRef.current = null;
          pendingRef.current = null;
          currentRef.current = null;
          runRef.current(appliedRef.current, false);
        }, PENDING_TIMEOUT_MS);
      }
      draw(all, -1);
      return location;
    },
    [clearPending, draw, scrollToRange],
  );

  /**
   * Recomputes every target's matches and decides the new current index.
   * - A pending jump (ruling 3) resolves first: once its target has a displayed root, the match at
   *   its ordinal within that target's own list becomes current, wherever it now sits overall.
   * - Otherwise, `keep` tries to keep the same logical match: the same target, carried through
   *   whatever changed in its own text (`mapThroughEdit`, as PR 4c's hook does within one root).
   * - A fresh query (`keep` false) always lands on the first match.
   */
  const run = useCallback(
    (q: string, keep: boolean) => {
      appliedRef.current = q;
      const front = computeFrontTabId({ workspaceTabs: workspaceTabsRef.current }, isDesktopRef.current);
      const targets = findTargetsInScope({ workspaceTabs: workspaceTabsRef.current }, scopeRef.current, front);
      const { targets: built, truncated } = buildTargets(targets, q);
      const all = flatten(built);
      allRef.current = all;

      const textByTarget = new Map<string, string>();
      for (const t of built) textByTarget.set(targetId(t.tabId, t.targetKey), t.text);
      const previousText = textByTargetRef.current;
      textByTargetRef.current = textByTarget;

      let newIndex = -1;
      let scroll = false;

      const pending = pendingRef.current;
      if (pending) {
        const resolved = all.findIndex((m) => m.onScreen && m.tabId === pending.tabId && m.targetKey === pending.targetKey);
        if (resolved >= 0) {
          // Several matches may have arrived in the newly-drawn text: take the one at the same
          // ordinal among them, clamped (the drawn and the stored count can differ, spec §13.1).
          const ofTarget = all.filter((m) => m.onScreen && m.tabId === pending.tabId && m.targetKey === pending.targetKey);
          const chosen = ofTarget[Math.min(pending.ordinal, ofTarget.length - 1)];
          newIndex = all.indexOf(chosen);
          scroll = true;
        }
      }

      if (newIndex < 0) {
        if (!keep) {
          newIndex = all.length ? 0 : -1;
        } else if (currentRef.current) {
          const cur = currentRef.current;
          const sameTarget = all.filter((m) => m.tabId === cur.tabId && m.targetKey === cur.targetKey);
          if (sameTarget.length) {
            const oldText = previousText.get(targetId(cur.tabId, cur.targetKey)) ?? '';
            const newText = textByTarget.get(targetId(cur.tabId, cur.targetKey)) ?? '';
            const mapped = mapThroughEdit(oldText, newText, cur.start);
            const after = sameTarget.find((m) => m.start >= mapped);
            const chosen = after ?? sameTarget[0];
            newIndex = all.indexOf(chosen);
          } else {
            newIndex = all.length ? 0 : -1;
          }
        } else {
          newIndex = all.length ? 0 : -1;
        }
      }

      const current = applyCurrent(all, newIndex, scroll);
      const next = { count: all.length, index: indexRef.current, truncated, searched: isSearchableQuery(q), current };
      if (!sameState(stateRef.current, next)) setLatest(next);
    },
    [applyCurrent, buildTargets, setLatest],
  );
  useEffect(() => {
    runRef.current = run;
  });

  /** Applies a query still waiting; true when there was one (next/previous land on its first match). */
  const flush = useCallback((): boolean => {
    if (timerRef.current === null) return false;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    run(queryRef.current, false);
    return true;
  }, [run]);

  // Typing: apply the query after a pause, like PR 4c's box.
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

  // The scope switches, or the workspace changes (a tab opened, closed, raised, minimised; an
  // article shown in a block): recompute, keeping the current match where it still is.
  useEffect(() => {
    if (!open) return;
    if (isSearchableQuery(appliedRef.current)) run(appliedRef.current, true);
  }, [open, scope, workspaceTabs, isDesktop, run]);

  // A root registers or is removed anywhere (a pending jump's article mounts, a tab's copy swaps
  // at a breakpoint): recompute.
  useEffect(() => {
    if (!open) return;
    return subscribeFindRoots(() => {
      if (isSearchableQuery(appliedRef.current)) run(appliedRef.current, true);
    });
  }, [open, run]);

  // Every displayed root's own mutations (a note added, highlights toggled): recompute, coalesced
  // to a frame, the way PR 4c's hook does for its one root.
  useEffect(() => {
    if (!open) return;
    const observers = new Map<HTMLElement, MutationObserver>();
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (isSearchableQuery(appliedRef.current)) run(appliedRef.current, true);
      });
    };
    const sync = () => {
      const elements = new Set(findRootsFor().map((r) => r.element));
      for (const [el, observer] of observers) {
        if (!elements.has(el)) {
          observer.disconnect();
          observers.delete(el);
        }
      }
      for (const el of elements) {
        if (observers.has(el)) continue;
        const observer = new MutationObserver(schedule);
        observer.observe(el, {
          childList: true,
          characterData: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'style', 'hidden'],
        });
        observers.set(el, observer);
      }
    };
    sync();
    const unsubscribe = subscribeFindRoots(sync);
    return () => {
      unsubscribe();
      for (const observer of observers.values()) observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [open, run]);

  // Closed or unmounted: nothing stays drawn or pending.
  useEffect(() => {
    if (!open) return;
    return () => {
      clearFindRanges(ownerId);
      clearPending();
      allRef.current = [];
      indexRef.current = -1;
      currentRef.current = null;
      textByTargetRef.current = new Map();
      appliedRef.current = '';
      setLatest(EMPTY);
    };
  }, [open, ownerId, clearPending, setLatest]);

  const step = useCallback(
    (delta: 1 | -1) => {
      if (flush()) return;
      const all = allRef.current;
      const n = all.length;
      if (n === 0) return;
      const newIndex = (indexRef.current + delta + n) % n;
      const current = applyCurrent(all, newIndex, true);
      const next = { ...stateRef.current, index: indexRef.current, current };
      if (!sameState(stateRef.current, next)) setLatest(next);
    },
    [applyCurrent, flush, setLatest],
  );

  const next = useCallback(() => step(1), [step]);
  const previous = useCallback(() => step(-1), [step]);

  return { ...state, next, previous };
}
