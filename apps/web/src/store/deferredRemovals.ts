import {
  announce,
  closeNotification,
  notify,
  offerShortcutUndo,
  RESTORED_MS,
  UNDO_MS,
  withdrawShortcutUndo,
} from '../components/ui/notifications/notifications';
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
  const sentIn = session;
  if (onExit) {
    const token = getAccessToken();
    void fetch(`${API_BASE_URL}${what.path}`, {
      method: 'DELETE',
      keepalive: true,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((response) => {
        // The token ran out while the removal waited (a highlight's waits for the next gesture, A4) and the page lived
        // on (a desktop's change of tab): it goes again by `apiClient`, which refreshes the token first.
        if (response.status === 401 && sentIn === session) deleteNow(what, false, putBack, onRefused);
      })
      .catch(() => {});
    return;
  }
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
  /** What the notification says: «Nota rimossa». */
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

/** What a gesture removes, and how it is taken back. */
interface HeldRemovals<T> {
  /** What is removed: none for a gesture that only changes or creates (a colour, a new highlight, A4), whose undo is `onUndo` alone. */
  targets: RemovalTarget<T>[];
  putBack: (item: T) => void;
  onRefused: (error: unknown) => void;
  /** The undo also takes back what came with the removals (the parts a cut created, a colour changed), after them. */
  onUndo?: () => void;
  /**
   * What the removals wait for (A4: the parts a cut created, still being saved): sent only once it resolves true, so a
   * page that goes before sends nothing and the items stay on the server, rather than their parts be lost with it.
   * False (a part refused) takes the gesture back at once — the items put back, `onUndo` run — with nothing said but
   * the refusal.
   */
  ready?: Promise<boolean>;
}

export interface DeferredRemovals<T> extends HeldRemovals<T> {
  message: string;
}

/**
 * The removals of one gesture, held until they are sent (`send`: the undo's time is over, the page goes) or the
 * gesture is taken back (`undo`). Held, a reading leaves them out (`pending`); `close` takes away the way the undo was
 * offered (a notification, the shortcut) once they are sent or a part refused takes the gesture back.
 */
function holdRemovals<T>({ targets, putBack, onRefused, onUndo, ready }: HeldRemovals<T>, close: () => void) {
  if (targets.length > 0) void getFreshAccessToken().catch(() => null);
  const madeIn = session;
  let settled = false;
  // Each removed item, retargeted once a creation still out is answered; null when it never reached the server.
  const slots: { target: RemovalTarget<T> | null }[] = targets.map((target) => ({ target }));
  // `ready`'s answer, once given; and whether the removals, sent, wait for it.
  let readiness: boolean | null = ready ? null : true;
  let waiting = false;

  /** A part refused: the gesture taken back, as the undo would, with nothing said but the refusal. */
  const takeBack = () => {
    for (const slot of slots) {
      if (!slot.target) continue;
      pending.delete(slot.target.key);
      inFlight.delete(slot.target.key);
      putBack(slot.target.item);
    }
    onUndo?.();
  };
  ready?.then((ok) => {
    readiness = ok;
    // Answered after a logout: the store is the next account's.
    if (ok || madeIn !== session) return;
    if (!settled) {
      settled = true;
      close();
      takeBack();
    } else if (waiting) {
      waiting = false;
      takeBack();
    }
  });

  const removeAll = (onExit: boolean) => {
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

  const send = (onExit = false) => {
    if (settled) return;
    settled = true;
    for (const slot of slots) if (slot.target) pending.delete(slot.target.key);
    close();
    if (readiness === false) return;
    if (readiness === null) {
      // What they wait for is still on its way: sent once it is saved, by an ordinary request (the page lived on); a
      // reading meanwhile still leaves them out.
      waiting = true;
      for (const slot of slots) if (slot.target) inFlight.add(slot.target.key);
      void ready?.then((ok) => {
        if (!ok || !waiting || madeIn !== session) return;
        waiting = false;
        for (const slot of slots) if (slot.target) inFlight.delete(slot.target.key);
        removeAll(false);
      });
      return;
    }
    removeAll(onExit);
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

  return {
    send,
    /** Taken back: the items put back where they were, then `onUndo`; false when there was nothing to take back. */
    undo: (): boolean => {
      if (settled) return false;
      settled = true;
      if (!onUndo && slots.every((slot) => !slot.target)) return false;
      for (const slot of slots) {
        if (!slot.target) continue;
        pending.delete(slot.target.key);
        putBack(slot.target.item);
      }
      onUndo?.();
      return true;
    },
    /** Forgotten, unsent (a logout): the page going later sends nothing either. */
    forget: () => {
      settled = true;
      for (const slot of slots) if (slot.target) pending.delete(slot.target.key);
    },
  };
}

/**
 * `removeWithUndo` for one gesture that removes several items: one notification, one «Annulla» that puts them all back
 * (and runs `onUndo`), all sent as it closes or the page goes.
 */
export function removeManyWithUndo<T>({ message, ...held }: DeferredRemovals<T>): void {
  let notification: number | null = null;
  const removals = holdRemovals(held, () => {
    if (notification !== null) closeNotification(notification, 'external');
  });
  notification = notify({
    type: 'info',
    message,
    duration: UNDO_MS,
    onUndo: () => {
      // Nothing left to put back (every creation failed) and nothing else to take back: no «Ripristinato».
      if (!removals.undo()) return;
      notify({ type: 'success', message: 'Ripristinato', duration: RESTORED_MS, after: notification ?? undefined });
    },
    // Dropped at logout: forgotten, so the page going later sends nothing either.
    onClose: (reason) => {
      if (reason === 'dropped') removals.forget();
      else if (reason !== 'undo') removals.send();
    },
  });
}

export interface HeldGesture<T> extends HeldRemovals<T> {
  /** What the gesture did («Evidenziazione rimossa»): said to a screen reader as it is done, never shown. */
  message: string;
  /** Whether the gesture's text is on screen: the shortcut undoes it only then. */
  onScreen: () => boolean;
}

/**
 * A gesture on the user's highlights (A4, the owner's correction of 5 November 2026: «l'avviso per le evidenziazioni lo
 * toglierei proprio … al massimo devo poter fare cmd + z»): no notification, its words said to a screen reader alone;
 * Ctrl+Z (⌘Z on a Mac) takes it back, with no time limit, while it is the last gesture and its text is on screen
 * (`offerShortcutUndo`). Its removals are held until the next gesture takes its place, so a highlight taken from the
 * Forum and put back is the same row with its first author (gotcha 21), never one created again without it; they are
 * sent as the page goes or is hidden too (as `removeWithUndo`'s, and the shortcut's undo goes with them), and at logout,
 * before the token goes (`settleShortcutUndo`).
 */
export function holdGesture<T>({ message, onScreen, ...held }: HeldGesture<T>): void {
  let offer: number | null = null;
  const removals = holdRemovals(held, () => {
    if (offer !== null) withdrawShortcutUndo(offer);
  });
  offer = offerShortcutUndo({
    message,
    ready: onScreen,
    undo: () => { removals.undo(); },
    settle: (asThePageGoes) => removals.send(asThePageGoes),
  });
  announce(message);
}
