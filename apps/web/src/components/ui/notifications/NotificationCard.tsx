import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { motion, stagger, useAnimate, type AnimationPlaybackControls, type PanInfo } from 'framer-motion';
import { AlertCircle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { ease } from '../../../lib/motion';
import type { HoldReason } from './countdown';
import type { NotificationEntry, NotificationType } from './notifications';

/**
 * The notification drawn from a line (K1a), inspired by Animorio's «notifica dalla riga», written from scratch with
 * Framer Motion: a thin line grows from the centre to the sides with a tick at each end, opens in height like a slit
 * on the notification, and the words rise from it one after the other. «Annulla»'s time is the line at the bottom,
 * which draws back; held (a pointer, the focus, a finger on it) it stops and its ticks grow. Run out, the notification
 * closes into the line, which draws back to the centre; closed by hand it folds and slides away. Under reduced motion
 * it fades in already open and fades out, and the time line still draws back.
 */

/** The motion's times, in seconds (K1a). */
const NOTIFICATION_S = {
  /** The line grows from the centre to the sides. */
  line: 0.3,
  /** The slit opens on the notification. */
  open: 0.35,
  /** Between one word and the next rising from the line. */
  stagger: 0.06,
  /** One word's rise. */
  word: 0.24,
  /** Run out: the slit closes onto the line, then the line draws back to the centre. */
  shut: 0.22,
  retract: 0.2,
  /** Closed by hand: it folds and slides away. */
  away: 0.26,
  /** Under reduced motion: a fade. */
  fade: 0.15,
} as const;

/** The slit, shut and open: the same four lengths and radius at both ends, so the clip interpolates. */
const SLIT_SHUT = 'inset(50% 0% 50% 0% round 12px)';
const SLIT_OPEN = 'inset(0% 0% 0% 0% round 12px)';

const ICONS: Record<NotificationType, typeof Info> = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertCircle };
const ICON_INK: Record<NotificationType, string> = {
  success: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-red-600 dark:text-red-400',
  info: 'text-primary-600 dark:text-primary-400',
  warning: 'text-amber-600 dark:text-amber-400',
};
/** The line is the app's ink, red for an error. */
const LINE_INK = (type: NotificationType) => (type === 'error' ? 'bg-red-600 dark:bg-red-400' : 'bg-primary-600 dark:bg-primary-400');

/** Whether a finger is the pointer: a swipe to the side closes the notification there. */
const coarsePointer = () => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/** How far, or how fast, a swipe has to go to close it; a shorter one goes back to its place. */
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
  const timeLine = useRef<AnimationPlaybackControls | null>(null);
  const entrance = useRef<AnimationPlaybackControls | null>(null);
  const exited = useRef(false);
  const Icon = ICONS[entry.type];
  const closing = entry.closing !== null;

  // The entrance, once.
  useLayoutEffect(() => {
    const root = scope.current;
    if (!root) return;
    if (still) {
      entrance.current = animate(root, { opacity: [0, 1] }, { duration: NOTIFICATION_S.fade });
      return;
    }
    const half = root.offsetWidth / 2;
    const out = { ease: ease.out };
    entrance.current = animate([
      ['[data-line]', { scaleX: [0, 1] }, { duration: NOTIFICATION_S.line, ...out }],
      ['[data-tick="start"]', { x: [half, 0] }, { duration: NOTIFICATION_S.line, at: 0, ...out }],
      ['[data-tick="end"]', { x: [-half, 0] }, { duration: NOTIFICATION_S.line, at: 0, ...out }],
      ['[data-body]', { clipPath: [SLIT_SHUT, SLIT_OPEN] }, { duration: NOTIFICATION_S.open, ...out }],
      // The line rides the slit's lower edge, onto the border: a translate by half the card's height, on the clip's
      // own timeline (a `top` ran on the main thread, ahead of the clip).
      ['[data-rule]', { y: ['0%', '50%'] }, { duration: NOTIFICATION_S.open, at: '<', ...out }],
      ['[data-word]', { opacity: [0, 1], y: [6, 0] }, { duration: NOTIFICATION_S.word, delay: stagger(NOTIFICATION_S.stagger), at: `-${NOTIFICATION_S.open - 0.1}`, ...out }],
      // The message gains a touch of weight as it rises (Geist's own axis), ending at its class's 500.
      ['[data-message]', { fontWeight: [400, 500] }, { duration: NOTIFICATION_S.word, at: '<', ...out }],
      // Open, the line gives way to the time line (or to the border), and the clip is let go: a focus ring must not
      // be cut.
      ['[data-rule]', { opacity: 0 }, { duration: 0.12, at: NOTIFICATION_S.line + NOTIFICATION_S.open }],
      ['[data-body]', { clipPath: 'none' }, { duration: 0, at: NOTIFICATION_S.line + NOTIFICATION_S.open }],
    ]);
    // Once, when it is drawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // The exit, by why it goes. Stopped before its end (StrictMode's second mount, in development), it runs again: a
  // stopped animation never settles, and the entry would stay drawn for ever.
  useEffect(() => {
    if (!closing || exited.current) return;
    exited.current = true;
    const root = scope.current;
    const done = () => onExited();
    if (!root) return done();
    // An entrance still on its way would take its values back from the exit, which would then never settle.
    entrance.current?.stop();
    timeLine.current?.stop();
    if (still) {
      animate(root, { opacity: 0 }, { duration: NOTIFICATION_S.fade }).then(done, done);
      return;
    }
    if (entry.closing === 'dismiss') {
      animate([
        ['[data-body]', { transformPerspective: 600, rotateX: 50, x: `${swipedTo.current * 110}%`, opacity: 0 }, { duration: NOTIFICATION_S.away, ease: ease.inOut }],
      ]).then(done, done);
      return;
    }
    const half = root.offsetWidth / 2;
    animate([
      ['[data-rule]', { y: '0%', opacity: 1 }, { duration: 0 }],
      ['[data-word]', { opacity: 0 }, { duration: NOTIFICATION_S.shut / 2 }],
      ['[data-body]', { clipPath: [SLIT_OPEN, SLIT_SHUT] }, { duration: NOTIFICATION_S.shut, at: 0, ease: ease.out }],
      ['[data-line]', { scaleX: 0 }, { duration: NOTIFICATION_S.retract, ease: ease.out }],
      ['[data-tick="start"]', { x: half }, { duration: NOTIFICATION_S.retract, at: '<', ease: ease.out }],
      ['[data-tick="end"]', { x: -half }, { duration: NOTIFICATION_S.retract, at: '<', ease: ease.out }],
    ]).then(done, done);
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

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (Math.abs(info.offset.x) < SWIPE_PX && Math.abs(info.velocity.x) < SWIPE_SPEED) return;
    swipedTo.current = info.offset.x < 0 ? -1 : 1;
    handOff(onDismiss, false);
  };

  const word = 'opacity-0 motion-reduce:opacity-100';
  return (
    <motion.div
      ref={scope}
      data-card
      drag={!closing && !standalone && coarsePointer() ? 'x' : false}
      // Swiped away, it leaves from where the finger let it go.
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
      className={cn('relative w-full touch-pan-y', closing && 'pointer-events-none')}
    >
      {/* The line the notification is drawn from, with its two ticks; it sits on the slit's lower edge as it opens. The
          box is as tall as the card, its line at the middle: moved down by half its height, the line lands on the
          lower border. */}
      <div data-rule aria-hidden className="pointer-events-none absolute inset-0 z-10">
        <div className="absolute inset-x-0 top-[calc(50%-1px)] h-px">
          <div data-line className={cn('h-px w-full origin-center', still && 'hidden', LINE_INK(entry.type))} style={{ transform: still ? undefined : 'scaleX(0)' }} />
          <div data-tick="start" className={cn('absolute left-0 top-1/2 h-2 w-px -translate-y-1/2', still && 'hidden', LINE_INK(entry.type))} />
          <div data-tick="end" className={cn('absolute right-0 top-1/2 h-2 w-px -translate-y-1/2', still && 'hidden', LINE_INK(entry.type))} />
        </div>
      </div>

      <div
        data-body
        // The page's paper, a thin border, ink: the typography does the work (K1a).
        className="relative rounded-xl border border-slate-200 bg-background text-slate-800 shadow-lg dark:border-slate-700 dark:text-slate-100"
        style={{ clipPath: still ? undefined : SLIT_SHUT }}
      >
        <div className="flex items-center gap-2 py-1.5 pl-4 pr-1.5">
          <span data-word aria-hidden className={cn('shrink-0', word, ICON_INK[entry.type])}>
            <Icon size={18} />
          </span>
          <p data-word data-message className={cn('min-w-0 flex-1 py-2 text-sm font-medium leading-snug', word)}>
            {entry.message}
          </p>
          {entry.undoable && (
            <button
              type="button"
              data-word
              onClick={(event) => handOff(onUndo, byKeys(event))}
              disabled={closing}
              aria-keyshortcuts={shortcut?.keys}
              className={cn(
                'min-h-[44px] shrink-0 rounded-lg px-3 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-900/30',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                word,
              )}
            >
              Annulla
              {/* Seen, not part of the name («Annulla»): `aria-keyshortcuts` says the key. */}
              {shortcut && <span aria-hidden className="ml-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">· {shortcut.label}</span>}
            </button>
          )}
          {entry.action && (
            <button
              type="button"
              data-word
              onClick={entry.action.onClick}
              disabled={closing}
              className={cn(
                'min-h-[44px] shrink-0 rounded-lg px-3 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-900/30',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                word,
              )}
            >
              {entry.action.label}
            </button>
          )}
          <button
            type="button"
            data-word
            onClick={(event) => handOff(onDismiss, byKeys(event))}
            disabled={closing}
            aria-label="Chiudi notifica"
            className={cn(
              'grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              word,
            )}
          >
            <X size={16} />
          </button>
        </div>

        {/* «Annulla»'s time: the line draws back between two ticks, which grow while the time is held. */}
        {entry.undoable && (
          <div aria-hidden className="pointer-events-none absolute inset-x-3 bottom-0 h-px">
            <div data-time className={cn('h-px w-full origin-left', LINE_INK(entry.type))} />
            {(['left-0', 'right-0'] as const).map((side) => (
              <div
                key={side}
                className={cn(
                  'absolute bottom-0 h-1.5 w-px origin-bottom transition-transform duration-200 ease-out motion-reduce:transition-none',
                  side,
                  LINE_INK(entry.type),
                  entry.clock.held && 'scale-y-[2.5]',
                )}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
