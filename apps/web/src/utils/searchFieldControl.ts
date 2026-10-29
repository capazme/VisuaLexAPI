import { appStore } from '../store/useAppStore';

/**
 * The search page's field, reached from elsewhere: the sidebar's «Ricerca», the empty page's button and
 * examples, an empty practice, ⌘K, the menu giving its words back. The field grows into the search menu
 * (R2): a request opens the menu with the field's words, unless it only puts words back (`open: false`) or
 * only the cursor (`focus`).
 * A request made before the field is mounted (the sidebar's click, which also navigates to the search page)
 * asks to wait for it, briefly, and is taken once: a field that never comes does not take it minutes later.
 */
export interface SearchFieldRequest {
  /** Words to put in the field; absent, the field keeps what it holds. */
  text?: string;
  /** Open the menu from the field (the default); false only sets the words (the menu closing). */
  open?: boolean;
  /**
   * Only put the cursor on the field, no menu over the page: the sidebar's «Ricerca» (the owner, 13 Oct 2026). The
   * first key typed on it opens the menu with that key.
   */
  focus?: boolean;
}

type Listener = (request: SearchFieldRequest) => void;

/** The palette's shortcut as this keyboard writes it: the sidebar's «Ricerca» and the field show it. */
export const PALETTE_SHORTCUT = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘K' : 'Ctrl K';

/** The id of the field's form: the menu grows from it on a computer. */
export const SEARCH_FIELD_FORM_ID = 'search-field-form';

let listener: Listener | null = null;
let pending: { request: SearchFieldRequest; at: number } | null = null;

/** How long a request waits for the field to mount. */
const PENDING_MS = 2000;

/**
 * Opens the menu from the search page's field, optionally filling it (or, with `focus`, only puts the cursor on
 * it). Says whether the field took it; with `wait`,
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

/** ⌘K: the field grows into the menu with its words when it is on screen; else the menu opens empty. */
export function openSearchMenu(): void {
  // Already open: nothing, as before R2 (the field's words would overwrite what is being typed in the box).
  if (appStore.getState().commandPaletteOpen) return;
  if (listener) listener({});
  else appStore.getState().openCommandPalette();
}

/**
 * The menu closing gives its words back to the field (R2: one field), or empties it after a choice. No field on
 * screen: nothing to give them to.
 */
export function returnWordsToSearchField(text: string): void {
  listener?.({ text, open: false });
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
