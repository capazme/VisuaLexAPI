import { useEffect } from 'react';
import {
    sendHighlightAnnotationEvent,
    type HighlightAnnotationEventInput,
} from '../../../services/merltService';
import { subscribeMerltEvents, MERLT_EVENT_TYPES } from '../merltEventBus';
import { hasMerltConsent } from '../merltConsent';

/**
 * Hook that listens on the legacy merltEventBus and forwards
 * highlight/annotation events to the new BFF endpoint
 * `/api/merlt/events/highlight-annotation`.
 *
 * Design rationale (MERLT-1.7):
 *   - publishMerltEvent() is already called from many call-sites
 *     (SelectionPopup highlight, handleAddNote, etc.) since commit 81be277.
 *     Subscribing to the bus means we do NOT need to add a tracker
 *     invocation at every call-site, only at the plugin slot level.
 *   - The legacy `trackMerltInteraction` inside merltEventBus posts to a
 *     legacy endpoint that returns 404 today — that's acceptable
 *     (caught + warn-logged); the new subscriber takes the same events
 *     and routes them to the working endpoint.
 *
 * The hook is fire-and-forget: errors are logged but do not block UI.
 */

interface Metadata {
    anchor_text?: string;
    note_text?: string;
    color?: string;
    start_offset?: number;
    [k: string]: unknown;
}

function mapHighlight(articleUrn: string, metadata: Metadata): HighlightAnnotationEventInput {
    return {
        kind: 'highlight',
        anchorText: typeof metadata.anchor_text === 'string' ? metadata.anchor_text : '',
        startOffset: typeof metadata.start_offset === 'number' ? metadata.start_offset : 0,
        articleUrn,
        color: typeof metadata.color === 'string' ? metadata.color : undefined,
    };
}

function mapAnnotation(articleUrn: string, metadata: Metadata): HighlightAnnotationEventInput {
    return {
        kind: 'annotation',
        anchorText: typeof metadata.anchor_text === 'string' ? metadata.anchor_text : '',
        startOffset: typeof metadata.start_offset === 'number' ? metadata.start_offset : 0,
        articleUrn,
        noteText: typeof metadata.note_text === 'string' ? metadata.note_text : undefined,
    };
}

export function useHighlightAnnotationTracker(disabled = false): void {
    useEffect(() => {
        if (disabled) return;

        const unsubscribe = subscribeMerltEvents((event) => {
            if (!hasMerltConsent()) return;
            if (!event.article_urn) return;

            const meta = (event.metadata ?? {}) as Metadata;
            let payload: HighlightAnnotationEventInput | null = null;

            if (event.interaction_type === MERLT_EVENT_TYPES.highlightCreated) {
                payload = mapHighlight(event.article_urn, meta);
            } else if (event.interaction_type === MERLT_EVENT_TYPES.annotationCreated) {
                payload = mapAnnotation(event.article_urn, meta);
            }

            if (!payload || !payload.anchorText) return;

            void sendHighlightAnnotationEvent(payload).catch((err) => {
                // eslint-disable-next-line no-console
                console.warn('[merlt] highlight-annotation emit failed:', err);
            });
        });

        return unsubscribe;
    }, [disabled]);
}
