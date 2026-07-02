import { useForumSignalTracker } from './tracking/useForumSignalTracker';
import { useHighlightAnnotationTracker } from './tracking/useHighlightAnnotationTracker';
import { useDossierBookmarkTracker } from './tracking/useDossierBookmarkTracker';
import { useCitationTracker } from './tracking/useCitationTracker';
import { ConsentBanner } from './consent/ConsentBanner';

/**
 * Global MERL-T slot mounted once in Layout via the `global` plugin slot.
 * Hosts trackers that must survive across page navigations and the non-blocking
 * first-run consent banner (Slice 2b), which needs a Layout-level mount so it
 * can appear regardless of the current route.
 *
 * All merltEventBus subscribers live here (Slice 3 §3.9): a single mount
 * guarantees exactly one BFF POST per bus event. They were previously in
 * `ArticleMerltSlot` (per article card), which duplicated events ×N open
 * cards and dropped events emitted outside any article view (e.g. a
 * dossier-add from the dossier page). Only `useArticleViewedTracker`
 * stays article-scoped — it observes the article DOM element directly.
 */
export function GlobalMerltSlot() {
    useForumSignalTracker();

    // MERLT-1.7: highlight/annotation events → /events/highlight-annotation.
    useHighlightAnnotationTracker();

    // MERLT-1.8: dossier-add + bookmark-add events → /events/dossier-bookmark.
    useDossierBookmarkTracker();

    // MERLT-1.9: citation:clicked events → /events/citation-clicked.
    useCitationTracker();

    return <ConsentBanner />;
}
