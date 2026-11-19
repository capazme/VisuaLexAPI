import { useSyncExternalStore } from 'react';
import type { AppSettings } from '../types';

const QUERY = '(prefers-color-scheme: dark)';

/** The theme drawn: the reader's choice, or the system's when the choice is «di sistema» (LC115). */
export function resolveTheme(theme: AppSettings['theme'], systemDark: boolean): 'light' | 'dark' {
  if (theme === 'system') return systemDark ? 'dark' : 'light';
  return theme;
}

// No `matchMedia` (an old browser, a test without it): the system is light.
const media = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null);
const subscribe = (onChange: () => void) => {
  const query = media();
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
};
const systemIsDark = () => media()?.matches ?? false;

/** `resolveTheme` that follows the system as it changes (the Mac turning dark at sunset). */
export function useResolvedTheme(theme: AppSettings['theme']): 'light' | 'dark' {
  const systemDark = useSyncExternalStore(subscribe, systemIsDark, () => false);
  return resolveTheme(theme, systemDark);
}
