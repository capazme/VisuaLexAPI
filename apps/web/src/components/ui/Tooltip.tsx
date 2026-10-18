import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { dur, ease } from '../../lib/motion';
import { cn } from '../../lib/utils';

/** Within this long of one tooltip closing, the next opens at once and without motion (spec §5.1). */
const TOOLTIP_WARM_MS = 300;

// When the last tooltip closed, across every Tooltip: moving along a row of icons reads each label
// at once instead of waiting the first delay again.
let lastClosedAt = Number.NEGATIVE_INFINITY;

export interface TooltipProps {
  content: string;
  children: ReactNode;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  className?: string;
}

export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 500,
  className,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  // Shown without its entrance: opened warm, or by keyboard focus.
  const [instant, setInstant] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => cancel, []);

  const show = (now: boolean) => {
    cancel();
    setInstant(now);
    if (now) setIsVisible(true);
    else timer.current = setTimeout(() => setIsVisible(true), delay);
  };

  // A pointer waits the delay, unless another tooltip closed a moment ago.
  const handleMouseEnter = () => show(Date.now() - lastClosedAt < TOOLTIP_WARM_MS);
  // Keyboard focus shows it at once: what a pointer learns, a keyboard must learn too.
  const handleFocus = () => show(true);

  const handleHide = () => {
    cancel();
    if (isVisible) lastClosedAt = Date.now();
    setIsVisible(false);
  };

  const placementStyles = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  };

  const arrowStyles = {
    top: 'top-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-l-transparent',
  };

  return (
    <div
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleHide}
      onFocus={handleFocus}
      onBlur={handleHide}
    >
      {children}

      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={instant ? false : { opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0 } }}
            transition={{ duration: dur.press, ease: ease.out }}
            className={cn(
              'absolute z-50 pointer-events-none',
              placementStyles[placement]
            )}
          >
            <div
              className={cn(
                'bg-slate-900 text-white text-[11px] font-medium px-2.5 py-1 rounded-md shadow-md whitespace-nowrap',
                className
              )}
            >
              {content}

              {/* Arrow */}
              <div
                className={cn(
                  'absolute w-0 h-0 border-[3px] border-slate-900',
                  arrowStyles[placement]
                )}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
