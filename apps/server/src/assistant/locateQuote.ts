/**
 * Where a quoted passage sits in an entry's projection (D7b, spec §8.5). The model never gives an offset: it
 * quotes the words, and this finds them in the real text and returns the projection's own slice, so every
 * stored anchor is one the renderer finds (root rule 23).
 *
 * The comparison: a run of whitespace in the quote matches a run of whitespace in the text, or nothing (a line
 * break the projection removed, a missing space between two commi); where the quote has no whitespace the
 * text may have none either («infine» never matches «in fine»); every other character counts as written, case,
 * accents, apostrophes and quotation marks included (G9: no unification at first). The renderer ignores case;
 * the search is stricter, so a stored anchor always renders.
 */

export const QUOTE_MIN = 15;
export const QUOTE_MAX = 2000;
export const CONTEXT_MAX = 200;
/** Past this many occurrences the count is not worth reading on. */
const MAX_OCCURRENCES = 1000;

export type Located =
  | { found: true; start: number; text: string }
  | { found: false; reason: 'too_short' | 'not_found' | 'ambiguous'; count?: number };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The quote's pattern: its words exact, every run of whitespace between them `\s*`. Null for no words. */
function pattern(quote: string): string | null {
  const words = quote.split(/\s+/).filter(Boolean);
  return words.length ? words.map(escape).join('\\s*') : null;
}

/** The non-whitespace characters of a quote: what «too short» counts. */
const significant = (quote: string) => quote.replace(/\s+/g, '').length;

export function locateQuote(projection: string, quote: { testo: string; prima?: string; dopo?: string }): Located {
  if (significant(quote.testo) < QUOTE_MIN) return { found: false, reason: 'too_short' };
  const body = pattern(quote.testo);
  if (!body) return { found: false, reason: 'too_short' };
  const re = new RegExp(body, 'gu');
  const hits: { start: number; end: number }[] = [];
  for (let m = re.exec(projection); m && hits.length < MAX_OCCURRENCES; m = re.exec(projection)) {
    hits.push({ start: m.index, end: m.index + m[0].length });
    // Overlapping occurrences count too: the next search starts one character on.
    re.lastIndex = m.index + 1;
  }
  if (hits.length === 0) return { found: false, reason: 'not_found' };
  let kept = hits;
  if (hits.length > 1) {
    const before = quote.prima ? pattern(quote.prima) : null;
    const after = quote.dopo ? pattern(quote.dopo) : null;
    if (before || after) {
      const endsWith = before ? new RegExp(`${before}\\s*$`, 'u') : null;
      const startsWith = after ? new RegExp(`^\\s*${after}`, 'u') : null;
      // A window wide enough for the context with its whitespace spread out, never the whole text.
      const reach = (s: string) => s.length * 4 + 64;
      kept = hits.filter(
        (h) =>
          (!endsWith || endsWith.test(projection.slice(Math.max(0, h.start - reach(quote.prima!)), h.start))) &&
          (!startsWith || startsWith.test(projection.slice(h.end, h.end + reach(quote.dopo!)))),
      );
    }
  }
  // Context that touches none, or several: the count of occurrences, so the model can tell them apart.
  if (kept.length !== 1) return { found: false, reason: 'ambiguous', count: kept.length === 0 ? hits.length : kept.length };
  const [hit] = kept;
  return { found: true, start: hit.start, text: projection.slice(hit.start, hit.end) };
}
