import { useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { DecisionReference } from '../types/decisions';
import type { DecisionLinksOptions } from './useCitationLinks';
import { useDecisionPreview } from './useDecisionPreview';

/**
 * What a reading surface needs for the decisions its text cites: `links` for `useCitationLinks`
 * (`decisions`) and `popupProps` for `DecisionPreviewPopup`, a pure tooltip (LC142). A click (its way back recorded by
 * `useCitationLinks`) opens the decision beside `besideId` (the practice, window or phone
 * reader the text is read in: `openDecision`'s `fromLink` rule, the asker never replaced). `onOpened` follows: a
 * surface off the search page (the dossier) goes there, where the decision is drawn.
 */
export function useDecisionLinks({ besideId, onOpened }: { besideId?: string; onOpened?: () => void }) {
  const openDecision = useAppStore((s) => s.openDecision);
  const preview = useDecisionPreview();
  const { showPreview, hidePreview, cancelPending } = preview;
  const isHoveringPopupRef = useRef(false);

  const onOpen = useCallback(
    (reference: DecisionReference) => {
      openDecision(reference, { fromLink: true, besideId });
      onOpened?.();
    },
    [openDecision, besideId, onOpened],
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
    onMouseEnter: () => { isHoveringPopupRef.current = true; },
    onMouseLeave: () => {
      isHoveringPopupRef.current = false;
      hidePreview();
    },
  };

  return { links, popupProps };
}
