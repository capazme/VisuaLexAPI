/**
 * The one way to open (or close) the floating find window (spec §13.1): the Cmd/Ctrl+F shortcut in
 * `Layout` and the magnifier of a reading toolbar both call `openFindWindow`; the single
 * `FindWindow` mounted in the layout subscribes. With no window mounted (a preview, a test of a
 * toolbar alone) a call is a no-op.
 *
 * Also the window's report of what it is scoped to, which the magnifiers read for `aria-pressed`:
 * pressed means «the window is open on this tab and this text», so a magnifier on a background tab
 * or on another text of the same tab opens the window there instead of closing it.
 */

export interface FindWindowRequest {
  /** The tab whose text the window opens on: «Questa scheda» becomes that tab. Absent from the shortcut. */
  tabId?: string;
  /** Inside `tabId`, the text whose first match is taken (an article's key, a decision's key). */
  targetKey?: string;
  /** Where focus goes when the window closes: the magnifier that opened it. Without it, the element
   *  that held focus when the window opened. */
  returnFocus?: HTMLElement | null;
}

export type FindWindowCommand = ({ type: 'open' } & FindWindowRequest) | { type: 'close' };

const commandListeners = new Set<(command: FindWindowCommand) => void>();

export function openFindWindow(request: FindWindowRequest = {}): void {
  for (const listener of commandListeners) listener({ type: 'open', ...request });
}

export function closeFindWindow(): void {
  for (const listener of commandListeners) listener({ type: 'close' });
}

export function subscribeFindWindow(listener: (command: FindWindowCommand) => void): () => void {
  commandListeners.add(listener);
  return () => {
    commandListeners.delete(listener);
  };
}

/**
 * Whether an overlay covers the workspace, so Cmd/Ctrl+F is left to the browser (`Layout`): a modal
 * dialog (`aria-modal="true"`), or an overlay that is not one in ARIA terms but still covers the
 * reader — Study Mode, the command palette, CompareView, the PDF viewer — marked `data-find-overlay`.
 * An overlay carries the mark only while it is open (each renders nothing when closed).
 */
export function isWorkspaceCovered(): boolean {
  // Two queries, not one selector list: jsdom's `querySelector` misses the second selector of a list
  // when the first matches nothing, and the tests run there.
  return document.querySelector('[aria-modal="true"]') !== null || document.querySelector('[data-find-overlay]') !== null;
}

let scopedTabId: string | null = null;
let pointedKey: string | null = null;
const scopeListeners = new Set<() => void>();

/** What the window reports: the tab it is open on in «Questa scheda», `null` when it is closed or
 *  searching every tab; and the text in that tab it was pointed at by a magnifier (`null`: the
 *  whole tab, as a bare Cmd/Ctrl+F leaves it). */
export function reportFindWindowScope(tabId: string | null, targetKey: string | null = null): void {
  if (scopedTabId === tabId && pointedKey === targetKey) return;
  scopedTabId = tabId;
  pointedKey = targetKey;
  for (const listener of scopeListeners) listener();
}

/** Whether the window is open on `tabId` and, when it was pointed at one text, on `targetKey`. */
export function isFindWindowScopedTo(tabId: string | undefined, targetKey?: string): boolean {
  if (tabId === undefined || scopedTabId !== tabId) return false;
  return targetKey === undefined || pointedKey === null || pointedKey === targetKey;
}

export function subscribeFindWindowScope(listener: () => void): () => void {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}
