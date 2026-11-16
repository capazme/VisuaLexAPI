import { useSyncExternalStore } from 'react';

/**
 * The first-run guide's open state (`WelcomeGuide`), module-wide: `useTour` opens it, the layout draws it. `onClose` is
 * called once, however it closes (a button, Esc, the veil), so the guide is marked seen exactly once.
 */
let current: { onClose: () => void } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function openWelcomeGuide(onClose: () => void): void {
  if (current) return;
  current = { onClose };
  emit();
}

export function closeWelcomeGuide(): void {
  const closing = current;
  if (!closing) return;
  current = null;
  emit();
  closing.onClose();
}

export function useWelcomeGuideOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current !== null,
    () => false,
  );
}
