import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { NotificationCard } from './notifications/NotificationCard';
import { startCountdown, type Countdown } from './notifications/countdown';
import { closeNotification, notificationStore, notify, type NotificationEntry } from './notifications/notifications';

export { NotificationHost } from './notifications/NotificationHost';

export interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  isVisible: boolean;
  onClose: () => void;
  /** ms before it closes by itself; 0 stays until closed. */
  duration?: number;
  position?: 'top' | 'bottom';
  /** Optional action button */
  action?: {
    label: string;
    onClick: () => void;
  };
  /**
   * aria-live politeness. Defaults to 'polite', but errors are announced
   * with 'assertive' so screen readers interrupt.
   */
  ariaLive?: 'polite' | 'assertive' | 'off';
  /** Extra classes for the toast drawn alone (no stack mounted): a band of `constants/zIndex.ts` (`Z_INDEX.toast`). */
  className?: string;
}

/**
 * A plain notification (K1a): while `isVisible` it is drawn in the app's stack (`NotificationHost`, in `Layout`) with
 * the entrance from a line and no time line, and `onClose` is called when it goes — its time ran out, ✕, Esc, a swipe,
 * or a fourth pushed it out. Where no stack is mounted (a component's test, a page outside the layout) it draws itself,
 * alone, at its edge. Its time runs only while the tab is on screen and nobody is on it.
 */
export function Toast({ message, type, isVisible, onClose, duration = 3000, position = 'bottom', action, ariaLive, className }: ToastProps) {
  const hosted = notificationStore((s) => s.hosts > 0);
  const onCloseRef = useRef(onClose);
  const actionRef = useRef(action);
  useEffect(() => {
    onCloseRef.current = onClose;
    actionRef.current = action;
  });
  const actionLabel = action?.label;

  useEffect(() => {
    if (!isVisible || !hosted) return;
    const id = notify({
      type,
      message,
      duration,
      position,
      ariaLive,
      action: actionLabel ? { label: actionLabel, onClick: () => actionRef.current?.onClick() } : undefined,
      // Taken back by this toast (hidden, or another message): its owner already knows.
      onClose: (reason) => reason !== 'external' && onCloseRef.current(),
    });
    return () => closeNotification(id, 'external');
  }, [isVisible, hosted, message, type, duration, position, ariaLive, actionLabel]);

  if (hosted || !isVisible) return null;
  return <StandaloneToast {...{ message, type, duration, position, action, ariaLive, className }} onClose={() => onCloseRef.current()} />;
}

/** A toast drawn alone, where no stack is mounted: the same card, at its edge, with its own time. */
function StandaloneToast({ message, type, duration, position, action, ariaLive, className, onClose }: Omit<ToastProps, 'isVisible' | 'duration' | 'position'> & { duration: number; position: 'top' | 'bottom' }) {
  const still = useReducedMotion() ?? false;
  const countdown = useRef<Countdown | null>(null);
  const [clock, setClock] = useState({ remaining: duration, held: false });
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (duration <= 0) return;
    const running = startCountdown(duration, () => close.current(), () => setClock({ remaining: running.remaining(), held: running.held() }));
    countdown.current = running;
    return () => running.stop();
  }, [duration]);

  const entry: NotificationEntry = { id: 0, type, message, position, duration, undoable: false, action, ariaLive, closing: null, clock };
  // On a phone the width less a 16 px gutter; from `md` at the right.
  const edge = position === 'top' ? 'top-4 inset-x-4 md:inset-x-auto md:right-4' : 'bottom-4 inset-x-4 md:inset-x-auto md:bottom-8 md:right-8';
  return (
    // It announces itself; in the stack, the stack's live regions do.
    <div role="alert" aria-live={ariaLive ?? (type === 'error' ? 'assertive' : 'polite')} aria-atomic="true" className={cn('fixed z-[60] md:w-[26rem]', edge, className)}>
      <NotificationCard
        entry={entry}
        still={still}
        standalone
        onUndo={() => {}}
        onDismiss={onClose}
        onHold={(reason, on) => countdown.current?.hold(reason, on)}
        onExited={() => {}}
      />
    </div>
  );
}
