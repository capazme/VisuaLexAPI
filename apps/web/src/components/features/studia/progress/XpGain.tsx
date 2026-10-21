import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { dur, ease } from '../../../../lib/motion';
import { cn } from '../../../../lib/utils';
import { INK_BORDER, INK_TEXT } from './tokens';
import { XP_GAIN_MS, gainLabel, gainSentence, useMountedFrame, type XpGainValue } from './xpGains';

/**
 * «+20 XP» (G1c): a small ink chip that rises a few pixels into place, stays `XP_GAIN_MS` and fades; under reduced
 * motion it only appears and goes. It takes no focus and no pointer and waits for nothing: the next card or vote is
 * never held. Its own polite live region says it in words (from the frame after it is drawn, so it is heard).
 */
export function XpGain({ gain, className }: { gain: XpGainValue | null; className?: string }) {
  const reduce = useReducedMotion() ?? false;
  const mounted = useMountedFrame();
  const [gone, setGone] = useState<XpGainValue['id'] | null>(null);
  const id = gain?.id ?? null;
  useEffect(() => {
    if (id === null) return;
    const timer = window.setTimeout(() => setGone(id), XP_GAIN_MS);
    return () => window.clearTimeout(timer);
  }, [id]);
  const shown = gain !== null && gone !== gain.id ? gain : null;
  return (
    <>
      <span aria-live="polite" className="sr-only">
        {shown && mounted ? gainSentence(shown) : ''}
      </span>
      <AnimatePresence>
        {shown && (
          <motion.span
            key={shown.id}
            aria-hidden
            data-testid="xp-gain"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : dur.panel, ease: ease.out }}
            className={cn(
              'pointer-events-none inline-flex items-center whitespace-nowrap rounded-full border bg-white px-2.5 py-0.5 text-xs font-semibold tabular-nums dark:bg-slate-900',
              INK_BORDER,
              INK_TEXT,
              className,
            )}
          >
            {gainLabel(shown)}
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );
}
