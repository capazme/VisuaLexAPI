import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { isPracticeBackEntry, peekReadingBack, type PracticeBackEntry } from '../../../utils/readingBackStack';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';

/**
 * "Go back" after following a citation.
 *
 * Rendered once for the whole app rather than per tab: the stack is global, so
 * a per-tab copy would sit in the very tab an entry points at and offer to
 * take the reader to where they already are.
 *
 * It names its destination. A back control that does not say where it goes
 * makes the user gamble, and after a couple of jumps nobody remembers.
 */
interface ReadingBackControlProps {
  /**
   * Fired with the tab that was returned to, or the practice and, for a practice, the entry
   * walked back to: its subject and whether it was read in the table or beside it (spec §6.3), for
   * a view that must follow (the phone's reader, P5). The mobile layout tracks the visible tab in
   * its own index rather than through the store's front-tab ordering, so it needs telling; on
   * desktop nothing has to listen.
   */
  onNavigated?: (tabId: string, entry?: PracticeBackEntry) => void;
  /**
   * Where the control floats. `top` (the default, flag off) is the old tabs' place, centred at the
   * top. With the practices it would sit on the top act's sticky heading and over a window's
   * header, so `bottom` puts it centred above the bar of practices, `bottomOffset` px from the
   * viewport's bottom: the bottom is the one edge the table, its headings and its windows leave free.
   */
  placement?: 'top' | 'bottom';
  bottomOffset?: number;
}

export function ReadingBackControl({ onNavigated, placement = 'top', bottomOffset = 16 }: ReadingBackControlProps) {
  const atBottom = placement === 'bottom';
  const { readingBackStack, workspaceTabs, practices, popReadingBack, bringTabToFront, focusArticleInTab } =
    useAppStore(useShallow(s => ({
      readingBackStack: s.readingBackStack,
      workspaceTabs: s.workspaceTabs,
      practices: s.practices,
      popReadingBack: s.popReadingBack,
      bringTabToFront: s.bringTabToFront,
      focusArticleInTab: s.focusArticleInTab,
    })));

  // Peeking (rather than reading the raw length) is what keeps the control
  // from offering a jump back into a tab or block that has since been closed.
  const target = peekReadingBack(readingBackStack, workspaceTabs, practices);

  const handleBack = () => {
    const entry = popReadingBack();
    if (!entry) return;
    // A practice's entry is walked back to by the store itself (spec §6.3: its practice made active,
    // its row revealed); only the flag pushes one. The listener learns which practice.
    if (isPracticeBackEntry(entry)) {
      onNavigated?.(entry.practiceId, entry);
      return;
    }
    bringTabToFront(entry.tabId);
    focusArticleInTab(entry.tabId, entry.articleId);
    onNavigated?.(entry.tabId);
  };

  return (
    <AnimatePresence>
      {target && (
        <motion.div
          initial={{ opacity: 0, y: atBottom ? 8 : -8, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: atBottom ? 8 : -8, x: '-50%' }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          style={atBottom ? { bottom: bottomOffset } : undefined}
          className={cn('fixed left-1/2 px-4', !atBottom && 'top-4', Z_INDEX.structure)}
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
