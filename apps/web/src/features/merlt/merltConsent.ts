export type MerltConsentLevel = 'none' | 'basic' | 'full';

/**
 * Keys the app once wrote in this browser for MERL-T consent: the level as a boot cache, and the
 * snooze of the old banner. The server is the only record of a consent; on a shared browser the
 * cache handed the next person the previous one's level until the server answered. Removed once.
 */
const LEGACY_KEYS = ['visualex.merlt.consent', 'visualex.merlt.consent-snooze', 'visualex.merlt.ask-teaser-dismissed'];

export function clearLegacyConsentKeys(): void {
    try {
        for (const key of LEGACY_KEYS) localStorage.removeItem(key);
    } catch {
        // storage refused (private window, blocked site data): nothing was kept there either
    }
}
