import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, GitCommit, Calendar, User } from 'lucide-react';
import { useVersionCheck } from '../../hooks/useVersionCheck';
import { Modal } from './Modal';
import { cn } from '../../lib/utils';
import type { ChangelogEntry } from '../../config/versionConfig';

/**
 * Changelog notification component
 *
 * Shows a toast when a new version is detected, with option to view full changelog.
 * Automatically saves the version to localStorage when dismissed.
 */
export function ChangelogNotification() {
  const {
    currentVersion,
    hasNewVersion,
    changelog,
    dismissNotification,
    showChangelog,
    setShowChangelog,
  } = useVersionCheck();

  // Don't render if no new version
  if (!hasNewVersion || !currentVersion) {
    return null;
  }

  const handleViewChangelog = () => {
    setShowChangelog(true);
  };

  const handleCloseModal = () => {
    setShowChangelog(false);
    dismissNotification();
  };

  const handleDismissToast = () => {
    dismissNotification();
  };

  return (
    <>
      {/* Toast Notification */}
      <AnimatePresence>
        {!showChangelog && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className={cn(
              'fixed z-[60] flex items-center gap-3 px-4 py-3 rounded-xl border max-w-[90vw] md:max-w-md',
              'bottom-4 left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:bottom-8 md:right-8',
              'bg-white dark:bg-slate-900 border-primary-200 dark:border-primary-900/30',
              'text-slate-800 dark:text-slate-100 shadow-lg shadow-primary-500/10'
            )}
            role="alert"
          >
            {/* Icon */}
            <div className="shrink-0 w-9 h-9 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
              <Sparkles size={18} className="text-primary-500" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Novità in v{currentVersion}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                Scopri le ultime modifiche
              </p>
            </div>

            {/* Actions */}
            <button
              onClick={handleViewChangelog}
              className={cn(
                'shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium',
                'bg-primary-500 hover:bg-primary-600 text-white',
                'transition-colors'
              )}
            >
              Vedi
            </button>

            <button
              onClick={handleDismissToast}
              className={cn(
                'shrink-0 p-1.5 rounded-lg transition-colors',
                'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200',
                'hover:bg-slate-100 dark:hover:bg-slate-800'
              )}
              aria-label="Chiudi notifica"
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Changelog Modal */}
      <Modal
        isOpen={showChangelog}
        onClose={handleCloseModal}
        title={`Novità in v${currentVersion}`}
        size="md"
      >
        <ChangelogContent changelog={changelog} />
      </Modal>
    </>
  );
}

/**
 * Changelog content for the modal
 */
function ChangelogContent({ changelog }: { changelog: ChangelogEntry[] }) {
  if (!changelog || changelog.length === 0) {
    return (
      <p className="text-slate-500 dark:text-slate-400 text-center py-4">
        Nessun changelog disponibile
      </p>
    );
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr || dateStr === 'unknown') return 'N/D';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('it-IT', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const formatMessage = (message: string) => {
    // Highlight conventional commit prefixes
    const prefixMatch = message.match(/^(feat|fix|docs|style|refactor|perf|test|chore|build|ci)(\(.+?\))?:/i);
    if (prefixMatch) {
      const prefix = prefixMatch[0];
      const rest = message.slice(prefix.length).trim();
      return (
        <>
          <span className="font-semibold text-primary-600 dark:text-primary-400">
            {prefix}
          </span>{' '}
          {rest}
        </>
      );
    }
    return message;
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
        Ultimi {changelog.length} aggiornamenti:
      </p>

      <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-2">
        {changelog.map((entry, index) => (
          <div
            key={entry.hash || index}
            className={cn(
              'p-3 rounded-lg border',
              'bg-slate-50 dark:bg-slate-800/50',
              'border-slate-200 dark:border-slate-700'
            )}
          >
            {/* Message */}
            <p className="text-sm text-slate-800 dark:text-slate-200 mb-2 leading-relaxed">
              {formatMessage(entry.message)}
            </p>

            {/* Meta */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              {entry.hash && (
                <span className="flex items-center gap-1">
                  <GitCommit size={12} />
                  <code className="font-mono">{entry.hash.slice(0, 7)}</code>
                </span>
              )}
              {entry.date && (
                <span className="flex items-center gap-1">
                  <Calendar size={12} />
                  {formatDate(entry.date)}
                </span>
              )}
              {entry.author && entry.author !== 'unknown' && (
                <span className="flex items-center gap-1">
                  <User size={12} />
                  {entry.author}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
