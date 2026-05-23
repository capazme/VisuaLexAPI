import { useEffect } from 'react';
import {
    sendDossierBookmarkEvent,
    type DossierBookmarkEventInput,
} from '../../../services/merltService';
import { subscribeMerltEvents, MERLT_EVENT_TYPES } from '../merltEventBus';
import { hasMerltConsent } from '../merltConsent';

/**
 * Hook (MERLT-1.8): subscribes to the merltEventBus and forwards
 * bookmark / dossier-add events to /api/merlt/events/dossier-bookmark.
 *
 * Sources of `bookmark_add` (legacy event):
 *   - useAppStore.addBookmark (real bookmark add)
 *   - ArticleTabContent handleToggleQuickNorm (quick norm pin — also
 *     treated as a "save for use" signal upstream)
 * Source of `dossier_item_add` (new event in MERLT-1.8):
 *   - useAppStore.addToDossier when type==='norma' and URN is present
 *
 * Fire-and-forget; errors logged.
 */

interface Metadata {
    article_urn?: string;
    dossier_id?: string;
    tags?: string[];
    [k: string]: unknown;
}

export function useDossierBookmarkTracker(disabled = false): void {
    useEffect(() => {
        if (disabled) return;

        const unsubscribe = subscribeMerltEvents((event) => {
            if (!hasMerltConsent()) return;
            if (!event.article_urn) return;

            const meta = (event.metadata ?? {}) as Metadata;
            let payload: DossierBookmarkEventInput | null = null;

            if (event.interaction_type === MERLT_EVENT_TYPES.bookmarkCreated) {
                payload = {
                    kind: 'bookmark',
                    articleUrn: event.article_urn,
                    tags: Array.isArray(meta.tags) ? meta.tags : undefined,
                };
            } else if (event.interaction_type === MERLT_EVENT_TYPES.dossierItemAdded) {
                payload = {
                    kind: 'dossier',
                    articleUrn: event.article_urn,
                    dossierId: typeof meta.dossier_id === 'string' ? meta.dossier_id : undefined,
                    tags: Array.isArray(meta.tags) ? meta.tags : undefined,
                };
            }

            if (!payload) return;

            void sendDossierBookmarkEvent(payload).catch((err) => {
                // eslint-disable-next-line no-console
                console.warn('[merlt] dossier-bookmark emit failed:', err);
            });
        });

        return unsubscribe;
    }, [disabled]);
}
