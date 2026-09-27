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
 * Rendered once for the whole app rather than per tab: the stack is global, so
 * a per-tab copy would sit in the very tab an entry points at and offer to
 * take the reader to where they already are.
 *
 * It names its destination. A back control that does not say where it goes
 * makes the user gamble, and after a couple of jumps nobody remembers.
 */
interface ReadingBackControlProps {
  /**
   * Fired with the tab that was returned to. The mobile layout tracks the
   * visible tab in its own index rather than through the store's front-tab
   * ordering, so it needs telling; on desktop nothing has to listen.
   */
  onNavigated?: (tabId: string) => void;
}

export function ReadingBackControl({ onNavigated }: ReadingBackControlProps) {
  const { readingBackStack, workspaceTabs, popReadingBack, bringTabToFront, focusArticleInTab } =
    useAppStore(useShallow(s => ({
      readingBackStack: s.readingBackStack,
      workspaceTabs: s.workspaceTabs,
      popReadingBack: s.popReadingBack,
      bringTabToFront: s.bringTabToFront,
      focusArticleInTab: s.focusArticleInTab,
    })));

  // Peeking (rather than reading the raw length) is what keeps the control
  // from offering a jump back into a tab or block that has since been closed.
  const target = peekReadingBack(readingBackStack, workspaceTabs);

  const handleBack = () => {
    const entry = popReadingBack();
    if (!entry) return;
    bringTabToFront(entry.tabId);
    focusArticleInTab(entry.tabId, entry.articleId);
    onNavigated?.(entry.tabId);
  };

  return (
    <AnimatePresence>
      {target && (
        <motion.div
          initial={{ opacity: 0, y: -8, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: -8, x: '-50%' }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className={cn('fixed top-4 left-1/2 px-4', Z_INDEX.structure)}
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
