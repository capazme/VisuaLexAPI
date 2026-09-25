/**
 * Where the reader's highlights and anchored notes land in an article's text,
 * and which block of the structured text holds each one.
 *
 * One definition of "this anchor renders, here", shared by the renderer
 * (utils/articleRender.ts), which draws the marks and the annotation signs,
 * and by the popover that lists a block's annotations
 * (BlockAnnotationsPopover): what a sign counts is exactly what its block
 * shows. Offsets are plain-text offsets — `article_text` without its
 * newlines (CLAUDE.md gotcha 23).
 */
import type { Annotation, Highlight } from '../types';
import type { ArticleStructure, StructureBlock } from './articleStructure';
import { HIGHLIGHT_COLORS, type HighlightColor } from './highlightColors';

export type ResolvedAnchor =
  | { kind: 'highlight'; highlight: Highlight; start: number; end: number }
  | { kind: 'note'; note: Annotation; start: number; end: number };

export interface BlockAnnotations {
  notes: Annotation[];
  highlights: Highlight[];
}

/**
 * Where a stored anchor ends, in plain-text offsets, or null when its text is
 * not at its offset. Exact (case-insensitive) first, as always. Then one
 * bounded rescue for anchors stored from a rendered selection, whose text
 * carries newlines the projection does not have: anchored at the same offset,
 * whitespace skipped on both sides, every other character equal.
 */
function anchorEnd(plain: string, start: number, text: string): number | null {
  if (!text || start < 0 || start >= plain.length) return null;
  const exact = plain.slice(start, start + text.length);
  if (exact.length === text.length && exact.toLowerCase() === text.toLowerCase()) return start + text.length;
  if (/\s/.test(plain[start])) return null;
  let i = start;
  let matched = 0;
  for (let j = 0; j < text.length; j++) {
    if (/\s/.test(text[j])) continue;
    while (i < plain.length && /\s/.test(plain[i])) i++;
    if (i >= plain.length || plain[i].toLowerCase() !== text[j].toLowerCase()) return null;
    i++;
    matched++;
  }
  return matched > 0 ? i : null;
}

/**
 * Every place a stored highlight or anchored note renders: highlights first,
 * then notes, each in input order. A highlight with an offset renders where
 * its text is, or nowhere; one saved before offsets existed renders on every
 * occurrence of its text, as it always did. A note needs both an offset and
 * its anchor text.
 */
export function resolveAnchors(
  plain: string,
  highlights: readonly Highlight[],
  annotations: readonly Annotation[],
): ResolvedAnchor[] {
  const out: ResolvedAnchor[] = [];
  const plainLower = plain.toLowerCase();
  for (const h of highlights) {
    if (typeof h.startOffset === 'number' && h.startOffset >= 0) {
      const end = anchorEnd(plain, h.startOffset, h.text);
      if (end !== null) out.push({ kind: 'highlight', highlight: h, start: h.startOffset, end });
      continue;
    }
    const needle = h.text.toLowerCase();
    if (!needle) continue;
    for (let at = plainLower.indexOf(needle); at !== -1; at = plainLower.indexOf(needle, at + needle.length)) {
      out.push({ kind: 'highlight', highlight: h, start: at, end: at + needle.length });
    }
  }
  for (const a of annotations) {
    if (typeof a.startOffset !== 'number' || a.startOffset < 0 || !a.anchorText) continue;
    const end = anchorEnd(plain, a.startOffset, a.anchorText);
    if (end !== null) out.push({ kind: 'note', note: a, start: a.startOffset, end });
  }
  return out;
}

/**
 * The annotations each block holds, aligned with `structure.blocks`. An
 * annotation belongs to every block its text reaches — a highlight dragged
 * across two commi is listed under both — and to none when its anchor does
 * not render: an orphan makes no sign, which would point at nothing. The
 * AGGIORNAMENTO separator, drawn as a rule, holds nothing. Within a block,
 * notes and highlights keep the order in which they appear.
 */
export function groupAnnotationsByBlock(
  raw: string,
  structure: ArticleStructure,
  highlights: readonly Highlight[],
  annotations: readonly Annotation[],
): BlockAnnotations[] {
  return groupAnchorsByBlock(raw, structure, resolveAnchors(raw.replace(/\n/g, ''), highlights, annotations));
}

/** `groupAnnotationsByBlock` over anchors already resolved (the renderer has them). */
export function groupAnchorsByBlock(
  raw: string,
  structure: ArticleStructure,
  anchors: readonly ResolvedAnchor[],
): BlockAnnotations[] {
  // plainBefore[i]: the visible (non-newline) characters in raw[0, i).
  const plainBefore = new Array<number>(raw.length + 1);
  plainBefore[0] = 0;
  for (let i = 0; i < raw.length; i++) plainBefore[i + 1] = plainBefore[i] + (raw.charCodeAt(i) === 10 ? 0 : 1);
  const plainAt = (rawIndex: number) => plainBefore[Math.min(Math.max(rawIndex, 0), raw.length)];

  return structure.blocks.map((block) => {
    const group: BlockAnnotations = { notes: [], highlights: [] };
    if (block.kind === 'update-sep') return group;
    const start = plainAt(block.start);
    const end = plainAt(block.end);
    const hits = anchors
      .map((anchor, order) => ({ anchor, order, at: Math.max(anchor.start, start) }))
      .filter(({ anchor }) => anchor.start < end && anchor.end > start)
      .sort((x, y) => x.at - y.at || x.order - y.order);
    for (const { anchor } of hits) {
      if (anchor.kind === 'note') {
        if (!group.notes.includes(anchor.note)) group.notes.push(anchor.note);
      } else if (!group.highlights.includes(anchor.highlight)) {
        group.highlights.push(anchor.highlight);
      }
    }
    return group;
  });
}

export const hasAnnotations = (group: BlockAnnotations | undefined): group is BlockAnnotations =>
  !!group && group.notes.length + group.highlights.length > 0;

/** The sign's dots: each highlight colour once, in order of appearance. */
export function signColors(highlights: readonly Highlight[]): HighlightColor[] {
  const out: HighlightColor[] = [];
  for (const h of highlights) {
    const color: HighlightColor = (HIGHLIGHT_COLORS as readonly string[]).includes(h.color) ? h.color : 'yellow';
    if (!out.includes(color)) out.push(color);
  }
  return out;
}

/** What a screen reader hears on a sign: "2 note e 1 evidenziazione in questo passo". */
export function signAriaLabel(notes: number, highlights: number): string {
  const parts: string[] = [];
  if (notes > 0) parts.push(`${notes} ${notes === 1 ? 'nota' : 'note'}`);
  if (highlights > 0) parts.push(`${highlights} ${highlights === 1 ? 'evidenziazione' : 'evidenziazioni'}`);
  return `${parts.join(' e ')} in questo passo`;
}

const OPENING_CHARS = 48;

/**
 * How a popover names a block without numbering it — round A's rule: no
 * computed comma numbers, a miscount is a wrong citation. The enumerator the
 * source prints ("1.", "a)", "2-bis)"), without Normattiva's "((" of a
 * modified number; otherwise the block's opening words, cut on a word.
 */
export function describeBlock(raw: string, block: StructureBlock): string {
  if (block.marker) {
    const printed = raw.slice(block.marker.start, block.marker.end).replace(/^\s*\(\(/, '').trim();
    if (printed) return printed;
  }
  const words = raw.slice(block.start, block.end).replace(/^\s*\(\(/, '').trim().split(/\s+/).filter(Boolean);
  let opening = '';
  for (const word of words) {
    const next = opening ? `${opening} ${word}` : word;
    if (next.length > OPENING_CHARS) break;
    opening = next;
  }
  if (!opening) opening = (words[0] ?? '').slice(0, OPENING_CHARS);
  return opening.length < words.join(' ').length ? `${opening.replace(/[,;:]$/, '')}…` : opening;
}
