/**
 * Italian legal articles typically begin their body text with the
 * redundant preamble `Art. N. (Rubrica).` — the same information
 * already surfaced by the Study Mode title and a dedicated rubric
 * subtitle. `extractPreamble` splits that off so the rendered body
 * doesn't duplicate it visually, and returns the byte length consumed
 * so callers can shift highlight / annotation offsets between
 * document-relative coordinates (how they're stored, matching the
 * main article view) and body-relative coordinates (what the Study
 * Mode renderer now sees).
 *
 * The regex is intentionally conservative: if the first line doesn't
 * match `Art. N.` (with optional `bis`/`ter`/... suffix) the whole
 * text is returned unchanged with a zero offset, so articles that
 * don't follow the usual convention render as-is.
 */

const PREAMBLE_RE = /^\s*art(?:icolo)?\.?\s+\d+(?:\s*-?\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?\.?\s*(?:\(\s*([^)]+?)\s*\)\s*\.?)?\s*(?:\n\s*)*/i;

export interface PreambleSplit {
  /** Text inside the first parenthetical after the article number, trimmed. Null when no rubric was present. */
  rubric: string | null;
  /** Article body with the preamble stripped. Equal to the input when no preamble was detected. */
  body: string;
  /**
   * Raw character count consumed by the preamble. Use for `raw.slice()`
   * operations. Equal to `body`'s starting index in `raw`.
   */
  offset: number;
  /**
   * Plain-text character count of the preamble — the raw length minus
   * every newline it contains. Use this (NOT `offset`) when shifting
   * highlight / annotation startOffsets between body-relative and
   * document-relative coordinates, because those offsets live in
   * plain-text space (DOM textContent, where <br/> contributes 0 chars).
   */
  plainOffset: number;
}

export function extractPreamble(raw: string): PreambleSplit {
  const match = raw.match(PREAMBLE_RE);
  // Skip when: no match, empty match, or the preamble is the whole text
  // (we'd render nothing and the article would look broken).
  if (!match || match[0].length === 0 || match[0].length === raw.length) {
    return { rubric: null, body: raw, offset: 0, plainOffset: 0 };
  }
  const consumed = match[0];
  const newlines = (consumed.match(/\n/g) ?? []).length;
  return {
    rubric: match[1]?.trim() ?? null,
    body: raw.slice(consumed.length),
    offset: consumed.length,
    plainOffset: consumed.length - newlines,
  };
}
