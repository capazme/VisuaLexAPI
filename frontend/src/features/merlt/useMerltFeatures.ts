import { useConsent } from './consent/useConsent';
import { useAuth } from '../../hooks/useAuth';
import { isMerltEnabled } from './featureFlag';
import { isMerltGraphEnabled } from './graph/featureFlag';
import type { MerltConsentLevel } from './merltConsent';

/**
 * Client-side derivation of "what MERL-T capabilities are available" (Slice 2b).
 *
 * Replaces the old hook that called the never-implemented GET /merlt/features.
 * All inputs already exist on the client: build-time flags, the consent level
 * (from ConsentContext — the server-synced SoT), and isAdmin (from useAuth).
 */
export interface MerltFeatures {
  merltEnabled: boolean;
  graphEnabled: boolean;
  consentLevel: MerltConsentLevel;
  status: 'loading' | 'ready' | 'error';
  canTrack: boolean;
  canContribute: boolean;
  canValidate: boolean;
  graphReadable: boolean;
  opsVisible: boolean;
}

export function useMerltFeatures(): MerltFeatures {
  const { level, canTrack, status } = useConsent();
  const { isAdmin } = useAuth();

  const merltEnabled = isMerltEnabled();
  const graphEnabled = merltEnabled && isMerltGraphEnabled();

  return {
    merltEnabled,
    graphEnabled,
    consentLevel: level,
    status,
    canTrack: merltEnabled && canTrack,
    canContribute: merltEnabled && level === 'full',
    canValidate: merltEnabled && level === 'full',
    graphReadable: graphEnabled, // reading is free (D2): flag-only, no consent coupling
    opsVisible: merltEnabled && isAdmin,
  };
}
