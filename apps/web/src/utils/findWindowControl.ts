/**
 * The one way to open (or close) the floating find window (spec §13.1): the Cmd/Ctrl+F shortcut in
 * `Layout` and the magnifier of a reading toolbar both call `openFindWindow`; the single
 * `FindWindow` mounted in the layout subscribes. With no window mounted (a preview, a test of a
 * toolbar alone) a call is a no-op.
 *
 * Also the window's report of what it is scoped to, which the magnifiers read for `aria-pressed`
 * («the window is open and scoped to this tab», Task 34 ruling 3).
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

let scopedTabId: string | null = null;
const scopeListeners = new Set<() => void>();

/** What the window reports: the tab it is open on in «Questa scheda», `null` when it is closed or
 *  searching every tab. */
export function reportFindWindowScope(tabId: string | null): void {
  if (scopedTabId === tabId) return;
  scopedTabId = tabId;
  for (const listener of scopeListeners) listener();
}

export function getFindWindowScope(): string | null {
  return scopedTabId;
}

export function subscribeFindWindowScope(listener: () => void): () => void {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}
