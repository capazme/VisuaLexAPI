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
  void getFreshAccessToken().catch(() => null);
  // What is removed: retargeted once a creation still out is answered; null when it never reached the server.
  let target: RemovalTarget<T> | null = first;
  let settled = false;
  let notification: number | null = null;

  const deleteNow = (what: RemovalTarget<T>, onExit: boolean) => {
    if (onExit) {
      const token = getAccessToken();
      void fetch(`${API_BASE_URL}${what.path}`, {
        method: 'DELETE',
        keepalive: true,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).catch(() => {});
      return;
    }
    inFlight.add(what.key);
    what.remove()
      .then(() => { inFlight.delete(what.key); })
      .catch((error: unknown) => {
        inFlight.delete(what.key);
        // Already gone from the server: what was wanted.
        if ((error as { status?: number } | null)?.status === 404) return;
        putBack(what.item);
        onRefused(error);
      });
  };

  const send = (onExit = false) => {
    if (settled) return;
    settled = true;
    if (target) pending.delete(target.key);
    if (notification !== null) closeNotification(notification, 'external');
    if (!target) return;
    const waiters = saving.get(target.key);
    if (waiters) {
      // Still being created: removed under the server's id once it answers (none if it fails). An exit cannot wait.
      if (!onExit) waiters.push((saved) => { if (saved) deleteNow(saved as RemovalTarget<T>, false); });
      return;
    }
    deleteNow(target, onExit);
  };

  const entry: Pending = {
    send,
    retarget: (saved) => {
      if (target) pending.delete(target.key);
      target = saved as RemovalTarget<T> | null;
      if (target) pending.set(target.key, entry);
    },
  };
  pending.set(first.key, entry);
  notification = notify({
    type: 'info',
    message,
    duration: UNDO_MS,
    onUndo: () => {
      if (settled) return;
      settled = true;
      if (!target) return;
      pending.delete(target.key);
      putBack(target.item);
      notify({ type: 'success', message: 'Ripristinato', duration: RESTORED_MS, after: notification ?? undefined });
    },
    // Dropped at logout: forgotten, so the page going later sends nothing either.
    onClose: (reason) => {
      if (reason === 'dropped') {
        if (target) pending.delete(target.key);
      } else if (reason !== 'undo') send();
    },
  });
}
