import { createContext } from 'react';
import type { MerltConsentResponse, MerltNotice } from '../../../services/merltService';
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
  /** What MERL-T may collect now: the server's level once ready, `none` before. */
  level: MerltConsentLevel;
  /** True when *some* consent (basic|full) is in force. */
  canTrack: boolean;
  /** The current notice has not been answered: the consent screen asks it, once. */
  needsAnswer: boolean;
  /** The current MERL-T notice, once ready. */
  notice: MerltNotice | null;
  error: string | null;
  /** Choose a level under the notice the person read. Rejects with `NoticeChangedError` when it changed. */
  setConsent: (level: MerltConsentLevel, noticeId: string, reason?: string) => Promise<void>;
  /** Revoke; with `deleteData`, erase what was collected. Resolves to whether MERL-T confirmed it. */
  revokeConsent: (options?: { reason?: string; deleteData?: boolean }) => Promise<{ erasureCompleted: boolean }>;
  refresh: () => Promise<void>;
}

/** The notice changed while the person was reading it: the context has the new one. */
export class NoticeChangedError extends Error {
  constructor() {
    super('L’informativa è stata aggiornata nel frattempo: rileggila e conferma di nuovo la scelta.');
    this.name = 'NoticeChangedError';
  }
}

export const ConsentContext = createContext<ConsentContextValue | null>(null);
