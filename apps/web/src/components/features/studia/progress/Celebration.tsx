import { useEffect, useRef, type RefObject } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Z_INDEX } from '../../../../constants/zIndex';
import { cn } from '../../../../lib/utils';
import { FRAMES, fade, spawn, step } from './confetti';
import { formatDate } from './layout';
import { INK_TEXT, STAMP, SUCCESS_TEXT, TILE } from './tokens';

/** How long the session's notice stays: the confetti, then a moment to read it. */
export const SESSION_NOTICE_MS = 2500;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The colours of the confetti, read from the theme through classes: ink, stamp red, primary, green, amber. */
const PALETTE = [INK_TEXT, 'text-red-700 dark:text-red-400', 'text-primary-500', SUCCESS_TEXT, 'text-amber-500 dark:text-amber-400'];

export interface ConfettiBurstProps {
  /** The element the confetti start from (its centre); the canvas's left third when absent. */
  originRef?: RefObject<HTMLElement | null>;
  /** Called once when the burst is over, at once under reduced motion or without a canvas. */
  onDone?: () => void;
}

/**
 * Confetti of «§» and «✓» over the parent (absolutely placed, no pointer events), about 1.5 s, once
 * (Studia progress spec §6.1). Nothing is drawn under reduced motion.
 */
export function ConfettiBurst({ originRef, onDone }: ConfettiBurstProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<HTMLSpanElement>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
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
    const draw = () => {
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
      particles = step(particles);
      frame += 1;
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

export interface GoalStampProps {
  giorno: string;
  serie: number;
  /** Pressed in now (the celebration); otherwise drawn at rest. */
  press: boolean;
  className?: string;
}

/** The stamp «Obiettivo raggiunto · 13 ottobre 2026 · giorno 13», in the one red, slightly askew. */
export function GoalStamp({ giorno, serie, press, className }: GoalStampProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      aria-hidden
      data-testid="goal-stamp"
      initial={press && !reduce ? { scale: 2.4, opacity: 0, rotate: -8 } : false}
      animate={{ scale: 1, opacity: 1, rotate: -8 }}
      transition={{ type: 'spring', stiffness: 520, damping: 24, delay: 0.25 }}
      className={cn(
        'pointer-events-none rounded border-[3px] border-double px-2.5 py-1 text-center font-serif uppercase leading-tight tracking-[0.12em] mix-blend-multiply dark:mix-blend-normal',
        STAMP,
        className,
      )}
    >
      <span className="block text-xs font-bold md:text-sm">Obiettivo raggiunto</span>
      <span className="block text-[10px] tracking-wide">
        {formatDate(giorno)} · giorno {serie}
      </span>
    </motion.div>
  );
}

export interface SessionCelebrationProps {
  giorno: string;
  serie: number;
  /** Called when the notice has been on screen for `SESSION_NOTICE_MS`. */
  onDone: () => void;
}

/**
 * The goal closing during a review (Studia progress spec §6.4): a notice at the top of the screen, over the
 * page's heading and never over the card or the grades, with the stamp and the confetti inside it. It takes
 * no focus and no pointer, so the keys keep working; under reduced motion it is the notice alone.
 */
export function SessionCelebration({ giorno, serie, onDone }: SessionCelebrationProps) {
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  useEffect(() => {
    const timer = window.setTimeout(() => done.current(), SESSION_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className={cn('pointer-events-none fixed inset-x-0 top-3 flex justify-center px-4', Z_INDEX.toast)}>
      <div className={cn(TILE, 'relative flex w-full max-w-sm items-center justify-between gap-3 overflow-hidden px-4 py-3 shadow-lg')}>
        <p className={cn('font-serif text-base font-semibold', INK_TEXT)} aria-hidden>
          Serie di {serie} {serie === 1 ? 'giorno' : 'giorni'}
        </p>
        <GoalStamp giorno={giorno} serie={serie} press />
        <ConfettiBurst />
      </div>
    </div>
  );
}
