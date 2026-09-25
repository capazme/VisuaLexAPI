export interface AnchorRect {
  x: number;
  y: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * The rectangle a block's annotation popover is placed against: from the
 * sign's left edge to the block's right edge (the sign's own, when it sits in
 * the margin), over the part of the block that is on screen. Beside it, below
 * it or above it, the popover never covers the passage it lists — whichever
 * way the CSS container query placed the sign, and after a resize too.
 *
 * Null when the sign has no box: hidden with the highlights, or gone in a
 * redraw. The caller keeps the last rectangle rather than jump to (0, 0).
 */
export function blockAnchorRect(sign: Element, viewportHeight: number): AnchorRect | null {
  const s = sign.getBoundingClientRect();
  if (s.width === 0 && s.height === 0) return null;
  const block = sign.parentElement?.getBoundingClientRect() ?? s;
  const left = s.left;
  const right = Math.max(s.right, block.right);
  const top = Math.min(Math.max(block.top, 0), viewportHeight);
  const bottom = Math.max(top, Math.min(block.bottom, viewportHeight));
  return { x: left, y: top, left, right, top, bottom, width: right - left, height: bottom - top };
}

const NO_RECT: AnchorRect = { x: 0, y: 0, left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };

/**
 * A floating-ui virtual reference for a block's popover. The sign is SafeHTML
 * markup, replaced by every redraw of the text, so it is looked up again on
 * each measurement; while it has no box, or is momentarily gone, the last
 * rectangle stands.
 */
export function signReference(findSign: () => Element | null, contextElement?: Element) {
  let last = NO_RECT;
  return {
    getBoundingClientRect: (): AnchorRect => {
      const sign = findSign();
      const rect = sign && blockAnchorRect(sign, window.innerHeight);
      if (rect) last = rect;
      return last;
    },
    contextElement,
  };
}
