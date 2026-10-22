import { useEffect, useId, useRef, useState } from 'react';
import { animate, motion, useReducedMotion } from 'framer-motion';
import { ease } from '../../lib/motion';
import { cn } from '../../lib/utils';
import { cellAt, cellLines, changeTimes, DONE_AT, MELT_AT, SEGMENTS, TIMING, VIEW_H, VIEW_W, WORD } from './segments';

type Phase = 'lighting' | 'melting' | 'done';

interface SegmentWordmarkProps {
  /** The `h1`'s type: the size and weight the real wordmark has once the display melts into it. */
  className: string;
  /** The wordmark's weight class (`font-medium`), which the melting copy reaches: one place for both. */
  weightClass: string;
  /** The wordmark is there (the melt ended, or under reduced motion its fade began): the open book may come. */
  onSettled?: () => void;
}

const MELT_S = TIMING.meltFor / 1000;

/**
 * «VisuaLex» drawn first as a seven-segment display (A2), inspired by Animorio's «logo dai sette segmenti», written from
 * scratch with SVG, an SVG filter and Framer Motion: eight cells slanted by 7° light up in short steps, each through one
 * wrong drawing to its letter of «VISUALEX» (0.9 s); the name holds lit (0.4 s); then the segments round and fuse (a
 * blur cut by the alpha channel) and melt into the real wordmark in Newsreader, which takes its weight from 300 while
 * the slant goes back to nothing (0.8 s). Once per opening; a click on it plays it again. The `h1` is «VisuaLex» for a
 * screen reader throughout (the display and the melting copy are `aria-hidden`), and its box is the real wordmark's
 * from the first frame: the column never changes size. Under reduced motion the wordmark only fades in.
 */
/**
 * Safari (macOS and iOS, every iOS browser): the fusion filter is redrawn on the CPU at every frame while its blur
 * changes; there the melt is the cross-fade alone (the brief's fallback).
 */
const filterHolds = () =>
  typeof navigator === 'undefined' || !/^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);

export function SegmentWordmark({ className, weightClass, onSettled }: SegmentWordmarkProps) {
  const still = Boolean(useReducedMotion());
  const filterId = `vlx-goo-${useId().replace(/:/g, '')}`;
  const blurRef = useRef<SVGFEGaussianBlurElement>(null);
  const [run, setRun] = useState(0);
  const [phase, setPhase] = useState<Phase>(still ? 'done' : 'lighting');
  const [t, setT] = useState(0);
  const [fuse] = useState(filterHolds);
  const settled = useRef(onSettled);
  useEffect(() => {
    settled.current = onSettled;
  });

  // The display's steps, the hold, the melt and the end, scheduled from the opening (or the click that replays it).
  useEffect(() => {
    if (still) {
      settled.current?.();
      return;
    }
    const timers = [
      ...changeTimes().map((at) => window.setTimeout(() => setT(at), at)),
      window.setTimeout(() => setPhase('melting'), MELT_AT),
      window.setTimeout(() => {
        setPhase('done');
        settled.current?.();
      }, DONE_AT),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [run, still]);

  // The fusion: the blur grows while the segments round and join, and is back to nothing before the filter goes, so
  // the strokes' thickness does not jump. An attribute, not a style: set frame by frame.
  useEffect(() => {
    if (phase !== 'melting') return;
    const blur = blurRef.current;
    if (!blur) return;
    const controls = animate(0, 1, {
      duration: MELT_S,
      ease: 'linear',
      onUpdate: (p) => {
        // From 0.3 (at 0 the alpha cut would snap the thin strokes' soft edges in one frame) up to 1.6 at the middle of
        // the melt, back to 0 by its end.
        const deviation = p < 0.5 ? 0.3 + (p / 0.5) * 1.3 : ((1 - p) / 0.5) * 1.6;
        blur.setAttribute('stdDeviation', deviation.toFixed(3));
      },
    });
    return () => controls.stop();
  }, [phase]);

  const replay = () => {
    if (still || phase !== 'done') return;
    setT(0);
    setPhase('lighting');
    setRun((n) => n + 1);
  };

  const melting = phase === 'melting';
  const drawing = !still && phase !== 'done';

  return (
    // A click plays it again (a pointer's nicety: the display says nothing a keyboard user misses); no selection on
    // the double click that may come with it.
    <h1 className={cn(className, weightClass, 'relative select-none')} onClick={replay}>
      {/* The real wordmark: its box from the first frame, shown once the display has melted into it. */}
      <motion.span
        className="inline-block"
        initial={still ? { opacity: 0 } : false}
        animate={{ opacity: drawing ? 0 : 1 }}
        transition={{ duration: still ? 0.4 : 0 }}
      >
        VisuaLex
      </motion.span>
      {drawing && (
        <>
          {/* The wordmark taking its weight while the display fades into it: a light copy (300) comes, then the
              wordmark's own weight over it, by opacity alone (a weight animated would lay the text out every frame). */}
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-0 font-light"
            initial={{ opacity: 0 }}
            animate={{ opacity: melting ? [0, 1, 0] : 0 }}
            transition={{ duration: MELT_S * 0.75, delay: melting ? MELT_S * 0.25 : 0, times: [0, 0.5, 1], ease: 'linear' }}
          >
            VisuaLex
          </motion.span>
          <motion.span
            aria-hidden
            className={cn('pointer-events-none absolute inset-0', weightClass)}
            initial={{ opacity: 0 }}
            animate={{ opacity: melting ? 1 : 0 }}
            transition={{ duration: MELT_S * 0.4, delay: melting ? MELT_S * 0.6 : 0, ease: ease.out }}
          >
            VisuaLex
          </motion.span>
          <motion.svg
            aria-hidden
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="xMidYMid meet"
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            animate={{ opacity: melting ? 0 : 1 }}
            transition={{ duration: MELT_S * 0.6, delay: melting ? MELT_S * 0.35 : 0, ease: ease.inOut }}
          >
            <defs>
              <filter id={filterId} x="-10%" y="-20%" width="120%" height="140%">
                <feGaussianBlur ref={blurRef} in="SourceGraphic" stdDeviation="0.3" result="blur" />
                {/* A sharp cut of the alpha: what the blur joined stays joined, with a crisp edge. */}
                <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" />
              </filter>
            </defs>
            <motion.g
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              initial={{ skewX: -7 }}
              animate={{ skewX: melting ? 0 : -7 }}
              transition={{ duration: MELT_S * 0.7, ease: ease.inOut }}
              filter={melting && fuse ? `url(#${filterId})` : undefined}
              // Square ends on the display; they round as it melts.
              strokeLinecap={melting ? 'round' : 'butt'}
            >
              {[...WORD].map((_, i) => {
                const lines = cellLines(i);
                const lit = new Set(cellAt(i, t));
                return SEGMENTS.map((s) => {
                  const on = lit.has(s);
                  const { x1, y1, x2, y2 } = lines[s];
                  return (
                    <line
                      key={`${i}${s}`}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="currentColor"
                      strokeWidth={on ? 2.6 : 0.8}
                      className={on ? 'text-primary-600 dark:text-primary-400' : 'text-slate-200 dark:text-slate-800'}
                    />
                  );
                });
              })}
            </motion.g>
          </motion.svg>
        </>
      )}
    </h1>
  );
}
