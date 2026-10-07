import { useEffect, useRef, type RefObject } from 'react';
import { useAppStore } from '../store/useAppStore';
import { deserializeCitation, isSameCitationTarget, type ParsedCitationData } from '../utils/citationMatcher';
import type { ReadingBackEntry } from '../utils/readingBackStack';

export interface CitationLinksOptions {
  /** What a click on a citation does (a same-act jump, a search...). No handler, no click action. */
  onOpen?: (parsed: ParsedCitationData) => void;
  /** Where the reader stands: recorded on the way-back stack before `onOpen` runs. */
  origin?: ReadingBackEntry;
  showPreview: (element: HTMLElement, parsed: ParsedCitationData, cacheKey: string) => void;
  hidePreview: () => void;
  /** True while the pointer is on the preview popup: leaving the citation then keeps it open. */
  isHoveringPopupRef: RefObject<boolean>;
}

/**
 * The click and hover behaviour of the `.citation-hover` spans `wrapCitationsInHtml` leaves in a
 * reading surface: hover shows the preview, a click records the way back and opens the cited norm.
 * The listeners sit on `containerRef`'s element, attached once; the options are read when an event
 * fires, so a new `onOpen` or `origin` never re-attaches them.
 */
export function useCitationLinks(containerRef: RefObject<HTMLElement | null>, options: CitationLinksOptions): void {
  const pushReadingBack = useAppStore((s) => s.pushReadingBack);
  const latest = useRef(options);
  // after each render, never during it
  useEffect(() => { latest.current = options; });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (event: Event) => {
      const citationElement = (event.target as HTMLElement).closest('.citation-hover');
      const citationData = citationElement?.getAttribute('data-citation');
      if (!citationData) return;
      const parsed = deserializeCitation(citationData);
      const { onOpen, origin, hidePreview } = latest.current;
      if (!parsed || !onOpen) return;
      // Record where we are leaving from BEFORE jumping: one push covers every kind of jump.
      if (origin) pushReadingBack(origin);
      onOpen(parsed);
      hidePreview();
    };

    const handleMouseEnter = (event: Event) => {
      const citationElement = (event.target as HTMLElement).closest('.citation-hover') as HTMLElement | null;
      if (!citationElement) return;
      const citationData = citationElement.getAttribute('data-citation');
      const cacheKey = citationElement.getAttribute('data-cache-key');
      if (!citationData || !cacheKey) return;
      const parsed = deserializeCitation(citationData);
      if (parsed) latest.current.showPreview(citationElement, parsed, cacheKey);
    };

    const handleMouseLeave = (event: Event) => {
      const citationElement = (event.target as HTMLElement).closest('.citation-hover');
      if (!citationElement) return;
      // A citation wrapped per segment is several spans sharing one cache key: crossing from one
      // to the next is not leaving it.
      if (isSameCitationTarget(citationElement, (event as MouseEvent).relatedTarget)) return;
      // Delay hide to allow moving to the popup
      setTimeout(() => {
        if (!latest.current.isHoveringPopupRef.current) latest.current.hidePreview();
      }, 100);
    };

    container.addEventListener('click', handleClick);
    container.addEventListener('mouseenter', handleMouseEnter, true);
    container.addEventListener('mouseleave', handleMouseLeave, true);
    return () => {
      container.removeEventListener('click', handleClick);
      container.removeEventListener('mouseenter', handleMouseEnter, true);
      container.removeEventListener('mouseleave', handleMouseLeave, true);
    };
  }, [containerRef, pushReadingBack]);
}
