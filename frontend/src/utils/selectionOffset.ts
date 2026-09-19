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

/**
 * Keep the stored text and the stored offset describing the same span.
 *
 * `Selection.toString()` is trimmed before it is saved, but the offset comes
 * from the untrimmed range start. A selection that begins on whitespace
 * therefore stores an offset to the left of its own text, and the equality
 * gate in useArticleMarkers drops the marker on the first render — against
 * text that never changed.
 */
export function alignOffsetToTrimmedText(
  raw: string,
  rawOffset: number
): { text: string; startOffset: number } {
  // Count only the leading whitespace that EXISTS in the offset space.
  // `getPlainTextOffset` walks textContent, where a line break is a <br />
  // element contributing zero characters, and `useArticleMarkers.plainToRaw`
  // advances past '\n' without advancing the plain index. But
  // `Selection.toString()` returns rendered text and emits '\n' for each <br>,
  // so a selection dragged from a line boundary starts with newlines that must
  // not shift the offset — counting them would push the anchor off its own text
  // and the equality gate would drop the marker, which is the very failure this
  // helper exists to prevent.
  const leadingRun = raw.slice(0, raw.length - raw.trimStart().length);
  const visibleLeading = leadingRun.replace(/[\n\r]/g, '').length;
  return { text: raw.trim(), startOffset: rawOffset + visibleLeading };
}
