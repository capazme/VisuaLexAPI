import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Z_INDEX } from '../../../constants/zIndex';
import { ease } from '../../../lib/motion';
import { cn } from '../../../lib/utils';
import type { Box } from './wirePath';

/** How long the button says the outcome, in milliseconds; a caller that removes the button waits this long. */
export const OUTCOME_MS = 1600;

interface OutcomeTickProps {
  label: string;
  /** Where the button was when the action was confirmed. */
  box: Box;
  still: boolean;
  onDone: () => void;
}

/**
 * The outcome said on the button a confirmation was drawn from (K1b): over it, on the paper, a tick that draws itself
 * and the word («Eliminata ✓»), for 1.6 s, then it fades. Read once by a screen reader. Takes no pointer and no focus.
 */
export function OutcomeTick({ label, box, still, onDone }: OutcomeTickProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, OUTCOME_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <motion.div
      role="status"
      className={cn(
        'pointer-events-none fixed flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-200 bg-white px-2 text-sm font-medium text-emerald-800 shadow-sm',
        'dark:border-emerald-900/60 dark:bg-ink-900 dark:text-emerald-300',
        Z_INDEX.modal,
      )}
      // Centred on the button, at least as wide and as tall.
      style={{ left: box.left + box.width / 2, top: box.top + box.height / 2, minWidth: box.width, minHeight: box.height, x: '-50%', y: '-50%' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 1, 0], transition: { duration: OUTCOME_MS / 1000, times: [0, 0.08, 0.85, 1], ease: 'linear' } }}
    >
      <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
        <motion.path
          d="M2.5 7.5 L5.5 10.5 L11.5 3.5"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: still ? 1 : 0 }}
          animate={{ pathLength: 1, transition: { duration: 0.22, delay: 0.08, ease: ease.out } }}
        />
      </svg>
      {label}
    </motion.div>
  );
}
