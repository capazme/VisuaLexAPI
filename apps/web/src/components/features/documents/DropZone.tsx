import { forwardRef, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUp, ShieldCheck } from 'lucide-react';
import { FOCUS_RING } from '../../../constants/interactions';
import { ease, spring } from '../../../lib/motion';
import { cn } from '../../../lib/utils';

/**
 * Where a file is: nowhere near (`idle`), dragged over the window (`page`), or over the box itself (`over`).
 * Read from `dragover` only (`DocumentReviewPage`): `dragenter` and `dragleave` fire between children too.
 */
export type DropPhase = 'idle' | 'page' | 'over';

export interface DropZoneProps {
  phase: DropPhase;
  /** Over the box, where the pointer is from its centre, in px, already kept within a few: the sheets lean that way. */
  lean: { x: number; y: number };
  /** Counts the drops: each one sets the sheets down with a bounce and sends a wave from the frame. */
  landings: number;
  /** A phone: no dragging, «Tocca per scegliere un documento». */
  touch: boolean;
  busy: boolean;
  onChoose: () => void;
  /** The sheet that flies to the document's row (`SheetFlight`): where it starts. */
  sheetRef: Ref<HTMLDivElement>;
}

/** The three sheets' places: closed in a pile, fanned out, open wide. The middle one is the ink one, on top. */
const SHEETS = {
  idle: [
    { x: -5, y: 3, rotate: -4 },
    { x: 0, y: 0, rotate: 0 },
    { x: 5, y: 3, rotate: 4 },
  ],
  page: [
    { x: -24, y: 6, rotate: -13 },
    { x: 0, y: -4, rotate: 0 },
    { x: 24, y: 6, rotate: 13 },
  ],
  over: [
    { x: -38, y: 8, rotate: -22 },
    { x: 0, y: -10, rotate: 0 },
    { x: 38, y: 8, rotate: 22 },
  ],
} as const;

/** A sheet with its corner folded: a sheet of the page's paper, or the ink one with the arrow. */
const Sheet = forwardRef<HTMLDivElement, { ink?: boolean }>(function Sheet({ ink = false }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        'relative grid h-14 w-11 place-items-center rounded-[5px] border [clip-path:polygon(0_0,72%_0,100%_22%,100%_100%,0_100%)]',
        ink ? 'border-primary-700 bg-primary-600 text-white dark:border-primary-300 dark:bg-primary-400 dark:text-slate-950' : 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800',
      )}
    >
      <span aria-hidden className={cn('absolute right-0 top-0 h-[22%] w-[28%] rounded-bl-[3px]', ink ? 'bg-primary-800 dark:bg-primary-200' : 'bg-slate-200 dark:bg-slate-700')} />
      {ink && <ArrowUp aria-hidden size={18} strokeWidth={2.25} />}
    </div>
  );
});

/**
 * «Analizza documento»'s box (D6), inspired by Animorio's «zona dei file», written from scratch in SVG, CSS and Framer
 * Motion: a dashed frame whose dashes turn slowly at rest (`stroke-dashoffset`, `vlx-dash` in `index.css`), in ink and
 * faster while a file is dragged over the window, joined into one line over the box; three sheets in a pile that fan
 * out, then open wide and lean towards the pointer; let go, they settle with a little bounce while a wave runs in from
 * the frame. The words say what to do, and that the file stays in the browser, in every state. Under reduced motion the
 * dashes stand still and the sheets change place without moving.
 */
export const DropZone = forwardRef<HTMLButtonElement, DropZoneProps>(function DropZone({ phase, lean, landings, touch, busy, onChoose, sheetRef }, ref) {
  const still = useReducedMotion() ?? false;
  const frame = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // The frame is drawn on the box's own size, so the dashes are the same length at every width.
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const places = SHEETS[phase];
  const move = still ? { duration: 0 } : spring.gentle;
  const title = phase === 'over' ? 'Rilascia per leggerlo' : phase === 'page' ? 'Lascia qui il documento' : touch ? 'Tocca per scegliere un documento' : 'Scegli un documento';
  const line = phase === 'idle' && !touch ? 'o trascinalo qui · TXT, Markdown, HTML o DOCX, fino a 15 MB' : 'TXT, Markdown, HTML o DOCX, fino a 15 MB';

  return (
    <button
      ref={ref}
      type="button"
      onClick={onChoose}
      aria-busy={busy || undefined}
      data-phase={phase}
      className={cn(
        'relative flex min-h-48 w-full flex-col items-center justify-center overflow-hidden rounded-[10px] bg-white px-6 py-8 text-center dark:bg-slate-900',
        // Inset: the wrapper that closes upwards clips whatever is drawn outside the box.
        FOCUS_RING,
        'focus-visible:ring-inset focus-visible:ring-offset-0',
      )}
    >
      {/* The ground tinted while a file is near, by its opacity; a lighter one under a mouse at rest. */}
      <span aria-hidden className={cn('pointer-events-none absolute inset-0 bg-primary-50/70 transition-opacity duration-200 dark:bg-primary-950/40', phase === 'idle' ? 'opacity-0' : 'opacity-100')} />
      {/* The frame: dashes that turn, and the line they join into over the box. Drawn, never read. */}
      <span ref={frame} aria-hidden className="pointer-events-none absolute inset-0">
        {size.width > 0 && (
          <svg width={size.width} height={size.height} className="absolute inset-0 overflow-visible">
            {/* Three strokes, each shown by its opacity alone (only opacity, transforms and the dash offset move): the
                dashes at rest, the ink ones that run while a file is over the window, the line they join into. */}
            {(['rest', 'run'] as const).map((kind) => (
              <rect
                key={kind}
                data-frame={kind === 'rest' ? 'dashed' : 'running'}
                data-phase={phase}
                x={1}
                y={1}
                width={size.width - 2}
                height={size.height - 2}
                rx={9}
                fill="none"
                strokeWidth={2}
                strokeDasharray="8 6"
                className={cn(
                  'transition-opacity duration-200',
                  kind === 'rest' ? 'vlx-dash stroke-slate-300 dark:stroke-slate-700' : 'vlx-dash-run stroke-primary-600 dark:stroke-primary-400',
                  (kind === 'rest' ? phase === 'idle' : phase === 'page') ? 'opacity-100' : 'opacity-0',
                )}
              />
            ))}
            <rect
              data-frame="solid"
              x={1}
              y={1}
              width={size.width - 2}
              height={size.height - 2}
              rx={9}
              fill="none"
              strokeWidth={2}
              className={cn('stroke-primary-600 transition-opacity duration-200 dark:stroke-primary-400', phase === 'over' ? 'opacity-100' : 'opacity-0')}
            />
          </svg>
        )}
        {/* The wave, once per drop: from the frame inwards, fading. */}
        <AnimatePresence>
          {!still && landings > 0 && (
            <motion.span
              key={landings}
              className="absolute inset-0 rounded-[10px] border-2 border-primary-500/60"
              initial={{ opacity: 0.7, scale: 1 }}
              animate={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.6, ease: ease.out }}
            />
          )}
        </AnimatePresence>
      </span>

      {/* The sheets, a little smaller on a phone; they lean towards the pointer over the box. */}
      <motion.span
        aria-hidden
        className={cn('pointer-events-none relative mb-4 grid h-20 w-32 place-items-center', touch && 'scale-90')}
        animate={{ x: phase === 'over' ? lean.x : 0, y: phase === 'over' ? lean.y : 0 }}
        transition={still ? { duration: 0 } : spring.snappy}
      >
        {[0, 2, 1].map((index) => (
          <motion.span key={index} className="absolute" initial={false} animate={places[index]} transition={move} style={{ zIndex: index === 1 ? 2 : 1 }}>
            <Sheet ink={index === 1} ref={index === 1 ? sheetRef : undefined} />
          </motion.span>
        ))}
      </motion.span>

      {/* The children let the drag through, so moving over one is still being over the box. */}
      {/* Positioned, so they are drawn over the tinted ground (itself positioned). */}
      <span className="pointer-events-none relative font-serif text-xl text-slate-900 dark:text-slate-50">{title}</span>
      <span className="pointer-events-none relative mt-1.5 text-sm text-slate-600 dark:text-slate-400">{line}</span>
      {/* The page's promise, in every state: VisuaLex never sends the file anywhere. */}
      <span className="pointer-events-none relative mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
        <ShieldCheck aria-hidden size={14} />
        Il file resta nel tuo browser
      </span>
    </button>
  );
});
