import { appStore } from '../store/useAppStore';
import { isWorkspaceCovered } from './findWindowControl';

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
/** The top bar's search pill (LC40): the menu grows out of it, as an island, on every page from lg. */
export const SEARCH_ISLAND_ID = 'search-island';
/** The island's one surface (LC69), Pietra's card: the pill and the panel it grows into wear the same ground and edge. */
export const ISLAND_SURFACE = 'border border-border bg-card';
/**
 * The pill's hover and focus (LC69, Luca: «è grossa la barra, va resa più elegante»). Hover: the one edge darkens. Focus
 * from the keyboard: the edge in the text's colour and a 1 px ring against it, read as one 2 px edge (the anti-slop
 * review: a tone alone is not seen); no offset, so never the second outline the field's ring and the base rule's
 * offset ring (`index.css`) drew. A tap's focus keeps the 1 px edge.
 */
export const ISLAND_FOCUS = 'hover:border-foreground/30 focus:outline-none focus-visible:border-foreground focus-visible:ring-1 focus-visible:ring-foreground focus-visible:ring-offset-0';
/** A pill thinner than a finger: its target is 44 px tall, centred on its drawn edge (40 px: 2 above and below). */
export const ISLAND_TARGET = "after:absolute after:inset-x-0 after:inset-y-[calc(50%-22px)] after:content-['']";
/**
 * LC81: the pill and the panel's field are one object, so the shape grows without a jump. Below lg (the phone's and the
 * search page's pill) 40 px and the field's type (16 px on a phone); from lg (the top bar's pill) 32 px and 13 px. The
 * lens sits 12 px in, the words 36 px in, on both.
 */
export const ISLAND_SHAPE = 'relative flex h-10 min-w-0 items-center rounded-full pl-9 pr-3 lg:h-8 lg:pr-2';
export const ISLAND_TEXT = 'text-[length:max(1rem,16px)] md:text-sm lg:text-[13px]';
export const ISLAND_LENS = 'pointer-events-none absolute left-3 size-4 shrink-0 text-slate-400 lg:size-[15px]';
/** The pill's words and its hint, the field's text and placeholder. */
export const ISLAND_WORDS = 'text-slate-900 dark:text-white';
export const ISLAND_HINT = 'text-slate-500 dark:text-slate-400';
export const ISLAND_PLACEHOLDER = 'Norma, sentenza o tema';
/**
 * `ISLAND_FOCUS` for the panel's field, on its frame. An input matches `:focus-visible` after a tap too, so the frame
 * reads how the focus came (`data-keyboard`, set by the panel): 2 px from the keyboard, the 1 px edge from a pointer.
 */
export const ISLAND_FIELD_FOCUS = 'hover:border-foreground/30 data-[keyboard]:has-[input:focus]:border-foreground data-[keyboard]:has-[input:focus]:ring-1 data-[keyboard]:has-[input:focus]:ring-foreground';

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
  // Under what covers the page (a modal dialog, the comparison, a sheet, the PDF viewer): the menu opens in the page,
  // under it, unseen (L-75).
  if (isWorkspaceCovered()) return;
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
