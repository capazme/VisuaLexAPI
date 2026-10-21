import { useEffect } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { spring } from '../../../lib/motion';
import { NotificationCard } from './NotificationCard';
import {
  closeNotification,
  holdNotification,
  notificationStore,
  registerNotificationHost,
  removeNotification,
  undoNotification,
  type NotificationEntry,
} from './notifications';

/**
 * The app's notifications (K1a): every `Toast` and every «Annulla» (`showUndoToast`) is drawn here while it is mounted,
 * in a stack at the bottom of the screen (at the top for the few that ask), three at most: the newest is drawn first,
 * a fourth closes the oldest, and the others move into place with a spring. A list with its name; what each says is
 * read from two live regions, polite and assertive (an error interrupts). Mounted once, in `Layout`, in the toast band
 * of the z-index scale: above dialogs, so an error raised under one still shows.
 */
export function NotificationHost() {
  const entries = notificationStore((s) => s.entries);
  const still = useReducedMotion() ?? false;
  useEffect(() => registerNotificationHost(), []);

  // What the live regions read: the newest that is not leaving, by its politeness.
  const live = entries.filter((e) => !e.closing && e.ariaLive !== 'off');
  const latest = (assertive: boolean) =>
    [...live].reverse().find((e) => (e.ariaLive ?? (e.type === 'error' ? 'assertive' : 'polite')) === (assertive ? 'assertive' : 'polite'));

  return (
    <div className={cn('pointer-events-none fixed inset-0', Z_INDEX.toast)}>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {latest(false)?.message ?? ''}
      </p>
      <p role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
        {latest(true)?.message ?? ''}
      </p>
      {(['bottom', 'top'] as const).map((position) => (
        <Stack key={position} position={position} entries={entries.filter((e) => e.position === position)} still={still} />
      ))}
    </div>
  );
}

function Stack({ position, entries, still }: { position: 'top' | 'bottom'; entries: NotificationEntry[]; still: boolean }) {
  if (entries.length === 0) return null;
  return (
    <section
      aria-label="Notifiche"
      className={cn(
        // On a phone the width less a 16 px gutter; from `md` at the right, as wide as a sentence.
        'absolute inset-x-4 md:inset-x-auto md:right-8 md:w-[26rem]',
        position === 'bottom' ? 'bottom-4 md:bottom-8' : 'top-4',
      )}
    >
      <LayoutGroup id={`notifications-${position}`}>
        <ol className="flex flex-col gap-2">
          {/* The newest first. */}
          {[...entries].reverse().map((entry) => (
            <motion.li key={entry.id} layout={still ? false : 'position'} transition={{ layout: spring.gentle }} className="pointer-events-auto">
              <NotificationCard
                entry={entry}
                still={still}
                onUndo={() => undoNotification(entry.id)}
                onDismiss={() => closeNotification(entry.id, 'dismiss')}
                onHold={(reason, on) => holdNotification(entry.id, reason, on)}
                onExited={() => removeNotification(entry.id)}
              />
            </motion.li>
          ))}
        </ol>
      </LayoutGroup>
    </section>
  );
}
