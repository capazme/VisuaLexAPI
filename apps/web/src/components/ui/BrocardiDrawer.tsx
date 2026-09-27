import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Book } from 'lucide-react';
import { cn } from '../../lib/utils';

interface BrocardiDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}

export function BrocardiDrawer({ isOpen, onClose, children, title = "Approfondimenti Giuridici" }: BrocardiDrawerProps) {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
            onClick={onClose}
          />

          {/* Drawer Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{
              type: 'spring',
              damping: 30,
              stiffness: 300
            }}
            className={cn(
              "fixed right-0 top-0 bottom-0 z-50",
              "w-full sm:w-[500px] md:w-[600px] lg:w-[700px]",
              "bg-white dark:bg-slate-900",
              "shadow-2xl",
              "flex flex-col"
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <Book size={20} className="text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    {title}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Annotazioni Brocardi
                  </p>
                </div>
              </div>

              <button
                onClick={onClose}
                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors group"
                title="Chiudi pannello (Esc)"
              >
                <X size={20} className="text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {children}
            </div>

            {/* Footer Hint */}
            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 shrink-0">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <kbd className="px-2 py-1 bg-white dark:bg-slate-900 rounded border border-slate-300 dark:border-slate-700 text-xs">
                  Esc
                </kbd>
                {' '}per chiudere
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
