import { useState, useCallback, useRef, useEffect } from 'react';
import { closeNotification, notificationStore, notify, RESTORED_MS, undoNotification, UNDO_MS } from '../components/ui/notifications/notifications';

export interface UndoableActionOptions<T> {
  /** Action to execute */
  action: () => T | Promise<T>;
  /** Function to undo the action */
  undo: (result: T) => void | Promise<void>;
  /** Message to show in toast */
  message: string;
  /** Duration to show undo option (ms) */
  duration?: number;
  /** Callback when action is completed (not undone) */
  onComplete?: () => void;
  /** Callback when action is undone */
  onUndo?: () => void;
}

export interface UndoableActionState {
  isActive: boolean;
  message: string;
  timeRemaining: number;
}

export interface UseUndoableActionReturn {
  /** Execute the undoable action */
  execute: () => Promise<void>;
  /** Undo the action before timeout */
  undoAction: () => Promise<void>;
  /** Dismiss the undo option without undoing */
  dismiss: () => void;
  /** Current state */
  state: UndoableActionState;
}

/**
 * Hook for actions that can be undone within a time window.
 *
 * @example
 * const { execute, undoAction, dismiss, state } = useUndoableAction({
 *   action: () => deleteItem(id),
 *   undo: () => restoreItem(item),
 *   message: "Elemento eliminato",
 *   duration: 5000
 * });
 */
export function useUndoableAction<T>({
  action,
  undo,
  message,
  duration = 5000,
  onComplete,
  onUndo,
}: UndoableActionOptions<T>): UseUndoableActionReturn {
  const [isActive, setIsActive] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [currentMessage, setCurrentMessage] = useState('');

  const resultRef = useRef<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const execute = useCallback(async () => {
    // Clear any existing timers
    clearTimers();

    // Execute the action
    const result = await action();
    resultRef.current = result;

    // Start the undo window
    setCurrentMessage(message);
    setIsActive(true);
    setTimeRemaining(duration);

    // Update countdown every 100ms
    intervalRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        const next = prev - 100;
        if (next <= 0) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return next;
      });
    }, 100);

    // Set timeout for auto-completion
    timerRef.current = setTimeout(() => {
      setIsActive(false);
      setTimeRemaining(0);
      resultRef.current = null;
      onComplete?.();
      clearTimers();
    }, duration);
  }, [action, message, duration, onComplete, clearTimers]);

  const undoAction = useCallback(async () => {
    if (!isActive || resultRef.current === null) return;

    clearTimers();

    // Execute undo
    await undo(resultRef.current);

    setIsActive(false);
    setTimeRemaining(0);
    resultRef.current = null;
    onUndo?.();
  }, [isActive, undo, onUndo, clearTimers]);

  const dismiss = useCallback(() => {
    if (!isActive) return;

    clearTimers();
    setIsActive(false);
    setTimeRemaining(0);
    resultRef.current = null;
    onComplete?.();
  }, [isActive, onComplete, clearTimers]);

  return {
    execute,
    undoAction,
    dismiss,
    state: {
      isActive,
      message: currentMessage,
      timeRemaining,
    },
  };
}

// ============ The global «Annulla» notification ============

/**
 * Runs `action`, then shows a notification with «Annulla» in the stack (`components/ui/notifications`, K1a) for
 * `duration` ms, held while the user is on it. Resolves to true when the action stands (the time ran out, the
 * notification was closed or pushed out by a fourth), to false when it was undone or dropped at logout (an action held
 * until the notification is gone, as a large import, is then not carried out). «Annulla» closes it at once — a
 * last-moment click on a notification that is leaving is not taken — and awaits `undo`; once `undo` is done the
 * notification comes back in the same place saying «Ripristinato». An `undo` that throws has reported its own failure:
 * no «Ripristinato» then.
 */
export function showUndoToast<T>({
  action,
  undo,
  message,
  duration = UNDO_MS,
}: {
  action: () => T | Promise<T>;
  undo: (result: T) => void | Promise<void>;
  message: string;
  duration?: number;
}): Promise<boolean> {
  return Promise.resolve(action()).then((result) => new Promise<boolean>((resolve) => {
    let resolved = false;
    const id = notify({
      type: 'success',
      message,
      duration,
      onUndo: async () => {
        resolved = true;
        try {
          await undo(result);
          notify({ type: 'success', message: 'Ripristinato', duration: RESTORED_MS, after: id });
        } catch {
          // The undo said what went wrong.
        }
        resolve(false);
      },
      onClose: (reason) => {
        if (reason === 'undo' || resolved) return;
        resolved = true;
        // Dropped (the user logged out): what it held is not carried out, and nothing is undone either.
        resolve(reason !== 'dropped');
      },
    });
  }));
}

/** The newest «Annulla» on screen, as `registerUndoToastListener` hands it. */
export interface UndoToast {
  message: string;
  timeRemaining: number;
  /** Resolves once the undo is done. */
  onUndo: () => Promise<void>;
  onDismiss: () => void;
}

/**
 * Tells `callback` each time the newest «Annulla» on screen changes: the notification, or null once none is left.
 * What a test drives the undo through, without drawing the stack.
 */
export function registerUndoToastListener(callback: (toast: UndoToast | null) => void): () => void {
  let shown: number | null = null;
  return notificationStore.subscribe(({ entries }) => {
    const newest = [...entries].reverse().find((e) => e.undoable && !e.closing);
    if ((newest?.id ?? null) === shown) return;
    shown = newest?.id ?? null;
    callback(
      newest
        ? { message: newest.message, timeRemaining: newest.clock.remaining, onUndo: () => undoNotification(newest.id), onDismiss: () => closeNotification(newest.id, 'dismiss') }
        : null,
    );
  });
}
