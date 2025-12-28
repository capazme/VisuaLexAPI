import { useState, useCallback, useRef, useEffect } from 'react';

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

// ============ Global Undo Toast Manager ============

type ToastCallback = (toast: UndoToast | null) => void;

export interface UndoToast {
  message: string;
  timeRemaining: number;
  onUndo: () => void;
  onDismiss: () => void;
}

let toastListener: ToastCallback | null = null;

/**
 * Register a listener for undo toasts (used by UndoToastContainer)
 */
export function registerUndoToastListener(callback: ToastCallback): () => void {
  toastListener = callback;
  return () => {
    toastListener = null;
  };
}

/**
 * Show an undo toast globally.
 * Returns a promise that resolves to true if action was completed,
 * or false if it was undone.
 */
export function showUndoToast<T>({
  action,
  undo,
  message,
  duration = 5000,
}: {
  action: () => T | Promise<T>;
  undo: (result: T) => void | Promise<void>;
  message: string;
  duration?: number;
}): Promise<boolean> {
  return new Promise(async (resolve) => {
    // Execute action first
    const result = await action();

    let resolved = false;

    const handleUndo = async () => {
      if (resolved) return;
      resolved = true;
      await undo(result);
      toastListener?.(null);
      resolve(false);
    };

    const handleDismiss = () => {
      if (resolved) return;
      resolved = true;
      toastListener?.(null);
      resolve(true);
    };

    // Start countdown
    let timeRemaining = duration;

    const updateToast = () => {
      toastListener?.({
        message,
        timeRemaining,
        onUndo: handleUndo,
        onDismiss: handleDismiss,
      });
    };

    updateToast();

    // Update countdown
    const interval = setInterval(() => {
      timeRemaining -= 100;
      if (timeRemaining <= 0) {
        clearInterval(interval);
        handleDismiss();
      } else {
        updateToast();
      }
    }, 100);
  });
}
