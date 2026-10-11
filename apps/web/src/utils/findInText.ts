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
  // A final sigma is the same letter: «νομος» and «ΝΟΜΟΣ» (Σ → σ) read alike.
  if (unit === 'ς') return 'σ';
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
 * The query, folded the way the text is (unit by unit, so a Hangul syllable or
 * a final «Σ» folds on both sides alike), after composing it (NFC: a typed
 * «e» + U+0301 is «é»); then the marks the fold could not absorb are dropped,
 * and so are soft hyphens and zero-width spaces. Its own offsets do not matter.
 */
function foldQuery(query: string): string {
  return foldForSearch(query.normalize('NFC')).replace(COMBINING_MARKS, '').replace(/[\u00ad\u200b]/g, '');
}

/** One word of the folded query as a pattern: every unit may carry marks and be split by an invisible character. */
function wordPattern(word: string): string {
  const units = [...word].map((u) => `${escapeRegExp(u)}\\p{M}*`);
  return units.join(INVISIBLE);
}

const LETTER = /^\p{L}$/u;
const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u;

/**
 * The query as a pattern in which punctuation of abbreviations is optional (spec §13.2): a «.» or
 * «,» of the query after a letter, or ending a word, may be absent from the text; the text may have
 * a «.» or «,» after any letter of a query word and at the end of any word but the last. Never a
 * space: it never joins two words. Matched only at the start of a word, so «art. 13» finds
 * «art 13» but not «part 13».
 */
function punctuationFreePattern(words: string[]): string | null {
  const parts: string[] = [];
  words.forEach((word, w) => {
    const units = [...word];
    // A «.» or «,» after a letter, or at the end of the word, is optional: dropped here, and put
    // back as an optional `[.,]` where a letter or the word's end allows one.
    const kept = units.filter((u, i) => !((u === '.' || u === ',') && (LETTER.test(units[i - 1] ?? '') || i === units.length - 1)));
    if (kept.length === 0) return;
    if (parts.length > 0) parts.push('\\s+');
    kept.forEach((u, i) => {
      parts.push(`${escapeRegExp(u)}\\p{M}*`);
      if (i < kept.length - 1) parts.push(LETTER.test(u) ? '[.,\\u00ad\\u200b]?' : INVISIBLE);
    });
    // Between two words a «.» or «,» may end the first on either side («art 13» and «art. 13,
    // comma»); the query's last word takes none, so a match never swallows a sentence's end.
    if (w < words.length - 1) parts.push('[.,]?');
  });
  if (parts.length === 0) return null;
  const body = parts.join('');
  const first = [...words[0]][0] ?? '';
  return LETTER_OR_DIGIT.test(first) ? `(?<![\\p{L}\\p{N}])${body}` : body;
}

/** Whether `query` is long enough to search: the rule `findMatches` applies (folded, trimmed, in base characters). */
export function isSearchableQuery(query: string): boolean {
  return [...foldQuery(query).trim()].length >= MIN_QUERY_LENGTH;
}

/**
 * Every match of `query` in `text`, as `[start, end)` offsets of the original
 * text. The query is folded and trimmed; under two characters (folded base
 * characters, that is code points) nothing matches; a run of whitespace in the
 * query matches any run in the text; a combining mark after a matched letter
 * is part of the match, and a soft hyphen or zero-width space between letters
 * is ignored. Ligatures (ﬁ, ﬂ) are not matched. Where the literal match fails,
 * the punctuation of abbreviations is optional (`punctuationFreePattern`: «cpa»
 * finds «c.p.a.», «art 13» finds «art. 13»), from the start of a word only. Past
 * `limit` matches the rest are not collected and `truncated` is set.
 */
export function findMatches(
  text: string,
  query: string,
  { limit = 1000 }: { limit?: number } = {},
): FindResult {
  if (!isSearchableQuery(query)) return { matches: [], truncated: false };
  return findMatchesInFolded(foldForSearch(text), query, { limit });
}

/**
 * `findMatches` over a text already folded with `foldForSearch` (same length, so the offsets are
 * the original text's): a caller searching the same stored text for every keystroke folds it once
 * (`useFindWindow`).
 */
export function findMatchesInFolded(
  haystack: string,
  query: string,
  { limit = 1000 }: { limit?: number } = {},
): FindResult {
  if (!isSearchableQuery(query)) return { matches: [], truncated: false };
  const folded = foldQuery(query).trim();

  const words = folded.split(/\s+/);
  // The literal match first; where it fails, the same words with the punctuation of
  // abbreviations made optional (spec §13.2).
  // A number is never cut out of a longer one: a query starting with a digit does not begin right
  // after a digit, one ending with a digit does not end right before one («8980/2018» is not in
  // «18980/2018» nor in «8980/20181»).
  const edges = [...folded];
  const before = /\p{N}/u.test(edges[0]) ? '(?<!\\p{N})' : '';
  const after = /\p{N}/u.test(edges[edges.length - 1]) ? '(?!\\p{N})' : '';
  const literal = `${before}(?:${words.map(wordPattern).join('\\s+')})${after}`;
  const relaxedBody = punctuationFreePattern(words);
  const relaxed = relaxedBody ? `${before}(?:${relaxedBody})${after}` : null;
  const re = new RegExp(relaxed ? `${literal}|${relaxed}` : literal, 'gu');

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

/**
 * Where `pos` of `oldText` sits in `newText`: unchanged before the common prefix, shifted by the
 * length difference after the common suffix, and at the start of the change when it falls inside
 * what changed. How a caller keeping a current match carries its position through a redraw
 * (`useFindWindow`) without re-finding it by content.
 */
export function mapThroughEdit(oldText: string, newText: string, pos: number): number {
  const max = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < max && oldText[prefix] === newText[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < max - prefix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix += 1;
  if (pos < prefix) return pos;
  if (pos >= oldText.length - suffix) return pos + newText.length - oldText.length;
  return prefix;
}

export interface TextSegment {
  node: Text;
  /** Offset of the node's first character in the concatenated text. */
  start: number;
}

const BLOCK_TAGS = new Set([
  'DIV', 'P', 'LI', 'UL', 'OL', 'PRE', 'TABLE', 'TR', 'TD', 'TH', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
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
