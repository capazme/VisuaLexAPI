import { fetchMerltConsent, type MerltConsentResponse } from '../../../services/merltService';

/** The consent of an app or a server without MERL-T: nothing is collected, and there is nothing to answer. */
export const DISABLED_CONSENT: MerltConsentResponse = {
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

// A server that runs without MERL-T answers every /api/merlt route with 404 `merlt_disabled`, and keeps
// doing so for the life of the page: it is asked once, and its answer stands until the page is loaded again.
let serverWithoutMerlt = false;
// One read at a time, shared by whoever asks while it is on its way (StrictMode's second effect, a
// provider mounted again by the session check), so a page load asks the server once.
let pending: Promise<MerltConsentResponse> | null = null;

/** A 404 `merlt_disabled`, in the shape `services/api.ts` rejects with, or axios' own. */
function isMerltDisabled(err: unknown): boolean {
  const e = err as
    | { status?: number; data?: { detail?: string }; response?: { status?: number; data?: { detail?: string } } }
    | null;
  const status = e?.status ?? e?.response?.status;
  const detail = e?.data?.detail ?? e?.response?.data?.detail;
  return status === 404 && detail === 'merlt_disabled';
}

/**
 * GET /api/merlt/consent, at most one on its way. A server without MERL-T answers as the disabled
 * consent, and is not asked again; any other failure rejects as it came, and the next read asks again.
 */
export function readMerltConsent(): Promise<MerltConsentResponse> {
  if (serverWithoutMerlt) return Promise.resolve(DISABLED_CONSENT);
  pending ??= fetchMerltConsent()
    .catch((err: unknown) => {
      if (!isMerltDisabled(err)) throw err;
      serverWithoutMerlt = true;
      return DISABLED_CONSENT;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Tests only: forget what the server said, and any read on its way. */
export function _resetConsentReadForTests(): void {
  serverWithoutMerlt = false;
  pending = null;
}
