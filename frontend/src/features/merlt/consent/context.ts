import { createContext } from 'react';
import type { MerltConsentResponse } from '../../../services/merltService';
import type { MerltConsentLevel } from '../merltConsent';

/**
 * Context object + value type for MERL-T consent. Kept in a non-component module
 * so ConsentContext.tsx only exports the provider component (React Fast Refresh
 * boundary — react-refresh/only-export-components).
 */
export interface ConsentContextValue {
  status: 'loading' | 'ready' | 'error';
  /** Full server state once ready, otherwise null. */
  consent: MerltConsentResponse | null;
  /** Effective level: server value when ready, else the boot cache. */
  level: MerltConsentLevel;
  /** True when *some* consent (basic|full) is active. */
  canTrack: boolean;
  error: string | null;
  setConsent: (level: MerltConsentLevel, reason?: string) => Promise<void>;
  revokeConsent: (reason?: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export const ConsentContext = createContext<ConsentContextValue | null>(null);
