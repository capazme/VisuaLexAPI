import { useEffect, useState } from 'react';
import { getMerltFeatures, updateMerltConsent, type MerltFeatureState } from '../../services/merltService';
import { getMerltConsentLevel, setMerltConsentLevel, type MerltConsentLevel } from './merltConsent';

export function useMerltFeatures() {
    const [features, setFeatures] = useState<MerltFeatureState | null>(null);
    const [consentLevel, setConsentLevelState] = useState<MerltConsentLevel>(() => getMerltConsentLevel());
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function loadFeatures() {
            try {
                setIsLoading(true);
                setError(null);
                const next = await getMerltFeatures();
                if (!cancelled) {
                    setFeatures(next);
                    setMerltConsentLevel(next.consent_level);
                    setConsentLevelState(next.consent_level);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Impossibile caricare le feature MERLT');
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        }

        void loadFeatures();

        return () => {
            cancelled = true;
        };
    }, []);

    const updateConsent = async (level: MerltConsentLevel) => {
        const updated = await updateMerltConsent({
            consentLevel: level,
            contributionEnabled: level === 'full',
            validationEnabled: level === 'full',
            graphEnabled: level !== 'none',
        });
        setMerltConsentLevel(updated.consentLevel);
        setConsentLevelState(updated.consentLevel);
        setFeatures(updated.features);
    };

    return {
        features,
        consentLevel,
        isLoading,
        error,
        hasConsent: consentLevel !== 'none',
        isBackendEnabled: Boolean(features?.enabled),
        isEnabled: Boolean(features?.enabled && features.features.merlt),
        updateConsent,
    };
}
