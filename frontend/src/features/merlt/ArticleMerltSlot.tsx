import type { RefObject } from 'react';
import { useArticleViewedTracker } from './tracking/useArticleViewedTracker';

/**
 * MERL-T slot mounted in `article_content_after` (see plugins/registry).
 *
 * Slice 1 behaviour: side-effect only — no UI. Hosts the
 * `useArticleViewedTracker` hook so the host (`ArticleTabContent`) does
 * not import MERL-T directly. Toggling `VITE_FEATURE_MERLT=false` skips
 * the registry entry and this component is never mounted.
 *
 * This slot hosts ONLY the article-scoped tracker (dwell/scroll observer
 * on the article element). The bus-subscriber trackers (highlight,
 * dossier/bookmark, citation) live in `GlobalMerltSlot`: mounting them
 * here duplicated every event ×N with N article cards open, and missed
 * events emitted outside any article view (Slice 3 §3.9).
 *
 * The richer UI from commit 81be277 (Q&A panel, live enrichment, graph
 * preview, feedback buttons) called endpoints that no longer exist in
 * the new BFF surface. It has been removed and will be re-introduced
 * in Slice 3 (Q&A) and Slice 2 (graph) as separate slot entries.
 */
export interface ArticleMerltSlotProps {
    articleUrn: string | undefined;
    normaVisitataId?: string;
    containerRef: RefObject<HTMLElement | null>;
}

export function ArticleMerltSlot({
    articleUrn,
    normaVisitataId,
    containerRef,
}: ArticleMerltSlotProps) {
    useArticleViewedTracker({
        articleUrn,
        normaVisitataId,
        containerRef,
    });

    return null;
}
