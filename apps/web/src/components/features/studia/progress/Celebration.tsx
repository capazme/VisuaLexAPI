import { useEffect, useRef, type RefObject } from 'react';
import { Z_INDEX } from '../../../../constants/zIndex';
import { cn } from '../../../../lib/utils';
import { FRAMES, fade, spawn, step, stepsAt } from './confetti';
import { GoalMark } from './GoalMark';
import { INK_TEXT, SUCCESS_TEXT, TILE } from './tokens';

/** How long the session's notice stays: decision 6, «gone in under 1.5 seconds». */
export const SESSION_NOTICE_MS = 1500;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The colours of the confetti, read from the theme through classes: ink, red, primary, green, amber. */
const PALETTE = [INK_TEXT, 'text-red-700 dark:text-red-400', 'text-primary-500', SUCCESS_TEXT, 'text-amber-500 dark:text-amber-400'];

export interface ConfettiBurstProps {
  /** The element the confetti start from (its centre); the canvas's left third when absent. */
  originRef?: RefObject<HTMLElement | null>;
  /** Called as the burst begins (also under reduced motion): the day is marked celebrated at once. */
  onStart?: () => void;
  /** Called once when the burst is over, at once under reduced motion or without a canvas. */
  onDone?: () => void;
}

/** The burst's animation, by elapsed time: the same 1.5 s on a 60 Hz and a 120 Hz screen. */

/**
 * Confetti of «§» and «✓» over the parent (absolutely placed, no pointer events), about 1.5 s, once
 * (Studia progress spec §6.1). Nothing is drawn under reduced motion.
 */
export function ConfettiBurst({ originRef, onStart, onDone }: ConfettiBurstProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<HTMLSpanElement>(null);
  const started = useRef(onStart);
  const done = useRef(onDone);
  useEffect(() => {
    started.current = onStart;
    done.current = onDone;
  }, [onStart, onDone]);

  useEffect(() => {
    started.current?.();
    const canvas = canvasRef.current;
    if (!canvas || prefersReducedMotion()) {
      done.current?.();
      return;
    }
    const box = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(box.width * ratio));
    canvas.height = Math.max(1, Math.round(box.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) {
      done.current?.();
      return;
    }
    context.scale(ratio, ratio);
    const palette = Array.from(paletteRef.current?.children ?? []).map((el) => getComputedStyle(el).color);
    const from = originRef?.current?.getBoundingClientRect();
    const origin = from ? { x: from.left - box.left + from.width / 2, y: from.top - box.top + from.height / 2 } : { x: box.width / 3, y: box.height / 2 };

    let particles = spawn(origin, palette);
    let frame = 0;
    let request = 0;
    let start: number | null = null;
    const draw = (now: number) => {
      start ??= now;
      for (const due = stepsAt(now - start); frame < due; frame += 1) particles = step(particles);
      context.clearRect(0, 0, box.width, box.height);
      context.globalAlpha = fade(frame);
      for (const p of particles) {
        context.save();
        context.translate(p.x, p.y);
        context.rotate(p.rotation);
        context.fillStyle = p.color;
        context.font = `bold ${Math.round(p.size * 2.4)}px Georgia, serif`;
        context.fillText(p.glyph, -p.size, p.size);
        context.restore();
      }
      if (frame < FRAMES) request = requestAnimationFrame(draw);
      else {
        context.clearRect(0, 0, box.width, box.height);
        done.current?.();
      }
    };
    request = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(request);
  }, [originRef]);

  return (
    <>
      <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
      <span ref={paletteRef} aria-hidden className="hidden">
        {PALETTE.map((colour) => (
          <span key={colour} className={colour} />
        ))}
      </span>
    </>
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
        {/* The confetti first, so the mark and the words are drawn over them. */}
        <ConfettiBurst />
        {mark && <GoalMark size={32} draw className={cn('relative', INK_TEXT)} />}
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
