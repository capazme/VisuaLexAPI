import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  fetchMerltConsent,
  setMerltConsent,
  revokeMerltConsent,
  type MerltConsentResponse,
} from '../../../services/merltService';
import { getMerltConsentLevel, setMerltConsentLevel, type MerltConsentLevel } from '../merltConsent';
import { isMerltEnabled } from '../featureFlag';
import { ConsentContext, type ConsentContextValue } from './context';

/**
 * Single source of truth for MERL-T consent (Slice 2b).
 *
 * The SERVER (MerltUserPreference) is authoritative; this context hydrates
 * from GET /api/merlt/consent on mount and exposes set/revoke. localStorage
 * is a *boot cache only* — it provides the effective level for the first
 * paint (before the GET resolves) and on a transient fetch error, but the
 * server value always wins on reconcile. The server-side consentGuard remains
 * the hard gate for event emission (defence in depth).
 */

const DISABLED_CONSENT: MerltConsentResponse = {
  level: 'none',
  contributionEnabled: false,
  validationEnabled: false,
  graphEnabled: false,
  updatedAt: null,
  lastAuditAt: null,
};

type InternalState =
  | { status: 'loading' }
  | { status: 'ready'; consent: MerltConsentResponse }
  | { status: 'error'; error: string };

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<InternalState>(() =>
    isMerltEnabled() ? { status: 'loading' } : { status: 'ready', consent: DISABLED_CONSENT },
  );
  // Effective level while not 'ready' (loading / error): the boot cache.
  const [cacheLevel, setCacheLevel] = useState<MerltConsentLevel>(() => getMerltConsentLevel());

  // Guards against overlapping fetches (mount hydration vs. an explicit
  // refresh()): a second load is a no-op while one is in flight.
  const inFlightRef = useRef(false);

  const persist = useCallback((consent: MerltConsentResponse) => {
    setMerltConsentLevel(consent.level);
    setCacheLevel(consent.level);
  }, []);

  // Async-only loader: every setState happens after `await`, so calling this
  // from the mount effect does not trigger a synchronous in-effect state update.
  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const consent = await fetchMerltConsent();
      persist(consent);
      setState({ status: 'ready', consent });
    } catch (err) {
      setState({ status: 'error', error: err instanceof Error ? err.message : 'consent_fetch_failed' });
    } finally {
      inFlightRef.current = false;
    }
  }, [persist]);

  const refresh = useCallback(async () => {
    if (!isMerltEnabled() || inFlightRef.current) return;
    setState({ status: 'loading' });
    await load();
  }, [load]);

  const setConsent = useCallback(
    async (level: MerltConsentLevel, reason?: string) => {
      const consent = await setMerltConsent(level, reason);
      persist(consent);
      setState({ status: 'ready', consent });
    },
    [persist],
  );

  const revokeConsent = useCallback(
    async (reason?: string) => {
      const consent = await revokeMerltConsent(reason);
      persist(consent);
      setState({ status: 'ready', consent });
    },
    [persist],
  );

  // Hydrate on mount. setState lives only in the promise callbacks (subscribing
  // to an external system), which satisfies react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!isMerltEnabled()) return;
    let cancelled = false;
    inFlightRef.current = true;
    fetchMerltConsent()
      .then((consent) => {
        if (cancelled) return;
        persist(consent);
        setState({ status: 'ready', consent });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: 'error',
          error: err instanceof Error ? err.message : 'consent_fetch_failed',
        });
      })
      .finally(() => {
        inFlightRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [persist]);

  const level: MerltConsentLevel = state.status === 'ready' ? state.consent.level : cacheLevel;

  const value: ConsentContextValue = {
    status: state.status,
    consent: state.status === 'ready' ? state.consent : null,
    level,
    canTrack: level !== 'none',
    error: state.status === 'error' ? state.error : null,
    setConsent,
    revokeConsent,
    refresh,
  };

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}
