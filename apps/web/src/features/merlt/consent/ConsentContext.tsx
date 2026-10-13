import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  fetchMerltConsent,
  setMerltConsent,
  revokeMerltConsent,
  type MerltConsentResponse,
} from '../../../services/merltService';
import { clearLegacyConsentKeys, type MerltConsentLevel } from '../merltConsent';
import { isMerltEnabled } from '../featureFlag';
import { ConsentContext, NoticeChangedError, type ConsentContextValue } from './context';

/**
 * Single source of truth for MERL-T consent: the server (MerltUserPreference, read through
 * GET /api/merlt/consent). Nothing is kept in the browser: until the server answers, nothing is
 * collected (`canTrack` false). The server's guards remain the hard gate.
 *
 * A level counts only under the current version of the MERL-T notice: when the person has not
 * answered it (`needsAnswer`), `ConsentScreen` asks, once, before work begins.
 */

const DISABLED_CONSENT: MerltConsentResponse = {
  level: 'none',
  storedLevel: 'none',
  noticeAnswered: true,
  notice: null,
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

function isNoticeChanged(err: unknown): boolean {
  const response = (err as { response?: { status?: number; data?: { detail?: string } } } | null)?.response;
  return response?.status === 409 && response.data?.detail === 'notice_changed';
}

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<InternalState>(() =>
    isMerltEnabled() ? { status: 'loading' } : { status: 'ready', consent: DISABLED_CONSENT },
  );

  // Guards against overlapping fetches (mount hydration vs. an explicit
  // refresh()): a second load is a no-op while one is in flight.
  const inFlightRef = useRef(false);

  // Async-only loader: every setState happens after `await`, so calling this
  // from the mount effect does not trigger a synchronous in-effect state update.
  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const consent = await fetchMerltConsent();
      setState({ status: 'ready', consent });
    } catch (err) {
      setState({ status: 'error', error: err instanceof Error ? err.message : 'consent_fetch_failed' });
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!isMerltEnabled() || inFlightRef.current) return;
    setState({ status: 'loading' });
    await load();
  }, [load]);

  const setConsent = useCallback(
    async (level: MerltConsentLevel, noticeId: string, reason?: string) => {
      try {
        const consent = await setMerltConsent(level, noticeId, reason);
        setState({ status: 'ready', consent });
      } catch (err) {
        if (!isNoticeChanged(err)) throw err;
        // Read the new notice, then ask the person to read it before choosing.
        await load();
        throw new NoticeChangedError();
      }
    },
    [load],
  );

  const revokeConsent = useCallback(
    async (options: { reason?: string; deleteData?: boolean } = {}) => {
      const { erasure, ...consent } = await revokeMerltConsent(options);
      setState({ status: 'ready', consent });
      return { erasureCompleted: erasure.completed };
    },
    [],
  );

  // Hydrate on mount. setState lives only in the promise callbacks (subscribing
  // to an external system), which satisfies react-hooks/set-state-in-effect.
  useEffect(() => {
    clearLegacyConsentKeys();
    if (!isMerltEnabled()) return;
    let cancelled = false;
    inFlightRef.current = true;
    fetchMerltConsent()
      .then((consent) => {
        if (cancelled) return;
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
  }, []);

  const consent = state.status === 'ready' ? state.consent : null;
  const level: MerltConsentLevel = consent?.level ?? 'none';

  const value: ConsentContextValue = {
    status: state.status,
    consent,
    level,
    canTrack: level !== 'none',
    needsAnswer: consent !== null && consent.notice !== null && !consent.noticeAnswered,
    notice: consent?.notice ?? null,
    error: state.status === 'error' ? state.error : null,
    setConsent,
    revokeConsent,
    refresh,
  };

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}
