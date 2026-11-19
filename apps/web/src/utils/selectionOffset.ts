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
  if (!root.contains(node) || inReaderSlot(node)) return -1;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return rangeText(range).length;
}

/**
 * A space open in the text, under a block (`BlockSpace`, L-73): its element carries this attribute. It is not text of
 * the article, so the offsets, the find and the copy pass over it.
 */
export const READER_SLOT_ATTR = 'data-reader-slot';
const SLOT = `[${READER_SLOT_ATTR}]`;

/** Whether `node` is inside a space open in the text. */
export function inReaderSlot(node: Node): boolean {
  return Boolean((node instanceof Element ? node : node.parentElement)?.closest(SLOT));
}

/** `range.toString()` without the text of a space open in it (the plain range, untouched, when there is none). */
function rangeText(range: Range): string {
  const common = range.commonAncestorContainer;
  if (!(common instanceof Element) || !common.querySelector(SLOT)) return range.toString();
  const fragment = range.cloneContents();
  fragment.querySelectorAll(SLOT).forEach((slot) => slot.remove());
  return fragment.textContent ?? '';
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
  return getRangeAnchor(root, selection.getRangeAt(0));
}

/** `getSelectionAnchor` for a range: the highlighter's, once widened to whole words (`inkSelection.ts`). */
export function getRangeAnchor(root: HTMLElement, range: Range): { text: string; startOffset: number } | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  // Words selected in a space open in the text (a note's card) are not the article's.
  if (inReaderSlot(range.startContainer) || inReaderSlot(range.endContainer)) return null;
  const rawOffset = plainOffsetAt(root, range.startContainer, range.startOffset);
  if (rawOffset < 0) return null;
  const aligned = alignOffsetToTrimmedText(rangeText(range), rawOffset);
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

/**
 * The DOM range of a span of plain-text offsets inside `root`: the inverse of `plainOffsetAt`, over the same text nodes
 * (a `<br />` or a block boundary counts zero). Null when the span does not fit the text. It selects a stored anchor in
 * the text, so that the user can move its boundaries from there (D7b).
 */
export function rangeFromPlainOffsets(root: Node, start: number, end: number): Range | null {
  if (start < 0 || end <= start) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT
      : (n as Element).hasAttribute(READER_SLOT_ATTR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP,
  });
  let seen = 0;
  let from: { node: Node; offset: number } | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!from && start < seen + length) from = { node, offset: start - seen };
    if (from && end <= seen + length) {
      const range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(node, end - seen);
      return range;
    }
    seen += length;
  }
  return null;
}
