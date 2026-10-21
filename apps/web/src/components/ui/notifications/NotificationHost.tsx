import { useEffect } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { spring } from '../../../lib/motion';
import { NotificationCard } from './NotificationCard';
import { isEditableTarget, isUndoShortcut, undoShortcutKeys, undoShortcutLabel } from './undoShortcut';
import {
  announce,
  closeNotification,
  latestUndoable,
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
 * a fourth closes the oldest, and the others move into place with a spring. A list named «Notifiche»; what each says
 * is read from two live regions, polite and assertive (an error interrupts), when it arrives. Mounted once, in `Layout`, in the toast band
 * of the z-index scale: above dialogs, so an error raised under one still shows.
 */
export function NotificationHost() {
  const entries = notificationStore((s) => s.entries);
  const announced = notificationStore((s) => s.announced);
  const still = useReducedMotion() ?? false;
  useEffect(() => registerNotificationHost(), []);

  // Ctrl+Z (⌘Z on a Mac) runs the newest «Annulla» still on screen (L-36), and says so; never in a field, an editor or
  // anything editable, where it stays the browser's own undo, nor when something else took the key first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isUndoShortcut(event) || isEditableTarget(event.target)) return;
      const entry = latestUndoable();
      if (!entry) return;
      event.preventDefault();
      announce(`Annullato: ${entry.message}`);
      void undoNotification(entry.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // The notification the shortcut would undo writes it beside its «Annulla», where a keyboard is likely.
  const keyboard = typeof window.matchMedia !== 'function' || !window.matchMedia('(pointer: coarse)').matches;
  const shortcutFor = keyboard ? latestUndoable(entries)?.id : undefined;

  return (
    <div className={cn('pointer-events-none fixed inset-0', Z_INDEX.toast)}>
      {/* Read on arrival only (`announced`); a new element per notification, so the same words twice are read twice. */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announced.polite && <span key={announced.polite.id}>{announced.polite.message}</span>}
      </p>
      <p role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
        {announced.assertive && <span key={announced.assertive.id}>{announced.assertive.message}</span>}
      </p>
      {(['bottom', 'top'] as const).map((position) => (
        <Stack key={position} position={position} entries={entries.filter((e) => e.position === position)} still={still} shortcutFor={shortcutFor} />
      ))}
    </div>
  );
}

function Stack({ position, entries, still, shortcutFor }: { position: 'top' | 'bottom'; entries: NotificationEntry[]; still: boolean; shortcutFor?: number }) {
  if (entries.length === 0) return null;
  return (
    <div
      className={cn(
        // On a phone the width less a 16 px gutter; from `md` at the right, as wide as a sentence.
        'absolute inset-x-4 md:inset-x-auto md:right-8 md:w-[26rem]',
        position === 'bottom' ? 'bottom-4 md:bottom-8' : 'top-4',
      )}
    >
      <LayoutGroup id={`notifications-${position}`}>
        <ol aria-label="Notifiche" className="flex flex-col gap-2">
          {/* The newest first. */}
          {[...entries].reverse().map((entry) => (
            <motion.li key={entry.id} layout={still ? false : 'position'} transition={{ layout: spring.gentle }} className="pointer-events-auto">
              <NotificationCard
                entry={entry}
                still={still}
                shortcut={entry.id === shortcutFor ? { label: undoShortcutLabel(), keys: undoShortcutKeys() } : undefined}
                onUndo={() => undoNotification(entry.id)}
                onDismiss={() => closeNotification(entry.id, 'dismiss')}
                onHold={(reason, on) => holdNotification(entry.id, reason, on)}
                onExited={() => removeNotification(entry.id)}
              />
            </motion.li>
          ))}
        </ol>
      </LayoutGroup>
    </div>
  );
}
