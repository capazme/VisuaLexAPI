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
 * Only the environment is sent: its author, or a suggestion's, is a third
 * party who never consented to MERL-T (docs/merlt/decisions/forum-authoring.md).
 *
 * Mounted in the `global` plugin slot (Layout-level) so it works
 * outside of any article view. Fire-and-forget.
 */

interface Metadata {
    shared_env_id?: string;
    suggestion_id?: string;
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
            // The signal is keyed to the shared environment. A suggestion id is
            // never a substitute: MERL-T could not join it with the like/download
            // signals on the same environment, so the event is dropped instead.
            const sharedEnvId = meta.shared_env_id;
            if (typeof sharedEnvId !== 'string') return;

            const payload: ForumSignalEventInput = { action, sharedEnvId };

            void sendForumSignalEvent(payload).catch((err) => {
                console.warn('[merlt] forum-signal emit failed:', err);
            });
        });

        return unsubscribe;
    }, [disabled]);
}
