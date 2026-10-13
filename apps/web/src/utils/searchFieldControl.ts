/**
 * The search page's field, reached from elsewhere: the sidebar's «Ricerca», the empty page's button and
 * examples, an empty practice. A request made before the field is mounted (a click that also navigates
 * to the search page) waits for it, briefly, and is taken once: a field that never comes (Focus mode
 * hides it) does not take it minutes later.
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

/** Focuses the search page's field, optionally filling it. */
export function focusSearchField(request: SearchFieldRequest = {}): void {
  if (listener) listener(request);
  else pending = { request, at: Date.now() };
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
