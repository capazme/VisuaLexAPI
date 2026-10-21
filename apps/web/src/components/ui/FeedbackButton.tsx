import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquarePlus } from 'lucide-react';
import { cn } from '../../lib/utils';

interface FeedbackButtonProps {
  className?: string;
  /** Opens the form, which `Layout` holds: the user menu's «Invia un commento» opens it on a phone (M1). */
  onOpen: () => void;
}

/** The floating button at the bottom right, from `md`. */
export function FeedbackButton({ className, onOpen }: FeedbackButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className={cn('fixed bottom-6 right-6 z-40', className)}>
      <AnimatePresence>
        {showTooltip && (
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            className="absolute right-full mr-3 top-1/2 -translate-y-1/2 whitespace-nowrap"
          >
            <div className="px-3 py-1.5 bg-slate-900 dark:bg-slate-700 text-white text-sm rounded-lg shadow-lg">
              Invia feedback
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onOpen}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={cn(
          // Quiet: one of the page's floating tools, not its loudest object (spec §5.2).
          'p-3 rounded-full shadow-md border transition-colors',
          'bg-white border-slate-200 text-slate-600 hover:text-primary-700 hover:border-slate-300',
          'dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:text-primary-300',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
          'dark:focus-visible:ring-offset-slate-950'
        )}
        aria-label="Invia feedback"
      >
        <MessageSquarePlus size={20} />
      </motion.button>
    </div>
  );
}
