/**
 * Single-instance coordinator for the article graph rail (Slice 3 §3.4).
 *
 * The rail is mounted per `ArticleTabContent` (there is no workspace-level
 * "focused article" store to bind a single mount to — see design §3.4). With
 * several articles open (multiple NormaCards, a mobile accordion, multiple
 * workspace tabs) every card would render its own `fixed right-0` rail and they
 * would stack. This module dedupes them to exactly ONE visible rail bound to the
 * most-recently-focused article.
 *
 * Model: every mounted rail acquires a monotonically increasing focus token
 * whenever it (re)binds to an article urn. The rail holding the highest token is
 * the winner and is the only one that renders its UI; the others render null.
 * The "most recently (re)bound" rail is the one the user just navigated to (its
 * `ArticleTabContent` re-rendered with a fresh urn), which is the correct
 * focus target. When the winner unmounts it releases focus and the next-highest
 * live registrant becomes the winner.
 *
 * Pure module state + subscription; no React inside so it can be unit-tested and
 * shared across every rail instance without prop drilling through containers the
 * rail feature does not own.
 */

interface Registration {
  token: number;
}

let counter = 0;
const registrations = new Map<symbol, Registration>();
const listeners = new Set<() => void>();

function currentWinner(): symbol | null {
  let winner: symbol | null = null;
  let best = -1;
  for (const [id, reg] of registrations) {
    if (reg.token > best) {
      best = reg.token;
      winner = id;
    }
  }
  return winner;
}

let cachedWinner: symbol | null = null;

function recompute(): void {
  const next = currentWinner();
  if (next === cachedWinner) return;
  cachedWinner = next;
  for (const listener of listeners) listener();
}

/** Register a rail instance under a caller-owned stable id. */
export function registerRail(id: symbol): void {
  registrations.set(id, { token: ++counter });
  recompute();
}

/** Bump this rail to the front (call on mount and whenever it rebinds a urn). */
export function focusRail(id: symbol): void {
  const reg = registrations.get(id);
  if (!reg) return;
  reg.token = ++counter;
  recompute();
}

/** Unregister on unmount; the next-highest live rail takes focus. */
export function unregisterRail(id: symbol): void {
  registrations.delete(id);
  recompute();
}

/** Is this rail the current single winner? */
export function isRailWinner(id: symbol): boolean {
  return cachedWinner === id;
}

/** Subscribe to winner changes (for useSyncExternalStore). */
export function subscribeRailFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: reset all module state between cases. */
export function __resetRailFocus(): void {
  registrations.clear();
  listeners.clear();
  counter = 0;
  cachedWinner = null;
}
