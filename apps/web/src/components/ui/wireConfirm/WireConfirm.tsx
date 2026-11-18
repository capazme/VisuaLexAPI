import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { Button } from '../Button';
import { Z_INDEX } from '../../../constants/zIndex';
import { ISLAND_CLOSE, ISLAND_OPEN } from '../../../lib/motion';
import { cn } from '../../../lib/utils';
import { isTopmostDialog, openDialog } from '../dialogStack';
import { IslandSurface } from '../IslandSurface';
import { openerNow, useReducedMotionLive } from '../islandMotion';
import { OutcomeTick, type Box } from './OutcomeTick';

/**
 * A confirmation that grows out of its button (K1b, LC85): the card is born from the button pressed and goes back into
 * it (`IslandSurface`, the search island's way, L-76). «Annulla», Esc or a click outside send it back; confirming sends
 * it back too, and the button then says the outcome with a tick that draws itself («Eliminata ✓», `OutcomeTick`). Only
 * where an action leaves you or cannot be undone (the owners' L-35): the other confirmations are `ConfirmDialog`.
 *
 * The focus opens on «Annulla», Tab goes between the two buttons, and goes back to the button as it closes; once
 * closing nothing in it takes a key (`inert`): an Enter while it goes back must not confirm. Under reduced motion the
 * card fades in and out, and the outcome comes once it is gone.
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
  /**
   * Which button is the evident one: the confirmation (the default), or the cancel when going back is what one wants
   * most — «Continua il ripasso» over «Interrompi» (U1c): then the cancel is filled and on the right, the confirmation
   * outlined. The focus opens on the cancel and Esc is the cancel either way.
   */
  emphasis?: 'confirm' | 'cancel';
  /**
   * Where the focus goes after a cancel, when not back to `origin` (read as it closes): the lesson's card after
   * «Continua il ripasso», where Space shows the answer — on «Interrompi» it would press it again.
   */
  focusBack?: () => HTMLElement | null | undefined;
  /**
   * The button the wire starts from and the focus goes back to. Pass it (`event.currentTarget`): Safari and a tap do not
   * focus a button they press. Absent, the element focused as it opens — right for a menu's entry, whose menu gives
   * the focus back to its trigger by code before the entry runs.
   */
  origin?: HTMLElement | null;
  /**
   * The outcome has been said (its tick gone), or there was none to draw: a caller that removes the button (a row, a
   * card) does it now, not while the tick still sits over it.
   */
  onOutcomeDone?: () => void;
}

/** When the buttons are seen, in milliseconds: the card has grown (`ISLAND_OPEN`); a fade under reduced motion. */
const READY_MS = ISLAND_OPEN.duration;
const READY_STILL_MS = 120;

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
  onOutcomeDone,
  emphasis = 'confirm',
  focusBack,
}: WireConfirmProps) {
  const still = useReducedMotionLive();
  const id = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const token = useRef(Symbol('wire-confirm'));
  // The confirmation, not a cancel, closed it: the focus goes back to the button, never to `focusBack`.
  const [confirmed, setConfirmed] = useState(false);
  const [outcome, setOutcome] = useState<{ label: string; box: Box } | null>(null);
  const outcomeRef = useRef<{ label: string; box: Box } | null>(null);
  // The buttons have risen into sight: before, a confirmation would run unseen (a double tap on a button the card
  // then covers, on a phone).
  const [ready, setReady] = useState(false);
  // The outcome waits for the card to be gone, so the two never overlap.
  const pendingOutcome = useRef<{ label: string; box: Box } | null>(null);
  const exited = useRef(true);

  // The button, kept from the render that opens it: a menu's entry is gone by the time the card is measured.
  const [wasOpen, setWasOpen] = useState(false);
  const [from, setFrom] = useState<HTMLElement | null>(null);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFrom(origin ?? openerNow());
      setConfirmed(false);
      // Its buttons answer only once they are seen (`READY_MS`).
      setReady(false);
    }
  }
  const outcomeDone = useRef(onOutcomeDone);
  const focusBackRef = useRef(focusBack);
  useEffect(() => {
    outcomeDone.current = onOutcomeDone;
    focusBackRef.current = focusBack;
  });

  useEffect(() => (open ? openDialog(token.current) : undefined), [open]);

  useEffect(() => {
    if (!open) return;
    // An outcome still waiting for the last card to go (opened again before it went) is over: its caller is told.
    if (pendingOutcome.current) {
      pendingOutcome.current = null;
      outcomeDone.current?.();
    }
    exited.current = false;
    const timer = window.setTimeout(() => setReady(true), still ? READY_STILL_MS : READY_MS);
    cancelRef.current?.focus({ preventScroll: true });
    return () => window.clearTimeout(timer);
  }, [open, still]);

  // Closed: the focus goes back to the button at once, not after the rewind. A button its action disabled (busy) takes
  // it once enabled again, if nothing else took it meanwhile. Only after a real closing — mounted closed, nothing moves
  // the focus (with `focusBack`, the lesson's card would take it as the page opens) — and once per closing.
  const closing = useRef(false);
  useEffect(() => {
    if (open) {
      closing.current = true;
      return;
    }
    if (!closing.current) return;
    closing.current = false;
    // Cancelled, with a place of its own to go back to.
    const back = confirmed ? null : focusBackRef.current?.();
    if (back?.isConnected) {
      back.focus({ preventScroll: true });
      return;
    }
    if (!from?.isConnected) return;
    if (!(from as HTMLButtonElement).disabled) {
      from.focus({ preventScroll: true });
      return;
    }
    const observer = new MutationObserver(() => {
      if ((from as HTMLButtonElement).disabled) return;
      observer.disconnect();
      if (from.isConnected && (document.activeElement === document.body || document.activeElement === null)) from.focus({ preventScroll: true });
    });
    observer.observe(from, { attributes: true, attributeFilter: ['disabled'] });
    const timer = window.setTimeout(() => observer.disconnect(), 10000);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [open, from, confirmed]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !isTopmostDialog(token.current)) return;
      if (event.key === 'Tab') {
        // The two buttons, and nothing else: from the card's text or the page, Tab comes back to them.
        event.preventDefault();
        const next = document.activeElement === cancelRef.current ? confirmRef.current : cancelRef.current;
        next?.focus();
        return;
      }
      if (event.key !== 'Escape') return;
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
    if (!label) return;
    if (!box) {
      outcomeDone.current?.();
      return;
    }
    if (exited.current) show({ label, box });
    else {
      // One outcome waits at a time: one already waiting is over, and its caller told.
      if (pendingOutcome.current) outcomeDone.current?.();
      pendingOutcome.current = { label, box };
    }
  };

  /** The tick over the button; one already there gives way, and its caller is told it is over. */
  const show = (next: { label: string; box: Box }) => {
    if (outcomeRef.current) outcomeDone.current?.();
    outcomeRef.current = next;
    setOutcome(next);
  };

  const endOutcome = useCallback(() => {
    outcomeRef.current = null;
    setOutcome(null);
    outcomeDone.current?.();
  }, []);

  const onExitComplete = () => {
    exited.current = true;
    if (pendingOutcome.current) {
      show(pendingOutcome.current);
      pendingOutcome.current = null;
    }
  };

  return createPortal(
    <>
      <AnimatePresence onExitComplete={onExitComplete}>
        {open && (
          <WireLayer
            key="wire-confirm"
            id={id}
            title={title}
            message={message}
            cancelLabel={cancelLabel}
            confirmLabel={confirmLabel}
            variant={variant}
            emphasis={emphasis}
            from={from}
            ready={ready}
            cardRef={cardRef}
            cancelRef={cancelRef}
            confirmRef={confirmRef}
            onCancel={onCancel}
            onConfirm={() => {
              if (ready) void confirm();
            }}
          />
        )}
      </AnimatePresence>
      {outcome && <OutcomeTick key={`${outcome.label}-${outcome.box.left}-${outcome.box.top}`} label={outcome.label} box={outcome.box} still={still} onDone={endOutcome} />}
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
  emphasis: 'confirm' | 'cancel';
  from: HTMLElement | null;
  ready: boolean;
  cardRef: RefObject<HTMLDivElement | null>;
  cancelRef: RefObject<HTMLButtonElement | null>;
  confirmRef: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}

/** The backdrop and the card: one presence, so the backdrop goes with the card. */
function WireLayer({ id, title, message, cancelLabel, confirmLabel, variant, emphasis, from, ready, cardRef, cancelRef, confirmRef, onCancel, onConfirm }: WireLayerProps) {
  // Leaving, it takes no click: the backdrop's would cancel twice.
  const present = useIsPresent();

  const confirmButton = (
    <Button
      ref={confirmRef}
      variant={emphasis === 'cancel' ? 'secondary' : variant === 'danger' ? 'danger' : 'primary'}
      size="sm"
      // Outlined, a dangerous confirmation keeps its red in its words.
      className={cn('min-h-[44px] md:min-h-9', emphasis === 'cancel' && variant === 'danger' && 'text-red-700 dark:text-red-300')}
      onClick={onConfirm}
    >
      {confirmLabel}
    </Button>
  );

  return (
    // Leaving, the layer still takes the clicks (they do not fall to the page while the card goes back); the card takes none.
    <div className={cn('fixed inset-0', Z_INDEX.modal)}>
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-ink-950/30"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: ISLAND_OPEN.duration / 1000 } }}
        exit={{ opacity: 0, transition: { duration: ISLAND_CLOSE.duration / 1000 } }}
        onClick={present ? onCancel : undefined}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
        <IslandSurface
          ref={cardRef}
          source={from}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-message`}
          // A click on its text keeps the focus in it (the document's Tab trap brings it to the buttons).
          tabIndex={-1}
          // Its buttons answer (they have risen into sight).
          data-ready={ready || undefined}
          className="pointer-events-auto w-full max-w-sm"
          surfaceClassName="rounded-2xl border border-ink-200 bg-white shadow-lg dark:border-ink-700 dark:bg-ink-900"
          contentClassName="relative rounded-2xl p-5"
        >
          <h2 id={`${id}-title`} className="text-base font-semibold text-ink-900 dark:text-ink-50">
            {title}
          </h2>
          <p id={`${id}-message`} className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
            {message}
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {/* The evident button on the right: the confirmation, or the cancel when it is the one wanted most. */}
            {emphasis === 'cancel' && confirmButton}
            <Button ref={cancelRef} variant={emphasis === 'cancel' ? 'primary' : 'quiet'} size="sm" className="min-h-[44px] md:min-h-9" onClick={onCancel}>
              {cancelLabel}
            </Button>
            {emphasis === 'confirm' && confirmButton}
          </div>
        </IslandSurface>
      </div>
    </div>
  );
}
