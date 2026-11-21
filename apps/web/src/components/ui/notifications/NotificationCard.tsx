import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { motion, useAnimate, useDragControls, type AnimationPlaybackControls, type PanInfo } from 'framer-motion';
import { AlertCircle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { REPEAT_CLOSE, REPEAT_OPEN, ease } from '../../../lib/motion';
import { CARD_RADIUS, CONTROL_RADIUS } from '../controlStyles';
import type { HoldReason } from './countdown';
import type { NotificationEntry, NotificationType } from './notifications';
import { createSwipeGuard } from './swipeGuard';
import { IslandSurface } from '../IslandSurface';
import type { SourceRect } from '../IslandSurface';

/**
 * A notification (K1a, LC85): it grows out of a pill at the edge where it appears, which widens into the message, and
 * goes back into it as it closes (`IslandSurface`, the search island's way, L-76). «Annulla»'s time is the line at the
 * bottom, which draws back; held (a pointer, the focus, a finger on it) it stops and its ticks grow. Swiped away, it
 * leaves along the swipe instead, folding as it goes. Under reduced motion it fades in and out, and the time line still
 * draws back.
 */

/** The swipe's exit and its fade under reduced motion, in seconds. */
const NOTIFICATION_S = { away: 0.26, fade: 0.15 } as const;
const NOTIFICATION_TIMING = { open: REPEAT_OPEN, close: REPEAT_CLOSE };

/** The pill it grows from: 120 × 32 at the middle of the edge it appears at, or as wide as it where it is narrower. */
const PILL = { width: 120, height: 32 };
const pillAt = (position: 'top' | 'bottom') => (box: DOMRect): SourceRect => {
  const half = Math.min(PILL.width, box.width) / 2;
  const middle = box.left + box.width / 2;
  const top = position === 'top' ? box.top : box.bottom - PILL.height;
  return { left: middle - half, right: middle + half, top, bottom: top + PILL.height };
};

const ICONS: Record<NotificationType, typeof Info> = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertCircle };
const ICON_INK: Record<NotificationType, string> = {
  success: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-red-600 dark:text-red-400',
  info: 'text-primary-600 dark:text-primary-400',
  warning: 'text-amber-600 dark:text-amber-400',
};
/** The line is the app's ink, red for an error. */
const LINE_INK = (type: NotificationType) => (type === 'error' ? 'bg-red-600 dark:bg-red-400' : 'bg-primary-600 dark:bg-primary-400');

/** How far, or how fast, a swipe (a finger, or the mouse dragging it) has to go to close it; a shorter one goes back. */
const SWIPE_PX = 80;
const SWIPE_SPEED = 500;

export interface NotificationCardProps {
  entry: NotificationEntry;
  /** Reduced motion. */
  still: boolean;
  /** Alone, outside a stack (a `Toast` where no stack is mounted, as in a component's test): no swipe. */
  standalone?: boolean;
  /** The newest «Annulla»: the key that runs it, written beside it («Annulla · Ctrl+Z») and declared to assistive tech. */
  shortcut?: { label: string; keys: string };
  onUndo: () => void;
  onDismiss: () => void;
  onHold: (reason: HoldReason, on: boolean) => void;
  /** Its exit is over: take it off the list. */
  onExited: () => void;
}

export function NotificationCard({ entry, still, standalone = false, shortcut, onUndo, onDismiss, onHold, onExited }: NotificationCardProps) {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const swipedTo = useRef(1);
  const dragControls = useDragControls();
  // Whether a click is one: a press that moved the notification is not (`swipeGuard.ts`).
  const [swipe] = useState(() => createSwipeGuard());
  const timeLine = useRef<AnimationPlaybackControls | null>(null);
  const exited = useRef(false);
  // Swiped away: it leaves along the swipe, not into its pill.
  const [swiped, setSwiped] = useState(false);
  const Icon = ICONS[entry.type];
  const both = Boolean(entry.undoable && entry.action);
  const closing = entry.closing !== null;

  // «Annulla»'s time: the line at the bottom draws back over what is left, and stops while it is held.
  useEffect(() => {
    if (!entry.undoable || closing) return;
    const line = scope.current?.querySelector<HTMLElement>('[data-time]');
    if (!line) return;
    const share = entry.duration > 0 ? entry.clock.remaining / entry.duration : 0;
    timeLine.current?.stop();
    if (entry.clock.held) {
      void animate(line, { scaleX: share }, { duration: 0 });
      return;
    }
    timeLine.current = animate(line, { scaleX: [share, 0] }, { duration: entry.clock.remaining / 1000, ease: 'linear' });
    return () => timeLine.current?.stop();
  }, [entry.undoable, entry.clock, entry.duration, closing, animate, scope]);

  // Swiped away, it leaves along the swipe; every other closing goes back into its pill (`IslandSurface`, below). Stopped
  // before its end (StrictMode's second mount, in development), it runs again: a stopped animation never settles, and
  // the entry would stay drawn for ever.
  useEffect(() => {
    if (!closing || !swiped || exited.current) return;
    exited.current = true;
    const root = scope.current;
    const done = () => onExited();
    if (!root) return done();
    timeLine.current?.stop();
    const away = still
      ? animate(root, { opacity: 0 }, { duration: NOTIFICATION_S.fade })
      : animate(root, { transformPerspective: 600, rotateX: 50, x: `${swipedTo.current * 110}%`, opacity: 0 }, { duration: NOTIFICATION_S.away, ease: ease.inOut });
    away.then(done, done);
    return () => {
      exited.current = false;
    };
    // On the first frame it is closing; `entry.closing` does not change after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  /**
   * Closed from the keyboard (Esc, or ✕ and «Annulla» pressed with a key), it would take the focus down with it: the
   * focus goes to the next notification of the stack still open, if there is one. Never after a mouse click or a swipe:
   * the focus would land in a notification the user is not on and hold its time for ever (an import waiting for its
   * «Annulla» would never start).
   */
  const handOff = (then: () => void, fromKeys: boolean) => {
    const root = scope.current;
    if (fromKeys && root?.contains(document.activeElement)) {
      const next = [...(root.closest('ol')?.querySelectorAll<HTMLElement>('[data-card]:not([inert])') ?? [])].find((card) => card !== root);
      next?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    }
    then();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || closing) return;
    // The notification's Esc, not the page's: a dialog under it stays open.
    event.preventDefault();
    event.stopPropagation();
    handOff(onDismiss, true);
  };
  // A key's click (Enter, Space) has `detail` 0; a focus ring drawn says the keyboard brought the focus there.
  const byKeys = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) return true;
    try {
      return event.currentTarget.matches(':focus-visible');
    } catch {
      // A browser (or a test's DOM) that does not know the pseudo-class: a click with a pointer.
      return false;
    }
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    swipe.pressed();
    // A swipe to the side, by a finger or the mouse: the mouse not from a button, which it would press instead. Started
    // here (`dragListener` off), so framer-motion leaves the words selectable by a double or triple click.
    if (!closing && !standalone && (event.pointerType !== 'mouse' || !(event.target as Element).closest('button, a'))) {
      dragControls.start(event);
    }
    if (event.pointerType !== 'touch') return;
    onHold('touch', true);
    const release = () => {
      onHold('touch', false);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  };

  // A notification gone in the middle of a swipe gives the page its selection back.
  useEffect(() => () => {
    if (swipe.moving) document.body.style.userSelect = '';
  }, [swipe]);

  const onDragStart = () => {
    swipe.started();
    // A press on the words that turned into a swipe leaves no half selection behind, and makes none while it moves.
    window.getSelection()?.removeAllRanges();
    document.body.style.userSelect = 'none';
  };
  // A press that moved the notification is no click: let go over «Annulla» or ✕, a short swipe springs back and runs
  // nothing. A key's click (`detail` 0: Enter, Space, a screen reader) is always one.
  const onClickCapture = (event: ReactMouseEvent) => {
    if (!swipe.eats(event.detail)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    document.body.style.userSelect = '';
    swipe.ended();
    if (Math.abs(info.offset.x) < SWIPE_PX && Math.abs(info.velocity.x) < SWIPE_SPEED) return;
    swipedTo.current = info.offset.x < 0 ? -1 : 1;
    setSwiped(true);
    handOff(onDismiss, false);
  };

  return (
    <motion.div
      ref={scope}
      data-card
      // A finger or the mouse swipes it away; the drag starts in `onPointerDown`.
      drag={!closing && !standalone ? 'x' : false}
      dragListener={false}
      dragControls={dragControls}
      onDragStart={onDragStart}
      onClickCapture={onClickCapture}
      // Swiped away, it leaves from where the pointer let it go.
      dragSnapToOrigin={!closing}
      dragElastic={0.4}
      onDragEnd={onDragEnd}
      inert={closing || undefined}
      onPointerEnter={(event) => event.pointerType === 'mouse' && onHold('hover', true)}
      onPointerLeave={(event) => event.pointerType === 'mouse' && onHold('hover', false)}
      onFocus={() => onHold('focus', true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHold('focus', false);
      }}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      data-notification-id={entry.id}
      className={cn('relative w-full touch-pan-y', closing && 'pointer-events-none')}
    >
      <IslandSurface
        data-body
        source={pillAt(entry.position)}
        // A repeated action (LC132): 200 ms in, 150 out, not the island's 280/220.
        timing={NOTIFICATION_TIMING}
        // Every closing but a swipe goes back into the pill; the stack takes it off once it lands.
        open={!closing || swiped}
        onClosed={() => {
          if (exited.current) return;
          exited.current = true;
          onExited();
        }}
        // The page's paper, a thin border, ink: the typography does the work (K1a).
        surfaceClassName={cn('border border-slate-200 bg-background shadow-lg dark:border-slate-700', CARD_RADIUS)}
        contentClassName={cn('relative text-slate-800 dark:text-slate-100', CARD_RADIUS)}
      >
        {/* With two buttons the text keeps 13 rem of its own: where the row has no room for them, they go under it,
            at the right, with ✕ (it went one word to a line at 390 px, #595). One button keeps the single row. */}
        <div className={cn('flex items-center gap-2 py-1.5 pl-4 pr-1.5', both && 'flex-wrap')}>
          <span aria-hidden className={cn('shrink-0', ICON_INK[entry.type])}>
            <Icon size={18} />
          </span>
          <p className={cn('min-w-0 flex-1 py-2 text-sm font-medium leading-snug', both && 'basis-[min(13rem,100%)]')}>
            {entry.message}
          </p>
          <div className={cn('flex items-center gap-2', both && 'ml-auto')}>
            {entry.undoable && (
              <button
                type="button"
                onClick={(event) => handOff(onUndo, byKeys(event))}
                disabled={closing}
                aria-keyshortcuts={shortcut?.keys}
                className={cn(
                  CONTROL_RADIUS, 'min-h-[44px] shrink-0 px-3 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-900/30',
                  'focus-visible:outline-none ',
                )}
              >
                Annulla
                {/* Seen, not part of the name («Annulla»): `aria-keyshortcuts` says the key. */}
                {/* Not on a phone's width, where no keyboard is likely (Papiniano on #585). */}
                {shortcut && <span aria-hidden className="ml-1.5 text-xs font-medium text-slate-500 max-md:hidden dark:text-slate-400">· {shortcut.label}</span>}
              </button>
            )}
            {entry.action && (
              <button
                type="button"
                onClick={entry.action.onClick}
                disabled={closing}
                className={cn(
                  CONTROL_RADIUS, 'min-h-[44px] shrink-0 px-3 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-900/30',
                  'focus-visible:outline-none ',
                )}
              >
                {entry.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={(event) => handOff(onDismiss, byKeys(event))}
              disabled={closing}
              aria-label="Chiudi notifica"
              className={cn(
                CONTROL_RADIUS, 'grid h-11 w-11 shrink-0 place-items-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200',
                'focus-visible:outline-none ',
              )}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* «Annulla»'s time: the line draws back between two ticks, which grow while the time is held. */}
        {entry.undoable && (
          <div aria-hidden className="pointer-events-none absolute inset-x-3 bottom-0 h-px">
            <div data-time className={cn('h-px w-full origin-left', LINE_INK(entry.type))} />
            {(['left-0', 'right-0'] as const).map((side) => (
              <div
                key={side}
                className={cn(
                  'absolute bottom-0 h-1.5 w-px origin-bottom transition-transform duration-(--dur-pop) ease-out motion-reduce:transition-none',
                  side,
                  LINE_INK(entry.type),
                  entry.clock.held && 'scale-y-[2.5]',
                )}
              />
            ))}
          </div>
        )}
      </IslandSurface>
    </motion.div>
  );
}
