import { useContext } from 'react';
import { ConsentContext, type ConsentContextValue } from './context';

/** Consume the MERL-T consent context. Throws if used outside ConsentProvider. */
export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);
  if (!ctx) {
    throw new Error('useConsent must be used within a ConsentProvider');
  }
  return ctx;
}

/**
 * The consent context, or null outside a ConsentProvider: for the app's shell (the layout's tour,
 * Impostazioni), which is also drawn where no provider is mounted.
 */
export function useConsentIfProvided(): ConsentContextValue | null {
  return useContext(ConsentContext);
}
