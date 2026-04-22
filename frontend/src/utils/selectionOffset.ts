/**
 * Returns the character offset of the given DOM position inside the
 * container's textContent — i.e. the offset in the *plain text* of the
 * article (no HTML tags, no line breaks, since <br /> contributes 0 chars).
 *
 * Returns -1 if the target node is not inside the container.
 *
 * This is used to pin a highlight to a specific occurrence: the renderer
 * looks up the same plain-text offset and wraps only that match, instead
 * of replacing every copy of the selected string.
 */
export function getPlainTextOffset(
  container: HTMLElement,
  targetNode: Node,
  targetOffset: number
): number {
  if (!container.contains(targetNode)) return -1;

  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  let node: Node | null;

  while ((node = walker.nextNode())) {
    if (node === targetNode) {
      return offset + targetOffset;
    }
    offset += (node.textContent ?? '').length;
  }

  return -1;
}

/**
 * Convenience: returns the plain-text offset of the current Selection's start
 * inside the container. Returns -1 if the selection is absent or outside.
 */
export function getSelectionPlainOffset(
  container: HTMLElement | null,
  selection: Selection | null
): number {
  if (!container || !selection || selection.rangeCount === 0) return -1;
  const range = selection.getRangeAt(0);
  return getPlainTextOffset(container, range.startContainer, range.startOffset);
}
