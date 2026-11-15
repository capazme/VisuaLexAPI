import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FOCUS_RING } from '../../../constants/interactions';
import { ease } from '../../../lib/motion';
import { buttonClassName } from '../../ui/buttonStyles';
import { cn } from '../../../lib/utils';

/**
 * Where a file is: nowhere near (`idle`), dragged over the window (`page`), or over the box itself (`over`).
 * Read from `dragover` only (`DocumentReviewPage`): `dragenter` and `dragleave` fire between children too.
 */
export type DropPhase = 'idle' | 'page' | 'over';

export interface DropZoneProps {
  phase: DropPhase;
  /** Counts the drops: each one sends a wave in from the frame. */
  landings: number;
  /** A phone: no dragging, no word of it. */
  touch: boolean;
  busy: boolean;
  onChoose: () => void;
}

/**
 * «Analizza documento»'s box (D6; quiet since LC29, Luca: no drawing in it): a dashed frame whose dashes stand still at
 * rest and turn slowly under a mouse or the keyboard's focus (`stroke-dashoffset`, `vlx-dash` in `index.css`; a hidden
 * tab stops them), in ink and faster while a file is dragged over the window, joined into one line over the box; let
 * go, a wave runs in from the frame. Inside, words only: what to do, the formats, and «Scegli un file» drawn as a button
 * (the whole box is the one button). Where the document goes is said once, by the page's line. Under reduced motion
 * nothing moves.
 */
export const DropZone = forwardRef<HTMLButtonElement, DropZoneProps>(function DropZone({ phase, landings, touch, busy, onChoose }, ref) {
  const still = useReducedMotion() ?? false;
  const frame = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // A hidden tab stops the dashes (`index.css`): nothing turns where nobody looks.
  const [tabHidden, setTabHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const onVisibility = () => setTabHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

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

  const title = phase === 'over' ? 'Rilascia per leggerlo' : phase === 'page' ? 'Lascia qui il documento' : touch ? 'Scegli un documento' : 'Trascina qui il documento';

  return (
    <button
      ref={ref}
      type="button"
      onClick={onChoose}
      aria-busy={busy || undefined}
      data-phase={phase}
      data-tab-hidden={tabHidden || undefined}
      className={cn(
        'group relative flex min-h-48 w-full flex-col items-center justify-center overflow-hidden rounded-[10px] bg-white px-6 py-8 text-center dark:bg-slate-900',
        // Inset: the wrapper that closes upwards clips whatever is drawn outside the box.
        FOCUS_RING,
        'focus-visible:ring-inset focus-visible:ring-offset-0',
      )}
    >
      {/* The ground tinted while a file is near, by its opacity; half of it under a mouse at rest. */}
      <span aria-hidden className={cn('pointer-events-none absolute inset-0 bg-primary-50/70 transition-opacity duration-200 dark:bg-primary-950/40', phase === 'idle' ? 'opacity-0 group-hover:opacity-50' : 'opacity-100')} />
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
                  kind === 'rest' ? 'stroke-slate-300 dark:stroke-slate-700' : 'stroke-primary-600 dark:stroke-primary-400',
                  // Each turns only while it is shown.
                  (kind === 'rest' ? phase === 'idle' : phase === 'page') ? cn('opacity-100', kind === 'rest' ? 'vlx-dash' : 'vlx-dash-run') : 'opacity-0',
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
        {/* Not on the box's first draw: back after «Scegli un altro documento», nothing was let go. */}
        <AnimatePresence initial={false}>
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

      {/* The children let the drag through, so moving over one is still being over the box. */}
      {/* Positioned, so they are drawn over the tinted ground (itself positioned). */}
      <span className="pointer-events-none relative font-serif text-lg text-slate-900 dark:text-slate-50">{title}</span>
      <span className="pointer-events-none relative mt-1 text-sm text-slate-600 dark:text-slate-400">TXT, Markdown, HTML o DOCX, fino a 15 MB</span>
      {/* Drawn as a button, not one: the box itself is the button, and a button holds no other. On a phone the title
          already says to choose. */}
      {!touch && (
        <span aria-hidden={phase !== 'idle' || undefined} className={cn(buttonClassName('secondary', 'sm'), 'pointer-events-none relative mt-4 transition-opacity motion-reduce:transition-none', phase !== 'idle' && 'opacity-0')}>
          Scegli un file
        </span>
      )}
    </button>
  );
});
