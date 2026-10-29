import { useCallback, useEffect, useId, useState, type RefObject } from 'react';
import type { GlossAnchor } from '../utils/articleAnnotations';
import { resolveGlosses } from '../utils/articleAnnotations';
import { rangeFromPlainOffsets } from '../utils/selectionOffset';
import { clearGlossPassage, showGlossPassage } from '../utils/glossPassage';

/**
 * The gloss whose words the reader shows (D8): a card hovered or focused, beside the text or in the sign's popover.
 * Its passage is painted by the CSS Custom Highlight API over the reader's text root (`utils/glossPassage.ts`), so no
 * element is added to the text (root rule 23); a redraw of the text (`contentKey`) paints it again on the new nodes.
 * `plain` is the projection the anchors count in.
 */
export function useGlossPassage(
  textRootRef: RefObject<HTMLElement | null>,
  plain: string,
  anchors: readonly GlossAnchor[],
  contentKey: string,
) {
  const owner = useId();
  const [shownId, setShownId] = useState<string | null>(null);
  const show = useCallback((id: string | null) => setShownId(id), []);
  const hide = useCallback((id: string) => setShownId((current) => (current === id ? null : current)), []);

  useEffect(() => {
    const root = textRootRef.current;
    const landed = shownId ? resolveGlosses(plain, anchors.filter((a) => a.id === shownId))[0] : undefined;
    const range = root && landed ? rangeFromPlainOffsets(root, landed.start, landed.end) : null;
    if (range) showGlossPassage(owner, range);
    else clearGlossPassage(owner);
  }, [owner, textRootRef, plain, anchors, shownId, contentKey]);
  useEffect(() => () => clearGlossPassage(owner), [owner]);

  return { shownId, show, hide };
}
