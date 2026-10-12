import { useEffect, useRef, type RefObject } from 'react';
import { useAppStore } from '../store/useAppStore';
import { deserializeCitation, isSameCitationTarget, type ParsedCitationData } from '../utils/citationMatcher';
import { decisionReferenceOfPath, isSameDecisionTarget } from '../utils/decisionCitationMatcher';
import type { DecisionReference } from '../types/decisions';
import type { ReadingBackEntry } from '../utils/readingBackStack';

/** What the `.decision-cite` spans (`wrapDecisionCitationsInHtml`) do: the decision opens beside the text, hover shows its preview. */
export interface DecisionLinksOptions {
  onOpen: (reference: DecisionReference) => void;
  showPreview: (element: HTMLElement, reference: DecisionReference, path: string) => void;
  hidePreview: () => void;
  /** The pointer left before the preview showed: the pending one is dropped at once. */
  cancelPending: () => void;
  /** True while the pointer is on the preview popup: leaving the citation then keeps it open. */
  isHoveringPopupRef: RefObject<boolean>;
}

export interface CitationLinksOptions {
  /** What a click on a citation does (a same-act jump, a search...). No handler, no click action. */
  onOpen?: (parsed: ParsedCitationData) => void;
  /** Where the reader stands: recorded on the way-back stack before `onOpen` runs. */
  origin?: ReadingBackEntry;
  /** The norm preview: a surface that links only decisions leaves these three out. */
  showPreview?: (element: HTMLElement, parsed: ParsedCitationData, cacheKey: string) => void;
  hidePreview?: () => void;
  /** True while the pointer is on the preview popup: leaving the citation then keeps it open. */
  isHoveringPopupRef?: RefObject<boolean>;
  /** The decision links; none, and the spans do nothing. */
  decisions?: DecisionLinksOptions;
}

/**
 * The click and hover behaviour of the `.citation-hover` spans `wrapCitationsInHtml` leaves in a
 * reading surface: hover shows the preview, a click records the way back and opens the cited norm.
 * The `.decision-cite` spans (`wrapDecisionCitationsInHtml`) behave alike, towards the decision: the
 * two kinds never nest (D6), and the nearest of the two to the pointer is the one that answers.
 * The listeners sit on `containerRef`'s element and follow it: they are attached when the element
 * appears and again if it changes (a text that becomes visible later). The options are read when an
 * event fires, so a new `onOpen` or `origin` never re-attaches them.
 */
export function useCitationLinks(containerRef: RefObject<HTMLElement | null>, options: CitationLinksOptions): void {
  const pushReadingBack = useAppStore((s) => s.pushReadingBack);
  const latest = useRef(options);
  const attached = useRef<{ element: HTMLElement; detach: () => void } | null>(null);
  // after each render, never during it
  useEffect(() => { latest.current = options; });

  // After every render: cheap, and the only way to notice an element that appeared since.
  useEffect(() => {
    const container = containerRef.current;
    if (attached.current?.element === container) return;
    attached.current?.detach();
    attached.current = null;
    if (!container) return;

    const handleClick = (event: Event) => {
      const linked = (event.target as HTMLElement).closest('.citation-hover, .decision-cite');
      if (linked?.classList.contains('decision-cite')) return clickDecision(linked);
      const citationElement = linked;
      const citationData = citationElement?.getAttribute('data-citation');
      if (!citationData) return;
      const parsed = deserializeCitation(citationData);
      const { onOpen, origin, hidePreview } = latest.current;
      if (!parsed || !onOpen) return;
      // Record where we are leaving from BEFORE jumping: one push covers every kind of jump.
      if (origin) pushReadingBack(origin);
      onOpen(parsed);
      hidePreview?.();
    };

    const clickDecision = (element: Element) => {
      const reference = decisionReferenceOfPath(element.getAttribute('data-decision-path') ?? '');
      const { decisions, origin } = latest.current;
      if (!reference || !decisions) return;
      // The way back first, as for a norm: one push covers every kind of jump.
      if (origin) pushReadingBack(origin);
      decisions.onOpen(reference);
      decisions.hidePreview();
    };

    // The hide a leave scheduled: coming back to a citation before it fires keeps the preview.
    let decisionHide: ReturnType<typeof setTimeout> | undefined;

    const hoverDecision = (element: HTMLElement) => {
      clearTimeout(decisionHide);
      const path = element.getAttribute('data-decision-path') ?? '';
      const reference = decisionReferenceOfPath(path);
      if (reference) latest.current.decisions?.showPreview(element, reference, path);
    };

    const leaveDecision = (element: Element, to: EventTarget | null) => {
      if (isSameDecisionTarget(element, to)) return;
      latest.current.decisions?.cancelPending();
      clearTimeout(decisionHide);
      decisionHide = setTimeout(() => {
        const decisions = latest.current.decisions;
        if (decisions && !decisions.isHoveringPopupRef.current) decisions.hidePreview();
      }, 100);
    };

    const handleMouseEnter = (event: Event) => {
      const linked = (event.target as HTMLElement).closest('.citation-hover, .decision-cite') as HTMLElement | null;
      if (linked?.classList.contains('decision-cite')) return hoverDecision(linked);
      const citationElement = linked;
      if (!citationElement) return;
      const citationData = citationElement.getAttribute('data-citation');
      const cacheKey = citationElement.getAttribute('data-cache-key');
      if (!citationData || !cacheKey) return;
      const parsed = deserializeCitation(citationData);
      if (parsed) latest.current.showPreview?.(citationElement, parsed, cacheKey);
    };

    const handleMouseLeave = (event: Event) => {
      const linked = (event.target as HTMLElement).closest('.citation-hover, .decision-cite');
      if (linked?.classList.contains('decision-cite')) return leaveDecision(linked, (event as MouseEvent).relatedTarget);
      const citationElement = linked;
      if (!citationElement) return;
      // A citation wrapped per segment is several spans sharing one cache key: crossing from one
      // to the next is not leaving it.
      if (isSameCitationTarget(citationElement, (event as MouseEvent).relatedTarget)) return;
      // Delay hide to allow moving to the popup
      setTimeout(() => {
        if (!latest.current.isHoveringPopupRef?.current) latest.current.hidePreview?.();
      }, 100);
    };

    container.addEventListener('click', handleClick);
    container.addEventListener('mouseenter', handleMouseEnter, true);
    container.addEventListener('mouseleave', handleMouseLeave, true);
    attached.current = {
      element: container,
      detach: () => {
        container.removeEventListener('click', handleClick);
        container.removeEventListener('mouseenter', handleMouseEnter, true);
        container.removeEventListener('mouseleave', handleMouseLeave, true);
        clearTimeout(decisionHide);
      },
    };
  });

  useEffect(() => () => {
    attached.current?.detach();
    attached.current = null;
  }, []);
}
