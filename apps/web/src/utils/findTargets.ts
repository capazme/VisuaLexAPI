/**
 * The registry of text roots actually on screen (spec §13.1, Task 33): `ArticleTabContent` and
 * `DecisionReadingSurface` each register the element that holds their text root for as long as
 * they are mounted. The desktop and phone copies of a tab are both mounted at once, one hidden by
 * a CSS breakpoint (gotcha 26) — so the same (tabId, targetKey) can be registered twice, and only
 * the displayed copy counts: `getComputedStyle(el).display` is the *element's own* computed value,
 * untouched by a `display: none` ancestor (an ancestor only stops boxes from being generated), so
 * telling a root apart from a hidden twin means walking every ancestor up to the document, the way
 * `collectSearchableText` already does for the single root it is given.
 *
 * A pure module, no React: `hooks/useRegisterFindRoot.ts` is the effect that calls
 * `registerFindRoot` on mount and the unregister function it returns on unmount or identity change.
 */

export interface FindRootRegistration {
  tabId: string;
  targetKey: string;
  label: string;
  element: HTMLElement;
}

export interface FindRoot extends FindRootRegistration {
  readonly id: number;
}

let nextId = 0;
const entries = new Map<number, FindRoot>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Registers `element` as a target's text root; call the returned function once (on unmount, or
 * when the target's identity changes) to remove it. Every listener of `subscribeFindRoots` is
 * notified, on registering and on removing.
 */
export function registerFindRoot(registration: FindRootRegistration): () => void {
  const id = nextId++;
  entries.set(id, { ...registration, id });
  notify();
  return () => {
    if (entries.delete(id)) notify();
  };
}

/** A callback invoked whenever a root registers or is removed, so a caller can recompute what is
 *  on screen without polling. Returns the function that stops listening. */
export function subscribeFindRoots(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether `element` is actually shown: itself and every ancestor up to the document have a
 *  computed `display` other than `none`, and it is attached to the document at all. */
function isDisplayed(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  let node: Element | null = element;
  while (node) {
    if (getComputedStyle(node).display === 'none') return false;
    node = node.parentElement;
  }
  return true;
}

/**
 * The displayed roots — `tabId` narrows to one tab's roots, omitted for every tab's. A target
 * whose only registrations are currently hidden (the other breakpoint's copy, a collapsed block)
 * answers nothing here, by design: it is searched in its stored text instead.
 */
export function findRootsFor(tabId?: string): FindRoot[] {
  const roots: FindRoot[] = [];
  for (const entry of entries.values()) {
    if (tabId !== undefined && entry.tabId !== tabId) continue;
    if (!isDisplayed(entry.element)) continue;
    roots.push(entry);
  }
  return roots;
}
