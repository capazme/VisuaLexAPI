/**
 * The plain-text offset of a DOM boundary point inside `root`: the length of
 * the text between the start of `root` and the point. Every text node counts,
 * a `<br />` or a block boundary counts zero — the same projection of
 * `article_text` (newlines removed) that stored anchors live in. Built on a
 * Range, so a boundary point on an element (a selection that starts at a
 * block edge) resolves as well as one inside a text node.
 *
 * Returns -1 when the point is outside `root`.
 */
export function plainOffsetAt(root: Node, node: Node, offset: number): number {
  if (!root.contains(node)) return -1;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

/**
 * The anchor a selection inside `root` gives a highlight or a note: its text
 * and plain-text start offset, both read from the DOM text itself.
 *
 * The text comes from `Range.toString()`, never `Selection.toString()`: the
 * latter is *rendered* text and writes a newline for every `<br />` and block
 * boundary, so a selection across two commi was stored as
 * "danno.\n\nLa risoluzione" while the text at its offset reads
 * "danno.  La risoluzione" — the highlight was saved and never drawn
 * (confirmed in Chromium, round A task 0). Leading and trailing whitespace is
 * trimmed, with the offset moved accordingly.
 */
export function getSelectionAnchor(
  root: HTMLElement | null,
  selection: Selection | null,
): { text: string; startOffset: number } | null {
  if (!root || !selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const rawOffset = plainOffsetAt(root, range.startContainer, range.startOffset);
  if (rawOffset < 0) return null;
  const aligned = alignOffsetToTrimmedText(range.toString(), rawOffset);
  return aligned.text ? aligned : null;
}

/**
 * Keep the stored text and the stored offset describing the same span.
 *
 * The selection text is trimmed before it is saved, but the offset comes from
 * the untrimmed range start. A selection that begins on whitespace would
 * store an offset to the left of its own text, and the renderer's equality
 * gate would drop the marker on the first render — against text that never
 * changed.
 */
export function alignOffsetToTrimmedText(
  raw: string,
  rawOffset: number
): { text: string; startOffset: number } {
  // Count only the leading whitespace that EXISTS in the offset space, where a
  // line break (a <br /> or a block edge) contributes zero characters. Text
  // read with Range.toString() has no newlines; a rendered selection string
  // does, and they must not shift the offset — counting them would push the
  // anchor off its own text and the equality gate would drop the marker.
  const leadingRun = raw.slice(0, raw.length - raw.trimStart().length);
  const visibleLeading = leadingRun.replace(/[\n\r]/g, '').length;
  return { text: raw.trim(), startOffset: rawOffset + visibleLeading };
}
