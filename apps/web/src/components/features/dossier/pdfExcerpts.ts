/**
 * «Solo le parti evidenziate e annotate» (spec 2026-10-13-dossier-pdf-decisions-design.md): the
 * passages a reader marked in a text, in reading order, each with the notes anchored in it, and a gap
 * where text was left out. Pure. Root rule 23: the passages are cut at the offsets `resolveAnchors`
 * gives over the projection the anchors were made on, and `textBetween` returns those characters
 * unchanged (a line break the projection hides comes back as one).
 */
import type { ResolvedAnchor } from '../../../utils/articleAnnotations';

export type ExcerptPart =
  | { kind: 'gap' }
  | { kind: 'passage'; text: string; notes: string[] };

/** The gap marker the PDF prints where text was left out. */
export const EXCERPT_GAP = '[…]';

/**
 * The passages of a text of `length` projection characters: the highlights and the notes' anchors,
 * merged where they overlap or touch, in order, with a gap before the first, between two passages
 * and after the last wherever text lies between. A thread is not a mark and is ignored.
 */
export function excerptParts(
  length: number,
  anchors: readonly ResolvedAnchor[],
  textBetween: (from: number, to: number) => string,
): ExcerptPart[] {
  const marked = anchors
    .filter((a) => a.kind === 'highlight' || a.kind === 'note')
    .map((a) => ({ anchor: a, from: Math.max(0, a.start), to: Math.min(length, a.end) }))
    .filter((a) => a.from < a.to)
    .sort((x, y) => x.from - y.from || x.to - y.to);
  const ranges: Array<{ from: number; to: number; notes: string[] }> = [];
  for (const { anchor, from, to } of marked) {
    const last = ranges[ranges.length - 1];
    const range = last && from <= last.to ? last : undefined;
    if (range) range.to = Math.max(range.to, to);
    else ranges.push({ from, to, notes: [] });
    const owner = range ?? ranges[ranges.length - 1];
    if (anchor.kind === 'note' && !owner.notes.includes(anchor.note.text)) owner.notes.push(anchor.note.text);
  }
  const parts: ExcerptPart[] = [];
  let at = 0;
  for (const range of ranges) {
    if (range.from > at) parts.push({ kind: 'gap' });
    parts.push({ kind: 'passage', text: textBetween(range.from, range.to), notes: range.notes });
    at = range.to;
  }
  if (ranges.length > 0 && at < length) parts.push({ kind: 'gap' });
  return parts;
}

/**
 * An article's text between two projection offsets (`article_text` without its `\n`), cut from the
 * stored text itself: the `\n` inside the passage stay, the characters are the stored ones.
 */
export function articleTextBetween(raw: string): { length: number; textBetween: (from: number, to: number) => string } {
  // rawAt[i]: where the i-th projection character sits in `raw`.
  const rawAt: number[] = [];
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) !== 10) rawAt.push(i);
  return {
    length: rawAt.length,
    textBetween: (from, to) => (from < to ? raw.slice(rawAt[from], rawAt[to - 1] + 1) : ''),
  };
}
