import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { peekReadingBack } from '../../../utils/readingBackStack';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';

/**
 * "Go back" after following a citation.
 *
 * Rendered once for the whole app rather than per practice: the stack is global, so
 * a per-practice copy would sit in the very place an entry points at and offer to
 * take the reader to where they already are.
 *
 * It names its destination. A back control that does not say where it goes
 * makes the user gamble, and after a couple of jumps nobody remembers.
 */
interface ReadingBackControlProps {
  /**
   * `bottomOffset` px from the viewport's bottom: centred above the bar of practices, the one edge the
   * table, its headings and its windows leave free.
   */
  bottomOffset?: number;
}

export function ReadingBackControl({ bottomOffset = 16 }: ReadingBackControlProps) {
  const { readingBackStack, practices, popReadingBack } =
    useAppStore(useShallow(s => ({
      readingBackStack: s.readingBackStack,
      practices: s.practices,
      popReadingBack: s.popReadingBack,
    })));

  // Peeking (rather than reading the raw length) is what keeps the control
  // from offering a jump back into a practice or a subject that has since been closed.
  const target = peekReadingBack(readingBackStack, practices);

  const handleBack = () => {
    // The store walks back to the entry itself (spec §6.3: its practice made active, its row
    // revealed or its window reopened, the phone's reader opened or closed).
    popReadingBack();
  };

  return (
    <AnimatePresence>
      {target && (
        <motion.div
          initial={{ opacity: 0, y: 8, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: 8, x: '-50%' }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          style={{ bottom: bottomOffset }}
          className={cn('fixed left-1/2 px-4', Z_INDEX.structure)}
        >
          <button
            onClick={handleBack}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-full max-w-[min(90vw,26rem)]',
              'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900',
              'text-sm font-medium shadow-lg transition-transform active:scale-95',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
            )}
          >
            <ArrowLeft size={16} className="shrink-0" />
            <span className="truncate">Torna a {target.label}</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
