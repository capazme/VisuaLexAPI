/**
 * Find in the text: a pure matcher that ignores case and accents, and the
 * helpers that map its offsets back onto the displayed text nodes. Nothing
 * here touches the DOM it reads (root rule 23) and nothing here is React.
 *
 * Callers own the lifetime of the ranges they draw: they must clear them
 * (`clearFindRanges`) on close, on unmount and whenever the text is redrawn,
 * or the registry keeps detached DOM alive.
 */

const APOSTROPHES = new Set(['’', '‘', 'ʼ', '´', '`']);
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
/** A soft hyphen or a zero-width space may sit anywhere inside a word of the text. */
const INVISIBLE = '[\\u00ad\\u200b]?';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The query, folded fully: NFD, combining marks dropped, lower-cased. Its own
 * offsets do not matter, so it need not keep the length.
 */
function foldQuery(query: string): string {
  let out = '';
  for (const ch of query.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase()) {
    if (APOSTROPHES.has(ch)) out += "'";
    else if (UNICODE_SPACE.test(ch)) out += ' ';
    else out += ch;
  }
  return out;
}

/** One word of the folded query as a pattern: every unit may carry marks and be split by an invisible character. */
function wordPattern(word: string): string {
  const units = [...word].map((u) => `${escapeRegExp(u)}\\p{M}*`);
  return units.join(INVISIBLE);
}

/**
 * Every match of `query` in `text`, as `[start, end)` offsets of the original
 * text. The query is folded and trimmed; under two characters (folded base
 * characters, that is code points) nothing matches; a run of whitespace in the
 * query matches any run in the text; a combining mark after a matched letter
 * is part of the match, and a soft hyphen or zero-width space between letters
 * is ignored. Ligatures (ﬁ, ﬂ) are not matched. Past `limit` matches the rest
 * are not collected and `truncated` is set.
 */
export function findMatches(
  text: string,
  query: string,
  { limit = 1000 }: { limit?: number } = {},
): FindResult {
  const folded = foldQuery(query).trim();
  if ([...folded].length < MIN_QUERY_LENGTH) return { matches: [], truncated: false };

  const pattern = folded.split(/\s+/).map(wordPattern).join('\\s+');
  const re = new RegExp(pattern, 'gu');
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

const BLOCK_TAGS = new Set([
  'DIV', 'P', 'LI', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
]);

/** Block-like: the tags above, the article's blocks (`vlx-b`) and the decision's lines. */
function isBlockLike(el: Element): boolean {
  return BLOCK_TAGS.has(el.tagName) || el.classList.contains('vlx-b') || el.classList.contains('vlx-dec-line');
}

/**
 * The displayed text nodes under `root` in document order, and the string to
 * search: their concatenation with one virtual space at every block boundary
 * between two collected text nodes, at a `<br>`, and wherever a hidden subtree
 * was skipped between them. A separator belongs to no node: each segment's
 * `start` is its offset in the returned string, a match never starts or ends
 * on a separator (the pattern begins and ends on a letter), and
 * `rangesForMatches` only ever lands inside a node. One walk over the subtree;
 * an element whose computed `display` is `none` is rejected with its subtree.
 */
export function collectSearchableText(root: Node): { nodes: TextSegment[]; text: string } {
  const nodes: TextSegment[] = [];
  let text = '';
  if (root instanceof Element && getComputedStyle(root).display === 'none') return { nodes, text };

  let separate = false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const el = n as Element;
      if (getComputedStyle(el).display === 'none') {
        separate = true;
        return NodeFilter.FILTER_REJECT;
      }
      if (el.tagName === 'BR') separate = true;
      return NodeFilter.FILTER_SKIP;
    },
  });

  const blockCache = new Map<Element, Element | null>();
  const blockOf = (el: Element | null): Element | null => {
    if (!el || el === root) return null;
    if (blockCache.has(el)) return blockCache.get(el) ?? null;
    const block = isBlockLike(el) ? el : blockOf(el.parentElement);
    blockCache.set(el, block);
    return block;
  };

  let previousBlock: Element | null = null;
  let any = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    if (node.data.length === 0) {
      nodes.push({ node, start: text.length });
      continue;
    }
    const block = blockOf(node.parentElement);
    if (any && (separate || block !== previousBlock)) text += ' ';
    nodes.push({ node, start: text.length });
    text += node.data;
    previousBlock = block;
    separate = false;
    any = true;
  }
  return { nodes, text };
}

/** DOM ranges for matches (sorted, as `findMatches` returns them), each spanning node boundaries as needed. */
export function rangesForMatches(nodes: TextSegment[], matches: [number, number][]): Range[] {
  const ranges: Range[] = [];
  let i = 0;
  let j = 0;
  for (const [start, end] of matches) {
    while (i < nodes.length && start >= nodes[i].start + nodes[i].node.data.length) i += 1;
    if (i >= nodes.length || start < nodes[i].start) continue;
    if (j < i) j = i;
    while (j < nodes.length && !(end <= nodes[j].start + nodes[j].node.data.length && end > nodes[j].start)) j += 1;
    if (j >= nodes.length) {
      j = i;
      continue;
    }
    const range = document.createRange();
    range.setStart(nodes[i].node, start - nodes[i].start);
    range.setEnd(nodes[j].node, end - nodes[j].start);
    ranges.push(range);
  }
  return ranges;
}
