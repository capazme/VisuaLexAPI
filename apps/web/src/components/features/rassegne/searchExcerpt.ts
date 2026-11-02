/**
 * Where the words searched sit in a passage, as the store found them (`store.terms`, FTS5's
 * `unicode61 remove_diacritics 2`): each word is the start of a word, case and accents folded, a
 * word being a run of letters and digits. The page «Rassegne» marks them and opens the passage
 * on the lines around the first (spec 2026-11-01-rassegne-search-page §3).
 */

/** A range of the passage's own text, `[start, end)` in UTF-16 units. */
export interface Span {
  start: number;
  end: number;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** One character as the index reads it: no accent, lower case («À» → «a»); maybe several («ﬁ» stays one). */
const foldChar = (ch: string): string => ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The text folded, and for each folded unit the original unit it comes from. */
function folded(text: string): { text: string; from: number[]; to: number[] } {
  let out = '';
  const from: number[] = [];
  const to: number[] = [];
  let at = 0;
  for (const ch of text) {
    const f = foldChar(ch);
    // a mark that folds to nothing (a decomposed accent) belongs to the letter before it
    if (!f && to.length > 0) to[to.length - 1] = at + ch.length;
    for (let i = 0; i < f.length; i += 1) {
      from.push(at);
      to.push(at + ch.length);
    }
    out += f;
    at += ch.length;
  }
  return { text: out, from, to };
}

/**
 * The words of `words` (as `searchWords` sends them: separated by spaces) found in `text`: each
 * occurrence at the start of a word, the whole word marked, overlaps merged, in order.
 */
export function findWords(text: string, words: string): Span[] {
  const terms = [...new Set(words.split(/\s+/).filter(Boolean).map((w) => [...w].map(foldChar).join('')))];
  if (terms.length === 0 || !text) return [];
  const f = folded(text);
  const isWord = (i: number) => i >= 0 && i < f.text.length && WORD_CHAR.test(f.text[i]);
  const found: Span[] = [];
  for (const term of terms) {
    for (let i = f.text.indexOf(term); i !== -1; i = f.text.indexOf(term, i + 1)) {
      if (isWord(i - 1)) continue;
      let end = i + term.length;
      while (isWord(end)) end += 1;
      found.push({ start: f.from[i], end: f.to[end - 1] });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const span of found) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/**
 * The word the excerpt opens on: the longest searched (the likeliest to say what was looked for —
 * «chance» rather than «di»), the first of them on a tie.
 */
export function anchorWord(words: string): string {
  return words.split(/\s+/).filter(Boolean).reduce((best, w) => ([...w].length > [...best].length ? w : best), '');
}

/** A first word found further in than this opens the passage a little before it: under four lines of a phone. */
const LEAD = 80;
/** How much comes before that word: about a line. */
const BEFORE = 70;

/**
 * Where the excerpt starts: 0 when the first word found is near the beginning (or none is, the
 * word being in where the passage sits); else at a word boundary about a line before it. The
 * caller passes the spans of the word it opens on (`anchorWord`).
 */
export function excerptStart(text: string, spans: Span[]): number {
  const first = spans[0];
  if (!first || first.start <= LEAD) return 0;
  const space = text.lastIndexOf(' ', first.start - BEFORE);
  return space === -1 ? 0 : space + 1;
}
