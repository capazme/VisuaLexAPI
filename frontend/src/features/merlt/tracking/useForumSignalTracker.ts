import { useEffect, useRef } from 'react';
import {
    sendForumSignalEvent,
    type ForumSignalEventInput,
} from '../../../services/merltService';
import { subscribeMerltEvents, MERLT_EVENT_TYPES } from '../merltEventBus';
import { useConsent } from '../consent/useConsent';

/**
 * Hook (MERLT-1.10): subscribes to merltEventBus and forwards forum
 * community signals (like, download, suggestion accept/decline) to
 * /api/merlt/events/forum-signal.
 *
 * `target_author_id` attribution policy (per docs/merlt-forum-authoring-decision.md):
 *   - like / download   → originalAuthorId of the SharedEnvironment
 *   - suggestion_*      → originalAuthorId of the SuggestionItem
 *                         (which preserves the chain via sourceSuggestionId
 *                         and originalAuthorId — gotcha #21 of CLAUDE.md)
 * Both arrive via metadata.original_author_id from the call-site.
 *
 * Mounted in the `global` plugin slot (Layout-level) so it works
 * outside of any article view. Fire-and-forget.
 */

interface Metadata {
    shared_env_id?: string;
    suggestion_id?: string;
    original_author_id?: string | null;
    [k: string]: unknown;
}

const FORUM_EVENT_TO_ACTION: Record<string, ForumSignalEventInput['action']> = {
    [MERLT_EVENT_TYPES.forumLike]: 'like',
    [MERLT_EVENT_TYPES.forumDownload]: 'download',
    [MERLT_EVENT_TYPES.forumSuggestionAccepted]: 'suggestion_accepted',
    [MERLT_EVENT_TYPES.forumSuggestionDeclined]: 'suggestion_declined',
};

export function useForumSignalTracker(disabled = false): void {
    const { canTrack } = useConsent();
    const canTrackRef = useRef(canTrack);
    useEffect(() => {
        canTrackRef.current = canTrack;
    }, [canTrack]);

    useEffect(() => {
        if (disabled) return;

        const unsubscribe = subscribeMerltEvents((event) => {
            if (!canTrackRef.current) return;

            const action = FORUM_EVENT_TO_ACTION[event.interaction_type];
            if (!action) return;

            const meta = (event.metadata ?? {}) as Metadata;
            const sharedEnvId = meta.shared_env_id ?? meta.suggestion_id;
            if (typeof sharedEnvId !== 'string') return;

            const payload: ForumSignalEventInput = {
                action,
                sharedEnvId,
                originalAuthorId:
                    typeof meta.original_author_id === 'string'
                        ? meta.original_author_id
                        : null,
            };

            void sendForumSignalEvent(payload).catch((err) => {
                console.warn('[merlt] forum-signal emit failed:', err);
            });
        });

        return unsubscribe;
    }, [disabled]);
}
