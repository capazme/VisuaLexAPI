import { Illustration } from '../../../ui/Illustration';
import { useEffect, useRef, type RefObject } from 'react';
import { Z_INDEX } from '../../../../constants/zIndex';
import { cn } from '../../../../lib/utils';
import { INK_TEXT, TILE } from './tokens';

/** How long the session's notice stays: decision 6, «gone in under 1.5 seconds». */
export const SESSION_NOTICE_MS = 1500;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface SmokeRiseProps {
  /** The day's plate, whose lamp the smoke leaves. */
  originRef?: RefObject<HTMLElement | null>;
  /** Called as the smoke begins (also under reduced motion): the day is marked celebrated at once. */
  onStart?: () => void;
  /** Called once when the smoke is gone, at once under reduced motion or with nothing measured. */
  onDone?: () => void;
}

/**
 * The day closed (LC39, Luca: «ci sono i coriandoli bruttissimi»): once, a thin curl of smoke rises from the lamp the
 * day's plate shows just put out, and fades, about 2.6 s, in the theme's ink. Same contract as the confetti it replaces:
 * `onStart` at once (the day is marked celebrated), `onDone` when it is over; under reduced motion nothing is drawn and
 * both are called at once. Placed over the parent (absolutely, no pointer events), from `originRef`'s plate: the wick
 * sits on the lamp's spout, at its right.
 */
export function SmokeRise({ originRef, onStart, onDone }: SmokeRiseProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const smokeRef = useRef<HTMLDivElement>(null);
  const started = useRef(onStart);
  const done = useRef(onDone);
  useEffect(() => {
    started.current = onStart;
    done.current = onDone;
  }, [onStart, onDone]);
  useEffect(() => {
    started.current?.();
    const smoke = smokeRef.current;
    const box = boxRef.current?.getBoundingClientRect();
    const from = originRef?.current?.getBoundingClientRect();
    // No layout (nothing measured): nothing to draw from, the day closes at once.
    if (prefersReducedMotion() || !smoke || !box || !from || !from.width) {
      done.current?.();
      return undefined;
    }
    // Its foot at the wick, on the lamp's spout: six sevenths across the plate, a third down.
    const width = Math.max(18, from.width * 0.16);
    smoke.style.left = `${from.left - box.left + from.width * 0.865 - width / 2}px`;
    smoke.style.top = `${from.top - box.top + from.height * 0.33 - width * (360 / 110)}px`;
    smoke.style.width = `${width}px`;
    smoke.classList.add('vlx-smoke-rise');
    const timer = window.setTimeout(() => done.current?.(), 2600);
    return () => window.clearTimeout(timer);
  }, [originRef]);
  return (
    <div ref={boxRef} aria-hidden data-testid="smoke-rise" className="pointer-events-none absolute inset-0 overflow-visible">
      <div ref={smokeRef} className="absolute opacity-0">
        <Illustration name="learn-fumo" className="aspect-[110/360] w-full" />
      </div>
    </div>
  );
}

export interface SessionCelebrationProps {
  serie: number;
  /** The goal's mission done by this grade: the mark beside the words (G9); otherwise the words alone. */
  mark: boolean;
  /** Called as the notice appears: the day is marked celebrated at once (decision 10). */
  onStart: () => void;
  /** Called when the notice has been on screen for `SESSION_NOTICE_MS`. */
  onDone: () => void;
}

/**
 * The goal closing during a review (Studia progress spec §6.4): a notice over the lesson's header row (the
 * close button and the progress bar, Gymnasium spec §5.4), never over the card or the grades, with the goal's mark and
 * the confetti inside it. It is placed in that row, not fixed over the screen; it takes no focus and no pointer
 * (the button under it stays usable), so the keys keep working. Gone in 1.5 s (decision 6). The mark is «Oggi»'s, small,
 * written beside the words (G9: it took the place of the red stamp), and on the same rule: only with the goal's mission
 * done by this grade (`mark`), the words alone otherwise; under reduced motion the same notice, still.
 */
export function SessionCelebration({ serie, mark, onStart, onDone }: SessionCelebrationProps) {
  const start = useRef(onStart);
  const done = useRef(onDone);
  useEffect(() => {
    start.current = onStart;
    done.current = onDone;
  }, [onStart, onDone]);
  useEffect(() => {
    start.current();
    const timer = window.setTimeout(() => done.current(), SESSION_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div data-testid="session-celebration" className={cn('pointer-events-none absolute inset-x-0 top-0 flex justify-center', Z_INDEX.dropdown)}>
      <div className={cn(TILE, 'relative flex w-full max-w-md items-center justify-center gap-3 overflow-hidden px-3 py-1.5 shadow-lg')}>
        {/* LC39: no confetti; the day's plate, small, comes in beside the words. */}
        {mark && <Illustration name="learn-giorno-chiuso" className="vlx-plate-in relative aspect-[480/284] w-12" />}
        {/* Its words beside it at every width now that the mark is small (the stamp left them no room under 400 px). */}
        <p className={cn('relative font-serif text-sm font-semibold leading-tight', INK_TEXT)} aria-hidden>
          {/* On a phone the streak alone: one line keeps the notice clear of the card. */}
          <span className="hidden sm:block">Obiettivo di oggi raggiunto</span>
          <span className="block sm:font-normal">
            Serie di {serie} {serie === 1 ? 'giorno' : 'giorni'}
          </span>
        </p>
      </div>
    </div>
  );
}
