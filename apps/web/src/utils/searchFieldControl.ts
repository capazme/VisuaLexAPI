import { appStore } from '../store/useAppStore';

/**
 * The search page's field, reached from elsewhere: the sidebar's «Ricerca», the empty page's button and
 * examples, an empty practice. A request made before the field is mounted (the sidebar's click, which
 * also navigates to the search page) asks to wait for it, briefly, and is taken once: a field that never
 * comes does not take it minutes later.
 */
export interface SearchFieldRequest {
  /** Words to put in the field; absent, the field keeps what it holds. */
  text?: string;
}

type Listener = (request: SearchFieldRequest) => void;

let listener: Listener | null = null;
let pending: { request: SearchFieldRequest; at: number } | null = null;

/** How long a request waits for the field to mount. */
const PENDING_MS = 2000;

/**
 * Focuses the search page's field, optionally filling it. Says whether the field took it; with `wait`,
 * a request the field is not there for waits for it to mount.
 */
export function focusSearchField(request: SearchFieldRequest = {}, options: { wait?: boolean } = {}): boolean {
  if (listener) {
    listener(request);
    return true;
  }
  if (options.wait) pending = { request, at: Date.now() };
  return false;
}

/**
 * The field when it is on screen, else the palette with the same words: Focus mode hides the field, and a
 * door that led to it must still lead somewhere.
 */
export function focusSearchFieldOrPalette(text?: string): void {
  if (focusSearchField(text === undefined ? {} : { text })) return;
  const { openCommandPalette, openCommandPaletteWith } = appStore.getState();
  if (text === undefined) openCommandPalette();
  else openCommandPaletteWith(text);
}

/** The field registers here while it is mounted; a request that waited is handed over at once. */
export function subscribeSearchField(next: Listener): () => void {
  listener = next;
  const waiting = pending;
  pending = null;
  if (waiting && Date.now() - waiting.at <= PENDING_MS) next(waiting.request);
  return () => {
    if (listener === next) listener = null;
  };
}

/** Tests only: forgets the listener and any waiting request. */
export function resetSearchFieldControl(): void {
  listener = null;
  pending = null;
}
