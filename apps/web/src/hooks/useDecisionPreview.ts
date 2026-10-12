/**
 * The hover preview of a decision a text cites (design 2026-10-13 D5): after `PREVIEW_DELAY_MS` on the
 * link, the decision's answer from the session's cache (`fetchDecisionCached`: one request per decision
 * per session). Nothing is asked on render or on a hover that ends first.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DecisionReference, FetchDecisionAnswer } from '../types/decisions';
import { fetchDecisionCached } from '../utils/decisionFetchCache';
import { calculatePreviewPosition } from './useCitationPreview';

export const PREVIEW_DELAY_MS = 400;

export interface DecisionPreviewState {
  isVisible: boolean;
  isLoading: boolean;
  error: string | null;
  reference: DecisionReference | null;
  answer: FetchDecisionAnswer | null;
  position: { top: number; left: number };
}

const HIDDEN: DecisionPreviewState = {
  isVisible: false,
  isLoading: false,
  error: null,
  reference: null,
  answer: null,
  position: { top: 0, left: 0 },
};

export function useDecisionPreview() {
  const [state, setState] = useState<DecisionPreviewState>(HIDDEN);
  const timer = useRef<number | null>(null);
  const currentPath = useRef<string | null>(null);

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const showPreview = useCallback((element: HTMLElement, reference: DecisionReference, path: string) => {
    // moving between the segments of one citation, or back onto it, is not a new hover
    if (currentPath.current === path) return;
    currentPath.current = path;
    clearTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setState({ isVisible: true, isLoading: true, error: null, reference, answer: null, position: calculatePreviewPosition(element) });
      fetchDecisionCached(reference).then(
        (answer) => {
          if (currentPath.current !== path) return;
          setState((prev) => ({ ...prev, isLoading: false, answer }));
        },
        () => {
          if (currentPath.current !== path) return;
          setState((prev) => ({ ...prev, isLoading: false, error: 'Impossibile leggere la decisione' }));
        },
      );
    }, PREVIEW_DELAY_MS);
  }, []);

  /** The pointer left before the delay: nothing was shown, so nothing is asked. A shown preview stays (the pointer may be on its way to it). */
  const cancelPending = useCallback(() => {
    if (timer.current === null) return;
    clearTimer();
    currentPath.current = null;
  }, []);

  const hidePreview = useCallback(() => {
    clearTimer();
    currentPath.current = null;
    setState(HIDDEN);
  }, []);

  useEffect(() => clearTimer, []);

  return { ...state, showPreview, hidePreview, cancelPending };
}
