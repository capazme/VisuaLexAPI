import { create } from 'zustand';
import { startCountdown, type Countdown, type HoldReason } from './countdown';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

/**
 * Why a notification goes: its time ran out, the user closed it (✕, Esc, a swipe), «Annulla», a fourth pushed it out
 * of the stack, or what showed it took it back (a `Toast` no longer visible). The card's exit follows it (K1a).
 */
export type CloseReason = 'timeout' | 'dismiss' | 'undo' | 'evicted' | 'external';

/** At most this many on each edge: a fourth closes the oldest (K1a). */
export const STACK_MAX = 3;
/** «Annulla»'s time (K1a: it stays 5 seconds). */
export const UNDO_MS = 5000;
/** How long «Ripristinato» stays after «Annulla». */
export const RESTORED_MS = 1500;

export interface NotificationInput {
  type: NotificationType;
  message: string;
  /** Where the stack is: at the bottom (the default) or at the top of the screen. */
  position?: 'top' | 'bottom';
  /** ms before it closes by itself; 0 stays until closed. */
  duration: number;
  /** «Annulla»: given, the notification draws its time left on the line. */
  onUndo?: () => Promise<void> | void;
  /** Another action of its own (a plain toast's). */
  action?: { label: string; onClick: () => void };
  ariaLive?: 'polite' | 'assertive' | 'off';
  /** Told once, whatever closes it. */
  onClose?: (reason: CloseReason) => void;
  /** Drawn where this one is (it takes its place in the stack): «Ripristinato» after «Annulla». */
  after?: number;
}

export interface NotificationEntry {
  id: number;
  type: NotificationType;
  message: string;
  position: 'top' | 'bottom';
  duration: number;
  undoable: boolean;
  action?: { label: string; onClick: () => void };
  ariaLive?: 'polite' | 'assertive' | 'off';
  /** Set when it starts to leave; the card plays its exit, then removes it. */
  closing: CloseReason | null;
  /** The time left when last held or let go, and whether it is held: what the line draws. */
  clock: { remaining: number; held: boolean };
}

interface Handlers {
  countdown: Countdown | null;
  onUndo?: () => Promise<void> | void;
  onClose?: (reason: CloseReason) => void;
}

/** What the live regions read: the latest notification to arrive, by its politeness, and only on arrival. */
export interface Announcement {
  id: number;
  message: string;
}

interface NotificationsState {
  entries: NotificationEntry[];
  /** Set by `notify` and nothing else: a notification closing never makes an older one read again. */
  announced: { polite: Announcement | null; assertive: Announcement | null };
  /** The stacks on screen (`NotificationHost`): with none, a notification closes without an exit to wait for. */
  hosts: number;
}

export const notificationStore = create<NotificationsState>()(() => ({ entries: [], announced: { polite: null, assertive: null }, hosts: 0 }));

const handlers = new Map<number, Handlers>();
/**
 * Where an undone notification stood: the id of the one drawn just before it (older), or null when it was the oldest.
 * «Ripristinato» takes that place even when the undo outlasted the exit and the notification is gone from the list.
 */
const undoneSlots = new Map<number, number | null>();
let nextId = 1;

const patch = (id: number, change: Partial<NotificationEntry>) =>
  notificationStore.setState((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, ...change } : e)) }));

/** Takes it off the screen's list: the card calls it at the end of its exit. */
export function removeNotification(id: number) {
  handlers.delete(id);
  notificationStore.setState((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
}

/** Closes one: it stops answering at once (nothing in it takes a click or a key), then plays its exit. */
export function closeNotification(id: number, reason: CloseReason) {
  const entry = notificationStore.getState().entries.find((e) => e.id === id);
  if (!entry || entry.closing) return;
  const own = handlers.get(id);
  own?.countdown?.stop();
  if (reason === 'undo') {
    const entries = notificationStore.getState().entries;
    undoneSlots.set(id, entries[entries.findIndex((e) => e.id === id) - 1]?.id ?? null);
  }
  if (notificationStore.getState().hosts === 0) removeNotification(id);
  else patch(id, { closing: reason });
  own?.onClose?.(reason);
}

/** «Annulla»: closes it and hands over to the action's undo; resolves when the undo is done. */
export async function undoNotification(id: number): Promise<void> {
  const entry = notificationStore.getState().entries.find((e) => e.id === id);
  if (!entry || entry.closing || !entry.undoable) return;
  const onUndo = handlers.get(id)?.onUndo;
  closeNotification(id, 'undo');
  await onUndo?.();
}

/** Holds its time while `reason` lasts (a pointer over it, the focus in it, a finger on it). */
export function holdNotification(id: number, reason: HoldReason, on: boolean) {
  handlers.get(id)?.countdown?.hold(reason, on);
}

/** Shows a notification; returns its id. */
export function notify(input: NotificationInput): number {
  const id = nextId++;
  const position = input.position ?? 'bottom';
  const entry: NotificationEntry = {
    id,
    type: input.type,
    message: input.message,
    position,
    duration: input.duration,
    undoable: Boolean(input.onUndo),
    action: input.action,
    ariaLive: input.ariaLive,
    closing: null,
    clock: { remaining: input.duration, held: false },
  };
  const own: Handlers = { countdown: null, onUndo: input.onUndo, onClose: input.onClose };
  handlers.set(id, own);

  // A fourth on the same edge closes the oldest; one put in another's place does not count it.
  const live = notificationStore.getState().entries.filter((e) => e.position === position && !e.closing && e.id !== input.after);
  live.slice(0, Math.max(0, live.length - STACK_MAX + 1)).forEach((e) => closeNotification(e.id, 'evicted'));

  const politeness = input.ariaLive ?? (input.type === 'error' ? 'assertive' : 'polite');
  notificationStore.setState((s) => ({
    entries: placeAfter(s.entries, entry, input.after),
    announced: politeness === 'off' ? s.announced : { ...s.announced, [politeness]: { id, message: input.message } },
  }));

  if (input.duration > 0) {
    own.countdown = startCountdown(
      input.duration,
      () => closeNotification(id, 'timeout'),
      () => {
        const c = own.countdown;
        if (c) patch(id, { clock: { remaining: c.remaining(), held: c.held() } });
      },
    );
    if (own.countdown.held()) patch(id, { clock: { remaining: input.duration, held: true } });
  }
  return id;
}

/**
 * `entry` drawn where `after` is (just after it in the list, which the stack shows newest first), or where `after`
 * stood if it is gone already (`undoneSlots`); else at the end, the newest.
 */
function placeAfter(entries: NotificationEntry[], entry: NotificationEntry, after: number | undefined): NotificationEntry[] {
  if (after === undefined) return [...entries, entry];
  let at = entries.findIndex((e) => e.id === after);
  if (at < 0 && undoneSlots.has(after)) {
    const before = undoneSlots.get(after);
    at = before === null ? -1 : entries.findIndex((e) => e.id === before);
    if (before !== null && at < 0) return [...entries, entry];
  } else if (at < 0) {
    return [...entries, entry];
  }
  undoneSlots.delete(after);
  return [...entries.slice(0, at + 1), entry, ...entries.slice(at + 1)];
}

/** A stack on screen counts itself while it is mounted (`NotificationHost`). */
export function registerNotificationHost(): () => void {
  notificationStore.setState((s) => ({ hosts: s.hosts + 1 }));
  return () => notificationStore.setState((s) => ({ hosts: s.hosts - 1 }));
}

/** For tests: no notification. The stacks count themselves out as they unmount. */
export function resetNotifications() {
  handlers.forEach((h) => h.countdown?.stop());
  handlers.clear();
  undoneSlots.clear();
  notificationStore.setState({ entries: [], announced: { polite: null, assertive: null } });
}
