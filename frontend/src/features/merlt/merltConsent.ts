const MERLT_CONSENT_KEY = 'visualex.merlt.consent';

export type MerltConsentLevel = 'none' | 'basic' | 'full';

export function getMerltConsentLevel(): MerltConsentLevel {
    const value = localStorage.getItem(MERLT_CONSENT_KEY);
    if (value === 'basic' || value === 'full') return value;
    return 'none';
}

export function setMerltConsentLevel(level: MerltConsentLevel): void {
    if (level === 'none') {
        localStorage.removeItem(MERLT_CONSENT_KEY);
        return;
    }
    localStorage.setItem(MERLT_CONSENT_KEY, level);
}

export function hasMerltConsent(): boolean {
    return getMerltConsentLevel() !== 'none';
}
