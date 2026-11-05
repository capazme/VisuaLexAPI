import { collectSearchableText, isBlockLike, type TextSegment } from './findInText';
import { getRangeAnchor } from './selectionOffset';

/**
 * What the highlighter takes of a selection (A4, the owner's correction of 5 November 2026): as a word processor does,
 * a selection that cuts a word takes it whole, its start and end widened to the word's edges; with Alt held while the
 * words were selected, the piece exactly as selected. Every gesture alike: creating, taking away, recolouring, «Nessun
 * colore». Read from the DOM, never from the stored projection, where a block's last word and the next block's first
 * touch once the `\n` between them is gone: a word never runs past its block (`isBlockLike`) or a `<br>`.
 */

/** A letter, a digit, or a mark written on one: what a word is made of (no apostrophe: «l'» is a word of its own). */
const WORD = /[\p{L}\p{N}\p{M}]/u;
const isWord = (ch: string | undefined) => ch !== undefined && WORD.test(ch);

/** The block that holds a boundary point: its nearest block-like ancestor inside `root`, else `root`. */
function blockAround(root: Node, node: Node): Node {
  for (let el = node instanceof Element ? node : node.parentElement; el && el !== root && root.contains(el); el = el.parentElement) {
    if (isBlockLike(el)) return el;
  }
  return root;
}

/** Where a boundary point falls in the block's searchable text; null when it is not on a text drawn there. */
function positionOf(nodes: TextSegment[], length: number, container: Node, offset: number): number | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const segment = nodes.find((s) => s.node === container);
    return segment ? segment.start + Math.min(offset, segment.node.data.length) : null;
  }
  const point = document.createRange();
  point.setStart(container, offset);
  for (const segment of nodes) if (point.comparePoint(segment.node, 0) >= 0) return segment.start;
  return length;
}

/** The text node and offset at `position`: on a word's character for a start, just after one for an end. */
function pointAt(nodes: TextSegment[], position: number, edge: 'start' | 'end'): { node: Text; offset: number } | null {
  for (const { node, start } of nodes) {
    const inside = edge === 'start' ? position >= start && position < start + node.data.length : position > start && position <= start + node.data.length;
    if (inside) return { node, offset: position - start };
  }
  return null;
}

/** One edge of a range moved to its word's edge, when the range cuts the word there; null when it does not. */
function widenEdge(root: Node, container: Node, offset: number, edge: 'start' | 'end'): { node: Text; offset: number } | null {
  const { nodes, text } = collectSearchableText(blockAround(root, container));
  const at = positionOf(nodes, text.length, container, offset);
  if (at === null) return null;
  let to = at;
  if (edge === 'start') while (to > 0 && isWord(text[to - 1]) && isWord(text[to])) to -= 1;
  else while (to < text.length && isWord(text[to]) && isWord(text[to - 1])) to += 1;
  return to === at ? null : pointAt(nodes, to, edge);
}

/** `range` with each edge that cuts a word moved to the word's edge; the same range when it cuts none. */
export function wholeWordsRange(root: Node, range: Range): Range {
  const start = widenEdge(root, range.startContainer, range.startOffset, 'start');
  const end = widenEdge(root, range.endContainer, range.endOffset, 'end');
  if (!start && !end) return range;
  const widened = range.cloneRange();
  if (start) widened.setStart(start.node, start.offset);
  if (end) widened.setEnd(end.node, end.offset);
  return widened;
}

interface Ends {
  anchorNode: Node | null;
  anchorOffset: number;
  focusNode: Node | null;
  focusOffset: number;
}

const endsOf = (selection: Selection | null): Ends | null =>
  selection && selection.rangeCount > 0 && !selection.isCollapsed
    ? { anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset, focusNode: selection.focusNode, focusOffset: selection.focusOffset }
    : null;

const sameEnds = (a: Ends | null, b: Ends | null) =>
  !!a && !!b && a.anchorNode === b.anchorNode && a.anchorOffset === b.anchorOffset && a.focusNode === b.focusNode && a.focusOffset === b.focusOffset;

/** The selection a press with Alt held made, while it stands as made: taken exactly. */
let exactEnds: Ends | null = null;
/** The press going on: whether Alt was held at any moment of it, and the selection as it began. */
let press: { alt: boolean; before: Ends | null } | null = null;

if (typeof document !== 'undefined') {
  // In the capture phase, before any handler reads the selection. A press that leaves the selection as it found it (a
  // button pressed over it: the highlighter's, the selection bar's) changes nothing.
  document.addEventListener('pointerdown', (event) => {
    press = { alt: event.altKey, before: endsOf(document.getSelection()) };
  }, true);
  document.addEventListener('pointermove', (event) => {
    if (press && event.altKey) press.alt = true;
  }, true);
  document.addEventListener('pointerup', (event) => {
    if (!press) return;
    const after = endsOf(document.getSelection());
    if (!sameEnds(after, press.before)) exactEnds = press.alt || event.altKey ? after : null;
    press = null;
  }, true);
}

/** Whether `selection` was made with Alt held, and stands as it was made (a selection moved since is widened). */
export function isExactSelection(selection: Selection): boolean {
  return sameEnds(exactEnds, endsOf(selection));
}

/** `selection` taken exactly while it stands (a highlight's words selected from the keyboard, Enter on it in a lesson). */
export function keepExact(selection: Selection) {
  exactEnds = endsOf(selection);
}

/** The range the highlighter takes of a selection in `root`: whole words, or exactly as selected with Alt. */
export function inkRange(root: HTMLElement, selection: Selection): Range | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  return isExactSelection(selection) ? range : wholeWordsRange(root, range);
}

/** The highlighter's anchor for a selection: `getSelectionAnchor` over `inkRange`. Notes keep the selection as it is. */
export function getInkAnchor(root: HTMLElement | null, selection: Selection | null): { text: string; startOffset: number } | null {
  if (!root || !selection) return null;
  const range = inkRange(root, selection);
  return range ? getRangeAnchor(root, range) : null;
}
