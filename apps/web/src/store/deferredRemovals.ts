import { closeNotification, notify, RESTORED_MS, UNDO_MS } from '../components/ui/notifications/notifications';
import { getFreshAccessToken } from '../services/api';
import { getAccessToken } from '../services/authService';

// As `apiClient`'s base: the exit's removal is a plain `fetch`.
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

/** What a removal removes on the server, and what «Annulla» puts back. */
export interface RemovalTarget<T> {
  /** `highlight:<id>`: what it removes, unique. */
  key: string;
  /** The API path of the removal (`/highlights/<id>`), for the exit's request. */
  path: string;
  /** The removal itself, through `apiClient`. */
  remove: () => Promise<void>;
  /** The item as «Annulla» puts it back. */
  item: T;
}

interface Pending {
  /** Sends the removal now: by `apiClient`, or as the page goes by a `keepalive` fetch. */
  send: (onExit?: boolean) => void;
  /** The item was saved meanwhile under its server id (or its saving failed: null). */
  retarget: (saved: RemovalTarget<unknown> | null) => void;
}

/** Removals waiting behind «Annulla», by what they remove. */
const pending = new Map<string, Pending>();
/** Removals sent and not yet answered: a reading meanwhile must not draw them back either. */
const inFlight = new Set<string>();
/** Items created and not yet answered, by their temporary key: a removal of one waits for the server's id. */
const saving = new Map<string, ((saved: RemovalTarget<unknown> | null) => void)[]>();
/** Bumped at logout: an answer to a removal sent before it puts nothing back in the next account's store. */
let session = 0;

/**
 * At logout (`clearUserData`): what waits is forgotten (its notifications are dropped too), and an answer still out for
 * a removal sent before puts nothing back and says nothing.
 */
export function forgetRemovals() {
  session++;
  pending.clear();
  inFlight.clear();
  saving.clear();
}

/**
 * Sent as the page goes (`pagehide`) or is hidden (`visibilitychange`): a phone's browser often discards a tab in the
 * background without a `pagehide`. The cost: «Annulla» is gone once the tab is hidden.
 */
function sendAllOnExit() {
  for (const { send } of [...pending.values()]) send(true);
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', sendAllOnExit);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendAllOnExit();
  });
}

/** Waiting behind «Annulla», or sent and not answered: a reading meanwhile must not draw it back (the server has it). */
export function isRemovalPending(key: string): boolean {
  return pending.has(key) || inFlight.has(key);
}

/** An optimistic item is being created under `key` (its temporary id): a removal meanwhile waits for its answer. */
export function savingStarted(key: string) {
  saving.set(key, []);
}

/**
 * The creation of `key` answered: `saved` is the item under its server id, or null when it failed. A removal waiting
 * behind «Annulla» now removes the saved one (and «Annulla» puts that one back); one already sent goes out now.
 */
export function savingDone<T>(key: string, saved: RemovalTarget<T> | null) {
  const waiters = saving.get(key) ?? [];
  saving.delete(key);
  pending.get(key)?.retarget(saved as RemovalTarget<unknown> | null);
  for (const waiter of waiters) waiter(saved as RemovalTarget<unknown> | null);
}

/**
 * Runs `then` once the creation of `key` has answered — at once when none is out: with the saved item's target, null
 * when the creation failed, undefined when nothing was out (the item has its server id already). A write on an item
 * still being created (a colour changed, A4) waits for its id this way.
 */
export function afterSaving(key: string, then: (saved: RemovalTarget<unknown> | null | undefined) => void) {
  const waiters = saving.get(key);
  if (waiters) waiters.push(then);
  else then(undefined);
}

/** The removal itself: by `apiClient`, or as the page goes by a `keepalive` fetch; refused, the item is put back. */
function deleteNow<T>(what: RemovalTarget<T>, onExit: boolean, putBack: (item: T) => void, onRefused: (error: unknown) => void) {
  if (onExit) {
    const token = getAccessToken();
    void fetch(`${API_BASE_URL}${what.path}`, {
      method: 'DELETE',
      keepalive: true,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {});
    return;
  }
  const sentIn = session;
  inFlight.add(what.key);
  what.remove()
    .then(() => { inFlight.delete(what.key); })
    .catch((error: unknown) => {
      // Answered after a logout: the store is the next account's, nothing goes back into it.
      if (sentIn !== session) return;
      inFlight.delete(what.key);
      // Already gone from the server: what was wanted.
      if ((error as { status?: number } | null)?.status === 404) return;
      putBack(what.item);
      onRefused(error);
    });
}

/**
 * A removal with no «Annulla» of its own — what an «Annulla» takes back (the parts a cut created, A4): sent now, or once
 * the creation still out answers (none if it fails). Refused, the item is put back and the caller says so.
 */
export function removeAtOnce<T>(target: RemovalTarget<T>, putBack: (item: T) => void, onRefused: (error: unknown) => void) {
  const waiters = saving.get(target.key);
  if (waiters) {
    waiters.push((saved) => { if (saved) deleteNow(saved as RemovalTarget<T>, false, putBack, onRefused); });
    return;
  }
  deleteNow(target, false, putBack, onRefused);
}

export interface DeferredRemoval<T> extends RemovalTarget<T> {
  /** What the notification says: «Evidenziazione rimossa». */
  message: string;
  /** «Annulla», or a refused removal: puts `item` back where it was. */
  putBack: (item: T) => void;
  /** A refused removal, put back: says so (the caller's words). */
  onRefused: (error: unknown) => void;
}

/**
 * A removal behind «Annulla» (the D7b bin's pattern, `assistantProposals.removeProposal`): the caller has taken the
 * item off the screen; the notification offers «Annulla» for `UNDO_MS`; the removal is sent when the notification
 * closes, or at once as the page goes or is hidden (a `keepalive` fetch with a token refreshed now, since that fetch
 * cannot refresh it). «Annulla» puts it back and sends nothing, then says «Ripristinato»; a refused removal puts it back
 * and says why; one the server no longer has (404) is a removal done. An item still being created is removed under the
 * id the server gives it, or not at all if its creation failed. At logout nothing is sent: `clearUserData` drops every
 * notification (`dropped`), which forgets what it held.
 */
export function removeWithUndo<T>({ message, putBack, onRefused, ...first }: DeferredRemoval<T>): void {
  removeManyWithUndo({ message, putBack, onRefused, targets: [first] });
}

export interface DeferredRemovals<T> {
  message: string;
  /** What is removed: none for a gesture that only changes (a colour, A4), whose «Annulla» is `onUndo` alone. */
  targets: RemovalTarget<T>[];
  putBack: (item: T) => void;
  onRefused: (error: unknown) => void;
  /** «Annulla» also takes back what came with the removals (the parts a cut created, a colour changed), after them. */
  onUndo?: () => void;
}

/**
 * `removeWithUndo` for one gesture that removes several items (A4: a highlight cut, «Nessun colore» over many): one
 * notification, one «Annulla» that puts them all back (and runs `onUndo`), all sent as it closes or the page goes.
 */
export function removeManyWithUndo<T>({ message, targets, putBack, onRefused, onUndo }: DeferredRemovals<T>): void {
  if (targets.length > 0) void getFreshAccessToken().catch(() => null);
  let settled = false;
  let notification: number | null = null;
  // Each removed item, retargeted once a creation still out is answered; null when it never reached the server.
  const slots: { target: RemovalTarget<T> | null }[] = targets.map((target) => ({ target }));

  const send = (onExit = false) => {
    if (settled) return;
    settled = true;
    for (const slot of slots) if (slot.target) pending.delete(slot.target.key);
    if (notification !== null) closeNotification(notification, 'external');
    for (const { target } of slots) {
      if (!target) continue;
      const waiters = saving.get(target.key);
      if (waiters) {
        // Still being created: removed under the server's id once it answers (none if it fails). Even when sent by the
        // tab being hidden (a desktop's change of tab), the page lives on and the answer comes: dropping it would leave
        // the mark on the server, back at the next reading. A page that really goes never hears the id.
        waiters.push((saved) => { if (saved) deleteNow(saved as RemovalTarget<T>, false, putBack, onRefused); });
        continue;
      }
      deleteNow(target, onExit, putBack, onRefused);
    }
  };

  for (const slot of slots) {
    const entry: Pending = {
      send,
      retarget: (saved) => {
        if (slot.target) pending.delete(slot.target.key);
        slot.target = saved as RemovalTarget<T> | null;
        if (slot.target) pending.set(slot.target.key, entry);
      },
    };
    if (slot.target) pending.set(slot.target.key, entry);
  }
  notification = notify({
    type: 'info',
    message,
    duration: UNDO_MS,
    onUndo: () => {
      if (settled) return;
      settled = true;
      // Nothing left to put back (every creation failed) and nothing else to take back: no «Ripristinato».
      if (!onUndo && slots.every((slot) => !slot.target)) return;
      for (const slot of slots) {
        if (!slot.target) continue;
        pending.delete(slot.target.key);
        putBack(slot.target.item);
      }
      onUndo?.();
      notify({ type: 'success', message: 'Ripristinato', duration: RESTORED_MS, after: notification ?? undefined });
    },
    // Dropped at logout: forgotten, so the page going later sends nothing either.
    onClose: (reason) => {
      if (reason === 'dropped') {
        for (const slot of slots) if (slot.target) pending.delete(slot.target.key);
      } else if (reason !== 'undo') send();
    },
  });
}
