/**
 * Find in the text: a pure matcher that ignores case and accents, and the
 * helpers that map its offsets back onto the displayed text nodes. Nothing
 * here touches the DOM it reads (root rule 23) and nothing here is React.
 */

const APOSTROPHES = new Set(['’', '‘', 'ʼ']);
const UNICODE_SPACE = /^\p{Zs}$/u;
const COMBINING_MARKS = /\p{M}/gu;

/** One output unit per input unit, so offsets in the folded text are the original's. */
function foldUnit(unit: string): string {
  if (APOSTROPHES.has(unit)) return "'";
  if (UNICODE_SPACE.test(unit)) return ' ';
  const stripped = unit.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
  if (stripped.length === 1) return stripped;
  const lower = unit.toLowerCase();
  return lower.length === 1 ? lower : unit;
}

/**
 * Fold a text for searching: per UTF-16 unit, decompose (NFD), drop the
 * combining marks, lower-case; keep the result only when it is still one unit
 * («ß», «İ» and astral halves stay as they are). Typographic apostrophes read
 * as «'», Unicode spaces as a space. `foldForSearch(x).length === x.length`.
 */
export function foldForSearch(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) out += foldUnit(text[i]);
  return out;
}

export interface FindResult {
  matches: [number, number][];
  truncated: boolean;
}

const MIN_QUERY_LENGTH = 2;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every match of `query` in `text`, as `[start, end)` offsets of the original
 * text. The query is folded and trimmed; under two characters nothing matches;
 * a run of whitespace in the query matches any run in the text. Past `limit`
 * matches the rest are not collected and `truncated` is set.
 */
export function findMatches(
  text: string,
  query: string,
  { limit = 1000 }: { limit?: number } = {},
): FindResult {
  const folded = foldForSearch(query).trim();
  if (folded.length < MIN_QUERY_LENGTH) return { matches: [], truncated: false };

  const pattern = folded.split(/\s+/).map(escapeRegExp).join('\\s+');
  const re = new RegExp(pattern, 'g');
  const haystack = foldForSearch(text);

  const matches: [number, number][] = [];
  let truncated = false;
  for (const m of haystack.matchAll(re)) {
    if (matches.length >= limit) {
      truncated = true;
      break;
    }
    const start = m.index ?? 0;
    matches.push([start, start + m[0].length]);
  }
  return { matches, truncated };
}

export interface TextSegment {
  node: Text;
  /** Offset of the node's first character in the concatenated text. */
  start: number;
}

function isHidden(node: Node, root: Node): boolean {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (getComputedStyle(el).display === 'none') return true;
    if (el === root) break;
  }
  return false;
}

/**
 * The displayed text nodes under `root` in document order and their
 * concatenation. A node inside an element whose computed `display` is `none`
 * (up to the root) is skipped.
 */
export function collectSearchableText(root: Node): { nodes: TextSegment[]; text: string } {
  const nodes: TextSegment[] = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (isHidden(n, root)) continue;
    const node = n as Text;
    nodes.push({ node, start: text.length });
    text += node.data;
  }
  return { nodes, text };
}

/** DOM ranges for matches, each spanning node boundaries as needed. */
export function rangesForMatches(nodes: TextSegment[], matches: [number, number][]): Range[] {
  const ranges: Range[] = [];
  for (const [start, end] of matches) {
    const first = nodes.find((s) => start < s.start + s.node.data.length);
    const last = nodes.find((s) => end <= s.start + s.node.data.length && end > s.start);
    if (!first || !last) continue;
    const range = document.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    ranges.push(range);
  }
  return ranges;
}
