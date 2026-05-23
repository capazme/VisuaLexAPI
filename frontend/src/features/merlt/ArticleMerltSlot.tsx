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
