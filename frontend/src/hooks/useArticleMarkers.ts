import { useEffect, useMemo, useState } from 'react';
import type { Annotation, Highlight } from '../types';
import type { ArticleStructure } from '../utils/articleStructure';
import { renderArticleHtml } from '../utils/articleRender';
import { getGlobalHighlight, subscribeToHighlight } from './useGlobalSearch';

interface UseArticleMarkersInput {
  rawText: string;
  highlights: Highlight[];
  annotations: Annotation[];
  /**
   * The parsed structure of `rawText` (`parseArticleStructure`, memoised by
   * the caller). Omitted or null renders flat — the Brocardi sections, which
   * have no commi to divide.
   */
  structure?: ArticleStructure | null;
  /** Whether the AGGIORNAMENTO tail is expanded. Structured rendering only. */
  updatesOpen?: boolean;
}

/**
 * The HTML of an article's text with the reader's highlights, anchored notes
 * and the global Cmd+F hits applied, ready for `SafeHTML`. The rendering
 * itself lives in `utils/articleRender.ts`; this hook adds the subscription
 * to the global search query, so every mounted body re-marks its hits as the
 * user types and the search panel can scroll to one by ordinal.
 *
 * All offsets are plain-text offsets (`article_text` without newlines).
 * Citation wrapping is not applied here — it is article-specific and belongs
 * to the consumer (ArticleTabContent).
 */
export function useArticleMarkers({
  rawText,
  highlights,
  annotations,
  structure = null,
  updatesOpen = false,
}: UseArticleMarkersInput): string {
  const [searchQuery, setSearchQuery] = useState<string | null>(() => getGlobalHighlight());
  useEffect(() => subscribeToHighlight(setSearchQuery), []);

  return useMemo(
    () => renderArticleHtml({ raw: rawText || '', structure, highlights, annotations, searchQuery, updatesOpen }),
    [rawText, structure, highlights, annotations, searchQuery, updatesOpen],
  );
}
