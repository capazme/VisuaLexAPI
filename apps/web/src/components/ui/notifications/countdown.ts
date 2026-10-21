/** Why a countdown is held: a pointer over the notification, the focus in it, a finger on it, the tab hidden. */
export type HoldReason = 'hover' | 'focus' | 'touch' | 'hidden';

export interface Countdown {
  /** Holds the time while `reason` lasts; the countdown runs again when no reason is left. */
  hold: (reason: HoldReason, on: boolean) => void;
  /** Stops it for good: `onEnd` is never called. */
  stop: () => void;
  /** The time left, in ms. */
  remaining: () => number;
  /** Whether a reason holds it. */
  held: () => boolean;
}

/**
 * A time that runs out, held while any reason holds it. The tab being hidden is a reason of its own: a notification
 * that fired in a hidden tab is still there when the reader comes back. `onChange` says when it is held or let go,
 * for the drawing of the time left.
 */
export function startCountdown(ms: number, onEnd: () => void, onChange?: () => void): Countdown {
  let left = ms;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const reasons = new Set<HoldReason>();

  const run = () => {
    startedAt = Date.now();
    timer = setTimeout(() => {
      timer = undefined;
      left = 0;
      stop();
      onEnd();
    }, left);
  };
  const pause = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    left = Math.max(0, left - (Date.now() - startedAt));
  };
  const onVisibility = () => hold('hidden', document.hidden);
  function stop() {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    document.removeEventListener('visibilitychange', onVisibility);
  }
  function hold(reason: HoldReason, on: boolean) {
    if (stopped || reasons.has(reason) === on) return;
    const before = reasons.size > 0;
    if (on) reasons.add(reason);
    else reasons.delete(reason);
    const now = reasons.size > 0;
    if (before === now) return;
    if (now) pause();
    else run();
    onChange?.();
  }

  document.addEventListener('visibilitychange', onVisibility);
  if (document.hidden) reasons.add('hidden');
  else run();

  return {
    hold,
    stop,
    remaining: () => (timer === undefined ? left : Math.max(0, left - (Date.now() - startedAt))),
    held: () => reasons.size > 0,
  };
}
