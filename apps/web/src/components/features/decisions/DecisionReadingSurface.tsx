import { useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useCitationPreview } from '../../../hooks/useCitationPreview';
import { useCitationLinks } from '../../../hooks/useCitationLinks';
import { CitationPreviewPopup } from '../../ui/CitationPreviewPopup';
import { ArticleBody } from '../search/ArticleBody';
import type { Annotation, Highlight } from '../../../types';
import type { DecisionAttributes, DecisionIdentity, DecisionText } from '../../../types/decisions';
import { wrapCitationsInHtml, type ParsedCitationData } from '../../../utils/citationMatcher';
import { decisionKey, formatDecisionShort } from '../../../utils/decisionLinks';
import { renderDecisionHtml } from '../../../utils/decisionRender';
import { selectionAsRead } from '../../../utils/decisionText';
import type { ReadingBackEntry } from '../../../utils/readingBackStack';

// Stable empties until the reader's marks arrive (a fresh array would render the text again).
const NO_HIGHLIGHTS: Highlight[] = [];
const NO_ANNOTATIONS: Annotation[] = [];
const NOOP = () => {};

export interface DecisionReadingSurfaceProps {
  identity: DecisionIdentity;
  testo: DecisionText;
  attributi: DecisionAttributes;
  /**
   * The workspace tab this decision is read in. With it, a norm opened from a citation is placed
   * beside that tab and the way back names it; without it (a host with no tab, such as a light
   * window) the norm opens through the ordinary search and nothing is recorded.
   */
  hostTabId?: string;
}

/**
 * A decision's text on the reading surface: the same structured rendering as an article's
 * (`renderDecisionHtml` inside `ArticleBody`), with the norms it cites as links that open beside
 * it. Self-contained: it takes the decision as props and reaches only the store's search and
 * way-back actions, so any host can mount it.
 */
export function DecisionReadingSurface({ identity, testo, attributi, hostTabId }: DecisionReadingSurfaceProps) {
  const triggerSearch = useAppStore((s) => s.triggerSearch);
  const pushReadingBack = useAppStore((s) => s.pushReadingBack);
  const contentRef = useRef<HTMLDivElement>(null);
  const isHoveringPopupRef = useRef(false);
  const preview = useCitationPreview();
  const { showPreview, hidePreview } = preview;

  // A bare «art. 5» with no act named stays text: a decision has no act of its own to default to.
  const html = useMemo(
    () => wrapCitationsInHtml(renderDecisionHtml({ testo, highlights: NO_HIGHLIGHTS, annotations: NO_ANNOTATIONS })),
    [testo],
  );

  const sezione = attributi.sezione;
  const origin = useMemo<ReadingBackEntry | undefined>(
    () => hostTabId
      ? { tabId: hostTabId, blockId: hostTabId, articleId: '', label: formatDecisionShort({ ...identity, sezione }) }
      : undefined,
    [hostTabId, identity, sezione],
  );

  const openCitation = useCallback((citation: ParsedCitationData) => {
    triggerSearch({
      act_type: citation.act_type,
      act_number: citation.act_number || '',
      date: citation.date || '',
      article: citation.article,
      version: 'vigente',
      show_brocardi_info: true,
      ...(hostTabId ? { besideTabId: hostTabId } : {}),
    });
  }, [triggerSearch, hostTabId]);

  useCitationLinks(contentRef, { onOpen: openCitation, origin, showPreview, hidePreview, isHoveringPopupRef });

  // The selection popup's "Copia" reads the selection as the text reads (no «ordinanzadel»).
  // Only "Copia" is offered for now: notes and highlights on decisions come with the marks.
  const copySelection = useCallback(async (shown: string) => {
    const root = contentRef.current;
    const text = (root && selectionAsRead(root)) || shown;
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('copying the selection failed', error);
    }
  }, []);

  return (
    <div
      onCopy={(event) => {
        const text = contentRef.current && selectionAsRead(contentRef.current);
        if (!text) return;
        event.clipboardData.setData('text/plain', text);
        event.preventDefault();
      }}
    >
      <ArticleBody
        contentRef={contentRef}
        itemKey={decisionKey(identity)}
        processedContent={html}
        className="vlx-art vlx-decision"
        copyOnly
        onPopupHighlight={NOOP}
        onPopupAddNote={NOOP}
        onPopupCopy={copySelection}
      />
      <CitationPreviewPopup
        isVisible={preview.isVisible}
        isLoading={preview.isLoading}
        error={preview.error}
        citation={preview.citation}
        article={preview.article}
        position={preview.position}
        onClose={hidePreview}
        onOpenInTab={(citation) => {
          // the popup's own button is a jump like a click: the way back is recorded the same
          if (origin) pushReadingBack(origin);
          openCitation(citation);
        }}
        onMouseEnter={() => { isHoveringPopupRef.current = true; }}
        onMouseLeave={() => {
          isHoveringPopupRef.current = false;
          hidePreview();
        }}
      />
    </div>
  );
}
