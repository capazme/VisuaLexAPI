import { trackMerltInteraction, type MerltInteractionEvent } from '../../services/merltService';
import { hasMerltConsent } from './merltConsent';

type MerltEventListener = (event: MerltInteractionEvent) => void;

const listeners = new Set<MerltEventListener>();

export const MERLT_EVENT_TYPES = {
    articleViewed: 'article_viewed',
    scroll: 'scroll',
    highlightCreated: 'highlight_create',
    textSelected: 'text_selection',
    citationDetected: 'citation_detected',
    searchPerformed: 'search_performed',
    resultClicked: 'first_result_click',
    bookmarkCreated: 'bookmark_add',
    bookmarkDeleted: 'bookmark_delete',
    dossierExportTraining: 'dossier_export_training',
    issueReported: 'issue_reported',
    issueVoted: 'issue_voted',
    issueViewed: 'issue_viewed',
} as const;

export function subscribeMerltEvents(listener: MerltEventListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function publishMerltEvent(event: MerltInteractionEvent): void {
    listeners.forEach(listener => listener(event));

    if (!hasMerltConsent()) return;

    void trackMerltInteraction(event).catch(error => {
        console.warn('MERLT interaction tracking failed', error);
    });
}
