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
  findMatchesInFolded,
  foldForSearch,
  isSearchableQuery,
  mapThroughEdit,
  rangesForMatches,
  type TextSegment,
} from '../utils/findInText';
import { clearFindRanges, setFindRanges } from '../utils/findHighlights';

const DEBOUNCE_MS = 150;
/** How long a «go to» an undrawn match waits for the root to register before the target is given
 *  up for the query (Task 33 ruling 3) — long enough for a block to mount and fetch, short enough
 *  that the window never looks stuck. */
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
  /** Where a fresh query starts: the first match in this tab (and target, when given) wins over the
   *  front tab's — the magnifier of a reading toolbar opens the window on its own text. */
  prefer?: { tabId: string; targetKey?: string } | null;
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
  /** Applies the query again as a fresh one (typing's choice, `prefer` first), now: the window
   *  was asked to open on a tab while it already held a query. */
  restart: () => void;
}

type Direction = 1 | -1;

/** One target's matches this run, over whichever text was actually searched. */
interface TargetMatches extends FindTarget {
  id: string;
  onScreen: boolean;
  text: string;
  nodes?: TextSegment[];
  matches: [number, number][];
}

/** One match, flattened across every target in scope order. */
interface FlatMatch {
  /** The target's full identity (`targetId`). */
  id: string;
  tabId: string;
  targetKey: string;
  label: string;
  articleId?: string;
  onScreen: boolean;
  /** Its position among its own target's matches alone — the ordinal a pending «go to» resolves
   *  by, since the drawn and the stored count of the same text can differ (ruling 3). */
  ordinal: number;
  /** Offset in the text that was actually searched for this target this run. */
  start: number;
  range?: Range;
}

/** A «go to» an undrawn match, waiting for its root (ruling 3). */
interface Pending {
  id: string;
  ordinal: number;
  direction: Direction;
}

type CurrentRef = { id: string; start: number } | null;

const targetId = (tabId: string, targetKey: string): string => `${tabId}\u0000${targetKey}`;

function rootFor(roots: FindRoot[], tabId: string, targetKey: string): FindRoot | undefined {
  return roots.find((r) => r.tabId === tabId && r.targetKey === targetKey);
}

type FindWindowState = Omit<UseFindWindow, 'next' | 'previous' | 'restart'>;

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
 * only counted (ruling 2 — never both for the same target).
 *
 * Where the current match is:
 * - typing (a new query) takes the front tab's first match, a drawn one first; with none in the
 *   front tab, the first match overall — counted, never shown: typing raises no tab and switches no
 *   article, it only scrolls to a drawn match in the front tab;
 * - a recompute keeps the same match (same target, its position carried through the edit by
 *   `mapThroughEdit`), else the next one in scope order — never back to the first;
 * - only `next`/`previous` (Enter, Shift+Enter, the arrows) go to an undrawn match: its tab is
 *   revealed (`revealTab`) and its article shown (`focusArticleInTab`), and once a root registers for
 *   it the match at the same ordinal there becomes current (the last drawn one when fewer are drawn;
 *   with none drawn, the next match in the direction of travel). With no root after three seconds
 *   the target is given up for this query: navigation skips it, and the window moves once to the
 *   next match in the direction of travel.
 *
 * Recomputed on typing (debounced), and — coalesced to one per animation frame — on a displayed
 * root's own mutations, on a root registering or being removed anywhere, and on any workspace
 * change. A stored text is folded once per text. Draws under one registry owner for the whole
 * window; nothing here adds, moves or changes the text DOM.
 */
export function useFindWindow({ query, scope, open, prefer = null }: UseFindWindowOptions): UseFindWindow {
  const ownerId = `find-window-${useId()}`;
  const workspaceTabs = useAppStore(useShallow((s) => s.workspaceTabs));
  const mobileActiveTabId = useAppStore((s) => s.mobileActiveTabId);
  const revealTab = useAppStore((s) => s.revealTab);
  const focusArticleInTab = useAppStore((s) => s.focusArticleInTab);
  const isDesktop = useIsDesktop();

  const [state, setState] = useState(EMPTY);
  const stateRef = useRef(EMPTY);
  const setLatest = useCallback((next: FindWindowState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const allRef = useRef<FlatMatch[]>([]);
  /** The targets of the last run, in scope order (their `targetId`s). */
  const orderRef = useRef<string[]>([]);
  const indexRef = useRef(-1);
  const currentRef = useRef<CurrentRef>(null);
  const textByTargetRef = useRef<Map<string, string>>(new Map());
  /** Each stored text folded once: by target, valid while the target's stored text is the same. */
  const foldedRef = useRef<Map<string, { text: string; folded: string }>>(new Map());
  const pendingRef = useRef<Pending | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Targets given up for the applied query: a «go to» found no root in time (ruling 3). */
  const unreachableRef = useRef<Set<string>>(new Set());

  const appliedRef = useRef('');
  const queryRef = useRef(query);
  const scopeRef = useRef(scope);
  const workspaceTabsRef = useRef(workspaceTabs);
  const mobileActiveTabIdRef = useRef(mobileActiveTabId);
  const isDesktopRef = useRef(isDesktop);
  const revealTabRef = useRef(revealTab);
  const focusArticleInTabRef = useRef(focusArticleInTab);
  const preferRef = useRef(prefer);
  useEffect(() => {
    preferRef.current = prefer;
    queryRef.current = query;
    scopeRef.current = scope;
    workspaceTabsRef.current = workspaceTabs;
    mobileActiveTabIdRef.current = mobileActiveTabId;
    isDesktopRef.current = isDesktop;
    revealTabRef.current = revealTab;
    focusArticleInTabRef.current = focusArticleInTab;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRef = useRef<number | null>(null);

  const clearPending = useCallback(() => {
    if (pendingTimerRef.current !== null) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = null;
    pendingRef.current = null;
  }, []);

  /** A stored text's matches, folding it only when it is not the text folded last time. */
  const matchStored = useCallback((id: string, text: string, q: string, limit: number) => {
    let entry = foldedRef.current.get(id);
    if (!entry || entry.text !== text) {
      entry = { text, folded: foldForSearch(text) };
      foldedRef.current.set(id, entry);
    }
    return findMatchesInFolded(entry.folded, q, { limit });
  }, []);

  /** Builds this run's matches for every target, DOM-first, stored otherwise, under the
   *  1000-match budget shared across the whole scope. */
  const buildTargets = useCallback(
    (targets: FindTarget[], q: string): { targets: TargetMatches[]; truncated: boolean } => {
      const roots = findRootsFor();
      let budget = MATCH_LIMIT;
      let truncated = false;
      const built: TargetMatches[] = [];
      for (const target of targets) {
        const id = targetId(target.tabId, target.targetKey);
        const root = rootFor(roots, target.tabId, target.targetKey);
        const limit = Math.max(0, budget);
        if (root) {
          const collected = collectSearchableText(root.element);
          const { matches, truncated: tr } = findMatches(collected.text, q, { limit });
          if (tr) truncated = true;
          budget -= matches.length;
          built.push({ ...target, id, onScreen: true, text: collected.text, nodes: collected.nodes, matches });
        } else {
          const text = target.storedText ?? '';
          const { matches, truncated: tr } = matchStored(id, text, q, limit);
          if (tr) truncated = true;
          budget -= matches.length;
          built.push({ ...target, id, onScreen: false, text, matches });
        }
      }
      return { targets: built, truncated };
    },
    [matchStored],
  );

  function flatten(built: TargetMatches[]): FlatMatch[] {
    const all: FlatMatch[] = [];
    for (const target of built) {
      const ranges = target.onScreen && target.nodes ? rangesForMatches(target.nodes, target.matches) : undefined;
      target.matches.forEach(([start], ordinal) => {
        all.push({
          id: target.id,
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

  const reachable = useCallback((m: FlatMatch) => !unreachableRef.current.has(m.id), []);

  /** The match `delta` steps from `from`, wrapping and skipping given-up targets; -1 when none. */
  const stepFrom = useCallback(
    (all: FlatMatch[], from: number, delta: Direction): number => {
      const n = all.length;
      const origin = from >= 0 ? from : delta > 0 ? -1 : 0;
      for (let k = 1; k <= n; k += 1) {
        const i = (((origin + delta * k) % n) + n) % n;
        if (reachable(all[i])) return i;
      }
      return -1;
    },
    [reachable],
  );

  /** The first match of the target nearest to `fromId` in `order`, going `direction` and wrapping —
   *  the last of that target going back; -1 when no other target has a reachable match. */
  const neighbourOf = useCallback(
    (all: FlatMatch[], order: string[], fromId: string, direction: Direction): number => {
      const position = order.indexOf(fromId);
      if (position < 0) return -1;
      const n = order.length;
      for (let k = 1; k < n; k += 1) {
        const id = order[(((position + direction * k) % n) + n) % n];
        if (unreachableRef.current.has(id)) continue;
        const first = all.findIndex((m) => m.id === id);
        if (first < 0) continue;
        if (direction > 0) return first;
        let last = first;
        while (last + 1 < all.length && all[last + 1].id === id) last += 1;
        return last;
      }
      return -1;
    },
    [],
  );

  /** Typing's choice: the front tab's first match, a drawn one first; else the first overall. */
  const pickInitial = useCallback(
    (all: FlatMatch[], front: string | null): number => {
      const wanted = preferRef.current;
      if (wanted) {
        const inWanted = (m: FlatMatch) =>
          reachable(m) && m.tabId === wanted.tabId && (wanted.targetKey === undefined || m.targetKey === wanted.targetKey);
        const preferred = all.findIndex((m) => inWanted(m) && m.onScreen);
        if (preferred >= 0) return preferred;
        const stored = all.findIndex(inWanted);
        if (stored >= 0) return stored;
      }
      let i = all.findIndex((m) => reachable(m) && m.tabId === front && m.onScreen);
      if (i < 0) i = all.findIndex((m) => reachable(m) && m.tabId === front);
      if (i < 0) i = all.findIndex(reachable);
      return i;
    },
    [reachable],
  );

  const scrollToRange = useCallback((range: Range | undefined) => {
    range?.startContainer.parentElement?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  }, []);

  /** Makes `newIndex` current and draws every on-screen match, the current one the stronger colour
   *  (none, when the current match is not drawn — it is still counted). Raises nothing. */
  const applyCurrent = useCallback(
    (all: FlatMatch[], newIndex: number, scroll: boolean): FindWindowLocation | null => {
      indexRef.current = newIndex;
      const match = newIndex >= 0 ? all[newIndex] : undefined;
      currentRef.current = match ? { id: match.id, start: match.start } : null;
      const ranges = all.filter((m) => m.range).map((m) => m.range as Range);
      setFindRanges(ownerId, ranges, match?.range ?? null);
      if (!match) return null;
      if (scroll && match.onScreen) scrollToRange(match.range);
      return { tabId: match.tabId, targetKey: match.targetKey, label: match.label, onScreen: match.onScreen };
    },
    [ownerId, scrollToRange],
  );

  const commitState = useCallback(
    (current: FindWindowLocation | null, patch?: Partial<FindWindowState>) => {
      // The counter counts what can be reached: a target given up (ruling 4) leaves it, and the
      // index is the current match's place among the rest.
      const all = allRef.current;
      let count = 0;
      let index = -1;
      all.forEach((m, i) => {
        if (!reachable(m)) return;
        if (i === indexRef.current) index = count;
        count += 1;
      });
      const next = { ...stateRef.current, ...patch, count, index, current };
      if (!sameState(stateRef.current, next)) setLatest(next);
    },
    [reachable, setLatest],
  );

  // The pending timeout and `goTo` call each other through the run below: a ref to the latest
  // `goTo` sidesteps the circularity (only its value when the timer fires matters).
  const goToRef = useRef<(all: FlatMatch[], index: number, direction: Direction) => FindWindowLocation | null>(() => null);

  /** A pending «go to» found no root in time: give the target up for this query and move once to
   *  the next match in the direction of travel (which may itself be a «go to»; each target is given
   *  up at most once, so this never loops). */
  const onPendingTimeout = useCallback(() => {
    pendingTimerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    unreachableRef.current.add(pending.id);
    const all = allRef.current;
    const of = all.filter((m) => m.id === pending.id);
    const from = of.length ? all.indexOf(of[Math.min(pending.ordinal, of.length - 1)]) : indexRef.current;
    const next = stepFrom(all, from, pending.direction);
    if (next < 0 || next === from) {
      // Nothing else to go to: the target still leaves the counter.
      commitState(stateRef.current.current);
      return;
    }
    commitState(goToRef.current(all, next, pending.direction));
  }, [commitState, stepFrom]);

  /** An explicit move to `index`: drawn, it is shown; not drawn, its tab is revealed and its article
   *  shown, and the match waits for its root (ruling 3). */
  const goTo = useCallback(
    (all: FlatMatch[], index: number, direction: Direction): FindWindowLocation | null => {
      clearPending();
      const location = applyCurrent(all, index, true);
      const match = index >= 0 ? all[index] : undefined;
      if (!match || match.onScreen) return location;
      pendingRef.current = { id: match.id, ordinal: match.ordinal, direction };
      revealTabRef.current(match.tabId);
      if (match.articleId) focusArticleInTabRef.current(match.tabId, match.articleId);
      pendingTimerRef.current = setTimeout(onPendingTimeout, PENDING_TIMEOUT_MS);
      return location;
    },
    [applyCurrent, clearPending, onPendingTimeout],
  );
  useEffect(() => {
    goToRef.current = goTo;
  });

  /**
   * Recomputes every target's matches and decides the current one: `fresh` for a new query (typing's
   * choice, nothing given up any more), otherwise a recompute that keeps the current match — after
   * resolving a pending «go to» whose root is now on screen.
   */
  const run = useCallback(
    (q: string, fresh: boolean) => {
      appliedRef.current = q;
      if (fresh) {
        clearPending();
        unreachableRef.current = new Set();
      }
      const scopeState = { workspaceTabs: workspaceTabsRef.current, mobileActiveTabId: mobileActiveTabIdRef.current };
      const front = computeFrontTabId(scopeState, isDesktopRef.current);
      // The phone's column draws norm blocks only: what it does not draw is not in the scope.
      const targets = findTargetsInScope(scopeState, scopeRef.current, front, { phone: !isDesktopRef.current });
      const { targets: built, truncated } = buildTargets(targets, q);
      // A given-up target whose root now draws matches (a slow mount, a block the reader expanded) is
      // reachable again.
      for (const t of built) if (t.onScreen && t.matches.length) unreachableRef.current.delete(t.id);
      const all = flatten(built);
      const order = built.map((t) => t.id);
      const previousOrder = orderRef.current;
      allRef.current = all;
      orderRef.current = order;

      const textByTarget = new Map<string, string>();
      for (const t of built) textByTarget.set(t.id, t.text);
      const previousText = textByTargetRef.current;
      textByTargetRef.current = textByTarget;
      // Folded texts of targets no longer in scope are dropped.
      for (const id of foldedRef.current.keys()) if (!textByTarget.has(id)) foldedRef.current.delete(id);

      const patch = { truncated, searched: isSearchableQuery(q) };
      let newIndex = -1;
      let decided = false;
      let scroll = false;

      const pending = pendingRef.current;
      if (pending) {
        const target = built.find((t) => t.id === pending.id);
        const of = all.filter((m) => m.id === pending.id);
        if (!target) {
          clearPending();
        } else if (target.onScreen) {
          clearPending();
          if (of.length) {
            // The same ordinal in the drawn text, or its last match when fewer are drawn.
            newIndex = all.indexOf(of[Math.min(pending.ordinal, of.length - 1)]);
            scroll = true;
            decided = true;
          } else {
            // Drawn, and nothing matches there after all: give it up for this query (going on may unmount
            // it, and its stored text would send the window straight back), then go on.
            unreachableRef.current.add(pending.id);
            const next = neighbourOf(all, order, pending.id, pending.direction);
            commitState(goTo(all, next, pending.direction), patch);
            return;
          }
        } else if (of.length) {
          // Still waiting: the current match stays on the stored one.
          newIndex = all.indexOf(of[Math.min(pending.ordinal, of.length - 1)]);
          decided = true;
        }
      }

      if (!decided) {
        const cur = currentRef.current;
        if (fresh || !cur) {
          newIndex = pickInitial(all, front);
          const chosen = newIndex >= 0 ? all[newIndex] : undefined;
          scroll = fresh && !!chosen && chosen.onScreen && (chosen.tabId === front || chosen.tabId === preferRef.current?.tabId);
        } else {
          const sameTarget = all.filter((m) => m.id === cur.id);
          let kept: FlatMatch | undefined;
          if (sameTarget.length) {
            const mapped = mapThroughEdit(previousText.get(cur.id) ?? '', textByTarget.get(cur.id) ?? '', cur.start);
            kept = sameTarget.find((m) => m.start >= mapped);
          }
          if (kept) {
            newIndex = all.indexOf(kept);
          } else {
            // The match is gone: the next one in scope order, never back to the first.
            const known = previousOrder.includes(cur.id) ? previousOrder : order;
            const following = neighbourOf(all, known, cur.id, 1);
            newIndex = following >= 0 ? following : sameTarget.length ? all.indexOf(sameTarget[0]) : pickInitial(all, front);
          }
        }
      }

      commitState(applyCurrent(all, newIndex, scroll), patch);
    },
    [applyCurrent, buildTargets, clearPending, commitState, goTo, neighbourOf, pickInitial],
  );

  /** One recompute at the next frame however many changes arrive before it. */
  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (isSearchableQuery(appliedRef.current)) run(appliedRef.current, false);
    });
  }, [run]);

  /** Applies a query still waiting; true when there was one (next/previous land on its first match). */
  const flush = useCallback((): boolean => {
    if (timerRef.current === null) return false;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    run(queryRef.current, true);
    return true;
  }, [run]);

  const restart = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (isSearchableQuery(queryRef.current)) run(queryRef.current, true);
  }, [run]);

  // Typing: apply the query after a pause, like PR 4c's box.
  useEffect(() => {
    if (!open || query === appliedRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      run(query, true);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [open, query, run]);

  // The scope switches, or the workspace changes (a tab opened, closed, raised, minimised, swiped to
  // on a phone; an article shown in a block): recompute, keeping the current match where it is.
  useEffect(() => {
    if (open) schedule();
  }, [open, scope, workspaceTabs, mobileActiveTabId, isDesktop, schedule]);

  // A root registers or is removed anywhere (a pending «go to»'s article mounts, a tab's copy swaps
  // at a breakpoint), or a displayed root's own text changes (a note added, highlights toggled).
  useEffect(() => {
    if (!open) return;
    const observers = new Map<HTMLElement, MutationObserver>();
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
    const unsubscribe = subscribeFindRoots(() => {
      sync();
      schedule();
    });
    return () => {
      unsubscribe();
      for (const observer of observers.values()) observer.disconnect();
    };
  }, [open, schedule]);

  // Closed or unmounted: nothing stays drawn, pending or scheduled.
  useEffect(() => {
    if (!open) return;
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      clearFindRanges(ownerId);
      clearPending();
      allRef.current = [];
      orderRef.current = [];
      indexRef.current = -1;
      currentRef.current = null;
      textByTargetRef.current = new Map();
      foldedRef.current = new Map();
      unreachableRef.current = new Set();
      appliedRef.current = '';
      setLatest(EMPTY);
    };
  }, [open, ownerId, clearPending, setLatest]);

  const step = useCallback(
    (delta: Direction) => {
      if (flush()) return;
      const all = allRef.current;
      const newIndex = stepFrom(all, indexRef.current, delta);
      if (newIndex < 0) return;
      commitState(goTo(all, newIndex, delta));
    },
    [commitState, flush, goTo, stepFrom],
  );

  const next = useCallback(() => step(1), [step]);
  const previous = useCallback(() => step(-1), [step]);

  return { ...state, next, previous, restart };
}
