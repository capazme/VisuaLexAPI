import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import type { DecisionIdentity } from '../../../types/decisions';
import { decisionKey } from '../../../utils/decisionLinks';
import { UnmatchedAnchors } from './UnmatchedAnchors';

/**
 * A decision found without its text still holds the reader's notes and highlights: every one is
 * listed under the notice, none dropped (spec §8.4). Free notes are listed too, as no panel is
 * drawn for them here.
 */
export function DecisionAnchorsWithoutText({ identity }: { identity: DecisionIdentity }) {
  const key = decisionKey(identity);
  const { annotations, highlights, removeAnnotation, removeHighlight, loadAnnotationsForArticle, loadHighlightsForArticle } =
    useAppStore(useShallow((s) => ({
      annotations: s.annotations,
      highlights: s.highlights,
      removeAnnotation: s.removeAnnotation,
      removeHighlight: s.removeHighlight,
      loadAnnotationsForArticle: s.loadAnnotationsForArticle,
      loadHighlightsForArticle: s.loadHighlightsForArticle,
    })));
  useEffect(() => {
    loadHighlightsForArticle(key, '');
    loadAnnotationsForArticle(key, '');
  }, [key, loadHighlightsForArticle, loadAnnotationsForArticle]);
  const notes = useMemo(() => annotations.filter((a) => a.normaKey === key && a.articleId === ''), [annotations, key]);
  const marks = useMemo(() => highlights.filter((h) => h.normaKey === key && h.articleId === ''), [highlights, key]);
  return (
    <UnmatchedAnchors
      highlights={marks}
      annotations={notes}
      reason="no_text"
      onRemoveHighlight={removeHighlight}
      onRemoveAnnotation={removeAnnotation}
    />
  );
}
