import { useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { DecisionReference } from '../types/decisions';
import type { ReadingBackEntry } from '../utils/readingBackStack';
import type { DecisionLinksOptions } from './useCitationLinks';
import { useDecisionPreview } from './useDecisionPreview';

/**
 * What a reading surface needs for the decisions its text cites: `links` for `useCitationLinks`
 * (`decisions`) and `popupProps` for `DecisionPreviewPopup`. A click or the popup's button records the
 * way back from `origin`, then opens the decision beside `besideId` (the practice, window or phone
 * reader the text is read in: `openDecision`'s `fromLink` rule, the asker never replaced).
 */
export function useDecisionLinks({ besideId, origin }: { besideId?: string; origin?: ReadingBackEntry }) {
  const openDecision = useAppStore((s) => s.openDecision);
  const pushReadingBack = useAppStore((s) => s.pushReadingBack);
  const preview = useDecisionPreview();
  const { showPreview, hidePreview, cancelPending } = preview;
  const isHoveringPopupRef = useRef(false);

  const onOpen = useCallback(
    (reference: DecisionReference) => { openDecision(reference, { fromLink: true, besideId }); },
    [openDecision, besideId],
  );

  const links = useMemo<DecisionLinksOptions>(
    () => ({ onOpen, showPreview, hidePreview, cancelPending, isHoveringPopupRef }),
    [onOpen, showPreview, hidePreview, cancelPending],
  );

  const popupProps = {
    isVisible: preview.isVisible,
    isLoading: preview.isLoading,
    error: preview.error,
    reference: preview.reference,
    answer: preview.answer,
    position: preview.position,
    onClose: hidePreview,
    // the popup's own button is a jump like a click: the way back is recorded the same
    onOpenDecision: (reference: DecisionReference) => {
      if (origin) pushReadingBack(origin);
      onOpen(reference);
    },
    onMouseEnter: () => { isHoveringPopupRef.current = true; },
    onMouseLeave: () => {
      isHoveringPopupRef.current = false;
      hidePreview();
    },
  };

  return { links, popupProps };
}
