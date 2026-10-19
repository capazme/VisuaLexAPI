import { useEffect, useRef } from 'react';
import {
    sendCitationClickedEvent,
    type CitationClickedEventInput,
} from '../../../services/merltService';
import { subscribeMerltEvents, MERLT_EVENT_TYPES } from '../merltEventBus';
import { useConsent } from '../consent/useConsent';

/**
 * Hook (MERLT-1.9): subscribes to the merltEventBus and forwards
 * citation:clicked events to /api/merlt/events/citation-clicked.
 *
 * Legacy bus fires `citation_click` (NEW in this story; previously the
 * code used `citationDetected` semantically for both detection and
 * click — keep `citationDetected` for detection, add
 * `citationClicked` for explicit user-triggered navigation).
 *
 * Forwarded payload includes source + target URN and the visible
 * citation text. Target may be null when the linker could not resolve
 * the reference.
 *
 * Fire-and-forget.
 */

interface Metadata {
    source_urn?: string;
    target_urn?: string | null;
    citation_text?: string;
    [k: string]: unknown;
}

export function useCitationTracker(disabled = false): void {
    const { canTrack } = useConsent();
    const canTrackRef = useRef(canTrack);
    useEffect(() => {
        canTrackRef.current = canTrack;
    }, [canTrack]);

    useEffect(() => {
        if (disabled) return;

        const unsubscribe = subscribeMerltEvents((event) => {
            if (!canTrackRef.current) return;
            if (event.interaction_type !== MERLT_EVENT_TYPES.citationClicked) return;

            const meta = (event.metadata ?? {}) as Metadata;
            const sourceUrn =
                typeof meta.source_urn === 'string' ? meta.source_urn : event.article_urn;
            if (!sourceUrn) return;
            const citationText =
                typeof meta.citation_text === 'string' ? meta.citation_text : '';
            if (!citationText) return;

            const payload: CitationClickedEventInput = {
                sourceArticleUrn: sourceUrn,
                targetArticleUrn:
                    typeof meta.target_urn === 'string'
                        ? meta.target_urn
                        : meta.target_urn === null
                        ? null
                        : null,
                citationText,
            };

            void sendCitationClickedEvent(payload).catch((err) => {
                console.warn('[merlt] citation-clicked emit failed:', err);
            });
        });

        return unsubscribe;
    }, [disabled]);
}
