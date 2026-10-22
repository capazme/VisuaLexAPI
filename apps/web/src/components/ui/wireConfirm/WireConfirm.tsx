import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion';
import { Button } from '../Button';
import { Z_INDEX } from '../../../constants/zIndex';
import { ease } from '../../../lib/motion';
import { cn } from '../../../lib/utils';
import { isTopmostDialog, openDialog } from '../dialogStack';
import { OutcomeTick } from './OutcomeTick';
import { wirePaths, type Box, type WirePaths } from './wirePath';

/**
 * A confirmation drawn from its button (K1b), inspired by Animorio's «finestra disegnata a filo», written from scratch
 * with Framer Motion and SVG: a wire leaves the button pressed, reaches the card and draws its outline both ways;
 * where the two ends meet the card appears, its title, sentence and buttons rising one after the other (about 500 ms).
 * «Annulla», Esc or a click outside wind the wire back into the button (about 300 ms); confirming folds the card into
 * a line and the button says the outcome with a tick that draws itself («Eliminata ✓», `OutcomeTick`). Only where an
 * action leaves you or cannot be undone (the owners' L-35): the other confirmations are `ConfirmDialog`.
 *
 * The focus opens on «Annulla», Tab goes between the two buttons, and goes back to the button as it closes; once
 * closing nothing in it takes a key (`inert`): in the reference an Enter during the rewind confirmed by mistake. Under
 * reduced motion the card fades in already drawn, and the outcome comes once it is gone.
 */

export interface WireConfirmProps {
  open: boolean;
  variant?: 'default' | 'danger';
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Runs the action. A string it resolves to is the outcome the button says with its tick («Eliminata»); nothing, or
   * a failure, draws no tick (the caller says what went wrong).
   */
  onConfirm: () => void | Promise<string | null | void>;
  onCancel: () => void;
  /** The button the wire starts from and the focus goes back to; the element focused as it opens, by default. */
  origin?: HTMLElement | null;
}

/** The card's corner radius (`rounded-2xl`): the outline the wire draws follows it. */
const RADIUS = 16;

/** The wire's timing, in seconds: the lead, the outline, then the card and its three rows. */
const LEAD_S = 0.12;
const OUTLINE_S = 0.2;
const CARD_AT = LEAD_S + OUTLINE_S - 0.02;
const ROW_S = 0.12;
const ROW_GAP = 0.04;
/** Winding back: the card goes first, the outline, then the lead into the button. */
const BACK_CARD_S = 0.08;
const BACK_OUTLINE_S = 0.18;
const BACK_LEAD_S = 0.12;
/** The lead fading once the card is open. */
const LEAD_FADE_S = 0.2;

const boxOf = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });

export function WireConfirm({
  open,
  variant = 'default',
  title,
  message,
  confirmLabel = 'Conferma',
  cancelLabel = 'Annulla',
  onConfirm,
  onCancel,
  origin,
}: WireConfirmProps) {
  const still = Boolean(useReducedMotion());
  const id = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const token = useRef(Symbol('wire-confirm'));
  // The confirmation, not a cancel, closed it: the card folds instead of winding back.
  const [confirmed, setConfirmed] = useState(false);
  const [paths, setPaths] = useState<WirePaths | null>(null);
  const [outcome, setOutcome] = useState<{ label: string; box: Box } | null>(null);
  // The outcome waits for the card to be gone, so the two never overlap.
  const pendingOutcome = useRef<{ label: string; box: Box } | null>(null);
  const exited = useRef(true);

  // The button, kept from the render that opens it: a menu's entry is gone by the time the card is measured.
  const [wasOpen, setWasOpen] = useState(false);
  const [from, setFrom] = useState<HTMLElement | null>(null);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFrom(origin ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null));
      setConfirmed(false);
      setPaths(null);
    }
  }

  useEffect(() => (open ? openDialog(token.current) : undefined), [open]);

  // Measured once the card is laid out (it is drawn transparent first): the wire runs from the button to it.
  useLayoutEffect(() => {
    if (!open || still || !cardRef.current || !from?.isConnected) return;
    // The geometry is read from the layout just committed.
    setPaths(wirePaths(boxOf(from.getBoundingClientRect()), boxOf(cardRef.current.getBoundingClientRect()), RADIUS));
  }, [open, still, from]);

  useEffect(() => {
    if (!open) return;
    exited.current = false;
    cancelRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Closed: the focus goes back to the button at once, not after the rewind.
  useEffect(() => {
    if (open || !from) return;
    if (from.isConnected) from.focus({ preventScroll: true });
  }, [open, from]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTopmostDialog(token.current)) return;
      event.preventDefault();
      onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const confirm = async () => {
    setConfirmed(true);
    const box = from?.isConnected ? boxOf(from.getBoundingClientRect()) : null;
    let label: string | null | void = null;
    try {
      label = await onConfirm();
    } catch {
      // The caller says what went wrong; no tick.
      return;
    }
    if (!label || !box) return;
    if (exited.current) setOutcome({ label, box });
    else pendingOutcome.current = { label, box };
  };

  const onExitComplete = () => {
    exited.current = true;
    if (pendingOutcome.current) {
      setOutcome(pendingOutcome.current);
      pendingOutcome.current = null;
    }
  };

  return createPortal(
    <>
      {/* `custom`: the exit is chosen when the card leaves (folded after a confirmation, wound back after a cancel). */}
      <AnimatePresence custom={confirmed && !still} onExitComplete={onExitComplete}>
        {open && (
          <WireLayer
            key="wire-confirm"
            id={id}
            title={title}
            message={message}
            cancelLabel={cancelLabel}
            confirmLabel={confirmLabel}
            variant={variant}
            still={still}
            paths={paths}
            cardRef={cardRef}
            cancelRef={cancelRef}
            confirmRef={confirmRef}
            onCancel={onCancel}
            onConfirm={() => void confirm()}
          />
        )}
      </AnimatePresence>
      {outcome && <OutcomeTick label={outcome.label} box={outcome.box} still={still} onDone={() => setOutcome(null)} />}
    </>,
    document.body,
  );
}

interface WireLayerProps {
  id: string;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  variant: 'default' | 'danger';
  still: boolean;
  paths: WirePaths | null;
  cardRef: RefObject<HTMLDivElement | null>;
  cancelRef: RefObject<HTMLButtonElement | null>;
  confirmRef: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}

/** The backdrop, the wire and the card: one presence, so the wire winds back while the card goes. */
function WireLayer({ id, title, message, cancelLabel, confirmLabel, variant, still, paths, cardRef, cancelRef, confirmRef, onCancel, onConfirm }: WireLayerProps) {
  // Leaving, it takes no key and no click: an Enter during the rewind must not confirm.
  const present = useIsPresent();
  const ink = variant === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-primary-600 dark:text-primary-400';
  const drawn = (delay: number, duration: number) => ({ duration, delay, ease: ease.out });
  const row = (i: number) => ({
    hidden: { opacity: 0, y: still ? 0 : 4 },
    shown: { opacity: 1, y: 0, transition: { duration: ROW_S, delay: still ? 0 : CARD_AT + i * ROW_GAP, ease: ease.out } },
  });
  // Tab goes between the two buttons, and stays in the card.
  const trapTab = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    (document.activeElement === cancelRef.current ? confirmRef.current : cancelRef.current)?.focus();
  };
  // The lead fades once the card is there (a wire across the page would stay), and is back to wind into the button.
  const lead = {
    hidden: { pathLength: 0, opacity: 1 },
    shown: { pathLength: 1, opacity: 0, transition: { pathLength: drawn(0, LEAD_S), opacity: drawn(CARD_AT + ROW_S, LEAD_FADE_S) } },
    gone: (folded: boolean) => ({
      pathLength: 0,
      opacity: 1,
      transition: { pathLength: drawn(folded ? 0.06 : BACK_OUTLINE_S - 0.02, BACK_LEAD_S), opacity: { duration: 0 } },
    }),
  };
  const outline = {
    hidden: { pathLength: 0 },
    shown: { pathLength: 0.5, transition: drawn(LEAD_S, OUTLINE_S) },
    gone: (folded: boolean) => ({ pathLength: 0, transition: drawn(folded ? 0 : BACK_CARD_S, folded ? BACK_CARD_S : BACK_OUTLINE_S) }),
  };
  const card = {
    hidden: { opacity: 0 },
    shown: { opacity: 1, scaleY: 1, transition: { duration: ROW_S, delay: still ? 0 : CARD_AT } },
    // Confirmed, it folds into a line; cancelled, it goes first and the wire winds back.
    gone: (folded: boolean) =>
      folded
        ? { scaleY: 0.02, opacity: 0, transition: { duration: BACK_OUTLINE_S, ease: ease.inOut } }
        : { opacity: 0, transition: { duration: still ? 0.12 : BACK_CARD_S } },
  };

  return (
    <div className={cn('fixed inset-0', Z_INDEX.modal)} inert={!present || undefined}>
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-ink-950/30"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: still ? 0.12 : CARD_AT } }}
        exit={{ opacity: 0, transition: { duration: still ? 0.12 : BACK_OUTLINE_S } }}
        onClick={present ? onCancel : undefined}
      />
      {paths && !still && (
        <svg aria-hidden className={cn('pointer-events-none absolute inset-0 h-full w-full', ink)} fill="none">
          <motion.path d={paths.lead} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" variants={lead} initial="hidden" animate="shown" exit="gone" />
          <motion.path d={paths.clockwise} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" variants={outline} initial="hidden" animate="shown" exit="gone" />
          <motion.path d={paths.counter} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" variants={outline} initial="hidden" animate="shown" exit="gone" />
        </svg>
      )}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
        <motion.div
          ref={cardRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-message`}
          onKeyDown={trapTab}
          className="pointer-events-auto w-full max-w-sm rounded-2xl border border-ink-200 bg-white p-5 shadow-xl dark:border-ink-700 dark:bg-ink-900"
          variants={card}
          initial="hidden"
          animate="shown"
          exit="gone"
        >
          <motion.h2 id={`${id}-title`} variants={row(0)} className="text-base font-semibold text-ink-900 dark:text-ink-50">
            {title}
          </motion.h2>
          <motion.p id={`${id}-message`} variants={row(1)} className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
            {message}
          </motion.p>
          <motion.div variants={row(2)} className="mt-5 flex justify-end gap-2">
            <Button ref={cancelRef} variant="quiet" size="sm" className="min-h-[44px] md:min-h-9" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button ref={confirmRef} variant={variant === 'danger' ? 'danger' : 'primary'} size="sm" className="min-h-[44px] md:min-h-9" onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
