import { motion, useReducedMotion } from 'framer-motion';
import { ease, spring } from '../../../../lib/motion';
import { INK_TEXT } from './tokens';

/** A mark's place across the drawing: apart while the bundle is open, drawn together once the stroke binds them. */
const apart = (i: number) => 4 + i * 6;
const together = (i: number) => 8 + i * 4.5;

/** The pen's stroke: it speeds up as it goes down. */
const PEN = { duration: 0.22, ease: ease.inOut } as const;

/**
 * The streak's bundle of five as tally marks (S2; inspired by Animorio's «Il contatore a tacche», written from
 * scratch): the days of the bundle being filled, one pen mark each; the fifth is the stroke across the four, in the
 * section's hue, which draws them together. `grew`: the streak grew since this browser last drew it — the newest
 * mark comes down from the top (or the stroke passes and the four close up). Otherwise, and under reduced motion,
 * it is drawn at rest. The count says the streak; this is its picture, hidden from a screen reader.
 */
export function StreakTally({ count, grew }: { count: number; grew: boolean }) {
  const reduce = useReducedMotion();
  if (count <= 0) return null;
  const marks = count % 5 === 0 ? 5 : count % 5;
  const bound = marks === 5;
  const moving = grew && !reduce;

  return (
    <svg data-testid="streak-tally" data-marks={marks} viewBox="0 0 30 22" className={`h-[22px] w-[30px] shrink-0 overflow-visible ${INK_TEXT}`} aria-hidden>
      {Array.from({ length: Math.min(marks, 4) }, (_, i) => {
        const newest = moving && !bound && i === marks - 1;
        return (
          <motion.g
            key={i}
            initial={moving && bound ? { x: apart(i) } : false}
            animate={{ x: bound ? together(i) : apart(i) }}
            // The four close up one after another as the stroke reaches them.
            transition={{ ...spring.snappy, delay: 0.12 + i * 0.03 }}
          >
            <motion.path
              d="M0 3 L0 19"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              fill="none"
              initial={newest ? { pathLength: 0 } : false}
              animate={{ pathLength: 1 }}
              transition={PEN}
            />
          </motion.g>
        );
      })}
      {bound && (
        <motion.path
          data-testid="streak-tally-stroke"
          d="M2 15 L28 7"
          style={{ stroke: 'var(--vlx-section-gymnasium)' }}
          strokeWidth={2.25}
          strokeLinecap="round"
          fill="none"
          initial={moving ? { pathLength: 0 } : false}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.24, ease: ease.out }}
        />
      )}
    </svg>
  );
}
