import { useEffect, useState } from 'react';
import type { Annotation, Highlight } from '../../../types';
import { leftOutMessage, travellingAnchors } from '../../../utils/decisionAnchorsTravel';

/**
 * The «non incluse» line for what a dialog is about to send: notes and highlights on decisions
 * whose words are no longer in the decision's text (§8.6). Null while nothing is left out. The
 * dialog still filters at submit (`travellingAnchors`); this only shows it beforehand.
 * Callers pass memoised arrays.
 */
export function useLeftOutNotice(annotations: Annotation[], highlights: Highlight[]): string | null {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void travellingAnchors({ annotations, highlights }).then(({ leftOut }) => {
      if (current) setNotice(leftOutMessage(leftOut));
    });
    return () => { current = false; };
  }, [annotations, highlights]);
  return notice;
}
