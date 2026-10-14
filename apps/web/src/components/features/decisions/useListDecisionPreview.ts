/**
 * What a list's row holds for its decision's preview (`DecisionPreviewDialog`): the preview's state,
 * the estremi it was opened from, and the toggle the estremi call on a click or Enter.
 */
import { useCallback, useRef } from 'react';
import type { DecisionReference } from '../../../types/decisions';
import { useDecisionPreview } from '../../../hooks/useDecisionPreview';

export function useListDecisionPreview() {
  const preview = useDecisionPreview();
  const anchorRef = useRef<HTMLElement | null>(null);
  const { isVisible, openPreview, hidePreview } = preview;

  const toggle = useCallback((element: HTMLElement, reference: DecisionReference, path: string) => {
    if (isVisible && anchorRef.current === element) {
      hidePreview();
      return;
    }
    anchorRef.current = element;
    openPreview(element, reference, path);
  }, [isVisible, openPreview, hidePreview]);

  return { preview, anchorRef, toggle };
}
