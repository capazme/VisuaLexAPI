import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Sparkles, X } from 'lucide-react';
import { useVersionCheck } from '../../hooks/useVersionCheck';
import { Modal } from './Modal';
import { cn } from '../../lib/utils';
import { spring } from '../../lib/motion';
import { ACTIVE, FOCUS_RING, TRANSITION } from '../../constants/interactions';
import { newsSince, parseNote, type Inline, type VersionNews } from '../../content/novita/releaseNotes';

/**
 * The version's news (R1): a toast when the app is at a version this browser has not seen, and «Vedi»
 * opens the notes for the people who use VisuaLex (`content/novita/`) — the new version's, and those of
 * the versions skipped since the last visit, the newest first. `/version` gives the number only.
 * Dismissed (the X, or the window closed), the version is remembered and the toast does not come back.
 */
export function ChangelogNotification() {
  const { currentVersion, hasNewVersion, lastSeenVersion, dismissNotification, showChangelog, setShowChangelog } =
    useVersionCheck();
  const still = useReducedMotion();

  if (!hasNewVersion || !currentVersion) {
    return null;
  }

  const news = newsSince(lastSeenVersion, currentVersion);
  const away = still ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.95 };

  const handleCloseModal = () => {
    setShowChangelog(false);
    dismissNotification();
  };

  return (
    <>
      <AnimatePresence>
        {!showChangelog && (
          <motion.div
            initial={away}
            animate={still ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={away}
            transition={spring.snappy}
            className={cn(
              'fixed z-[60] flex items-center gap-3 py-2 pl-4 pr-2 rounded-xl border w-max max-w-[calc(100vw-2rem)] md:max-w-md',
              'bottom-4 left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:bottom-8 md:right-8',
              'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800',
              'text-slate-900 dark:text-slate-100 shadow-lg'
            )}
            role="status"
          >
            <div
              className="shrink-0 size-9 rounded-lg bg-toga-50 dark:bg-toga-900/30 flex items-center justify-center"
              aria-hidden="true"
            >
              <Sparkles size={18} className="text-toga-600 dark:text-toga-300" />
            </div>

            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Novità in v{currentVersion}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400 truncate">Scopri le ultime modifiche</p>
            </div>

            <button
              type="button"
              onClick={() => setShowChangelog(true)}
              className={cn(
                'shrink-0 min-h-11 px-4 rounded-lg text-sm font-medium',
                'bg-toga-600 text-white hover:bg-toga-700',
                'dark:bg-toga-400 dark:text-ink-950 dark:hover:bg-toga-300',
                TRANSITION,
                FOCUS_RING,
                ACTIVE
              )}
            >
              Vedi
            </button>

            <button
              type="button"
              onClick={dismissNotification}
              className={cn(
                'shrink-0 inline-flex size-11 items-center justify-center rounded-lg',
                'text-slate-500 hover:text-slate-800 hover:bg-slate-100',
                'dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800',
                TRANSITION,
                FOCUS_RING
              )}
              aria-label="Chiudi notifica"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal
        isOpen={showChangelog}
        onClose={handleCloseModal}
        title={news.length > 1 ? 'Novità dalla tua ultima visita' : `Novità in v${currentVersion}`}
        size="md"
      >
        <ReleaseNews news={news} />
      </Modal>
    </>
  );
}

function InlineText({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.kind === 'strong' ? (
          <strong key={index} className="font-semibold text-slate-900 dark:text-slate-50">
            {part.text}
          </strong>
        ) : part.kind === 'em' ? (
          <em key={index}>{part.text}</em>
        ) : part.kind === 'code' ? (
          <code
            key={index}
            className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em] text-slate-800 dark:bg-slate-800 dark:text-slate-200"
          >
            {part.text}
          </code>
        ) : (
          part.text
        )
      )}
    </>
  );
}

/** One release's note as text, its groups headed one level under `level`. */
function NoteBody({ note, level }: { note: string | null; level: 3 | 4 }) {
  if (note === null) {
    return <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">Correzioni e miglioramenti</p>;
  }
  const Heading = level === 3 ? 'h3' : 'h4';
  return (
    <div className="space-y-2 text-[15px] leading-relaxed text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">
      {parseNote(note).map((block, index) =>
        block.kind === 'heading' ? (
          <Heading
            key={index}
            className="pt-3 text-sm font-semibold text-slate-900 first:pt-0 dark:text-slate-50"
          >
            {block.text}
          </Heading>
        ) : block.kind === 'list' ? (
          <ul key={index} className="list-disc space-y-1.5 pl-5 marker:text-slate-400 dark:marker:text-slate-500">
            {block.items.map((item, i) => (
              <li key={i}>
                <InlineText parts={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>
            <InlineText parts={block.content} />
          </p>
        )
      )}
    </div>
  );
}

/**
 * The window's body: one version's note, or — when the reader skipped some — each version under its own
 * heading, the newest first. Exported for its test.
 */
export function ReleaseNews({ news }: { news: VersionNews[] }) {
  if (news.length === 1) {
    return <NoteBody note={news[0].note} level={3} />;
  }
  return (
    <div className="divide-y divide-slate-200 dark:divide-slate-800">
      {news.map(({ version, note }) => (
        <section key={version} aria-labelledby={`novita-${version}`} className="py-5 first:pt-0 last:pb-0">
          <h3
            id={`novita-${version}`}
            className="mb-3 font-serif text-xl font-medium text-slate-900 dark:text-slate-50"
          >
            Versione {version}
          </h3>
          <NoteBody note={note} level={4} />
        </section>
      ))}
    </div>
  );
}
