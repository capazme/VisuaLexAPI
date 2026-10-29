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
import type { AiReviewState, Annotation, Highlight, HighlightProposal, ArticleDiscussionPassageSummary } from '../types';
import type { ArticleStructure, StructureBlock } from './articleStructure';
import { HIGHLIGHT_COLORS, type HighlightColor } from './highlightColors';
import { aiReviewSummary, type AiReviewCounts } from './aiReview';
import { GLOSS_WORDS } from '../constants/glossWords';

/** A passage discussion located in the text on screen (never a detached one). */
export interface LocatedThread {
  thread: ArticleDiscussionPassageSummary;
  start: number; // plain-text offsets, from locatePassage
  end: number;
}

/**
 * An application's gloss on a passage (D8): where it is anchored, as a highlight is (`startOffset`, `text`), and the
 * state of its note. Never a mark in the text (no element of its own, and no colour): its block's sign counts it, and
 * the reader shows it beside the text or in the sign's popover.
 */
export interface GlossAnchor {
  id: string;
  startOffset: number;
  text: string;
  state: AiReviewState;
}

export type ResolvedAnchor =
  | { kind: 'highlight'; highlight: Highlight; start: number; end: number }
  | { kind: 'note'; note: Annotation; start: number; end: number }
  | { kind: 'thread'; thread: ArticleDiscussionPassageSummary; start: number; end: number }
  | { kind: 'gloss'; gloss: GlossAnchor; start: number; end: number };

export interface BlockAnnotations {
  notes: Annotation[];
  highlights: Highlight[];
  threads: ArticleDiscussionPassageSummary[];
  /** An application's glosses on the block's words (D8), in the order they appear. */
  glosses: GlossAnchor[];
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
 * Where each gloss lands (D8), by the highlights' own rule (`anchorEnd`): at its offset, or nowhere. One that does not
 * land is in no block: the reader lists it apart, with its actions.
 */
export function resolveGlosses(plain: string, glosses: readonly GlossAnchor[]): ResolvedAnchor[] {
  const out: ResolvedAnchor[] = [];
  for (const gloss of glosses) {
    const end = anchorEnd(plain, gloss.startOffset, gloss.text);
    if (end !== null) out.push({ kind: 'gloss', gloss, start: gloss.startOffset, end });
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
  threads: readonly LocatedThread[] = [],
  glosses: readonly GlossAnchor[] = [],
): BlockAnnotations[] {
  const plain = raw.replace(/\n/g, '');
  const anchors = resolveAnchors(plain, highlights, annotations);
  const threadAnchors: ResolvedAnchor[] = threads.map((lt) => ({
    kind: 'thread',
    thread: lt.thread,
    start: lt.start,
    end: lt.end,
  }));
  return groupAnchorsByBlock(raw, structure, [...anchors, ...threadAnchors, ...resolveGlosses(plain, glosses)]);
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
    const group: BlockAnnotations = { notes: [], highlights: [], threads: [], glosses: [] };
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
      } else if (anchor.kind === 'highlight') {
        if (!group.highlights.includes(anchor.highlight)) {
          group.highlights.push(anchor.highlight);
        }
      } else if (anchor.kind === 'thread') {
        if (!group.threads.includes(anchor.thread)) {
          group.threads.push(anchor.thread);
        }
      } else if (!group.glosses.includes(anchor.gloss)) {
        group.glosses.push(anchor.gloss);
      }
    }
    return group;
  });
}

export const hasAnnotations = (group: BlockAnnotations | undefined): group is BlockAnnotations =>
  !!group && group.notes.length + group.highlights.length + group.threads.length + group.glosses.length > 0;

/**
 * How a mark on a section no longer shown is named: «Sezione non più disponibile · Ratio» for
 * `<article>/brocardi/ratio` (the Brocardi sections went, D-078, and what was marked on them stays the
 * reader's, to read and remove); null for a mark on the article's own text, whose id has no `/`.
 */
export function retiredSectionLabel(articleId: string): string | null {
  const slash = articleId.indexOf('/');
  if (slash === -1) return null;
  const section = articleId.slice(articleId.lastIndexOf('/') + 1);
  return section ? `Sezione non più disponibile · ${section[0].toUpperCase()}${section.slice(1)}` : 'Sezione non più disponibile';
}

/**
 * The highlights no block's sign shows: those of another section of the
 * article (the Brocardi Ratio and Spiegazione, no longer shown) and those whose text is no
 * longer where they were saved. They need a place of their own to be removed
 * from (LooseHighlightsList), since the signs cannot reach them.
 */
export function highlightsWithoutSign(highlights: readonly Highlight[], groups: readonly BlockAnnotations[]): Highlight[] {
  const shown = new Set<Highlight>();
  for (const group of groups) for (const h of group.highlights) shown.add(h);
  return highlights.filter((h) => !shown.has(h));
}

/** The sign's dots: each highlight colour once, in order of appearance. */
export function signColors(highlights: readonly Highlight[]): HighlightColor[] {
  const out: HighlightColor[] = [];
  for (const h of highlights) {
    const color: HighlightColor = (HIGHLIGHT_COLORS as readonly string[]).includes(h.color) ? h.color : 'yellow';
    if (!out.includes(color)) out.push(color);
  }
  return out;
}

/** A passage an application proposed (D7b), validated or not. */
export const isProposal = (h: Highlight): h is Highlight & { proposal: HighlightProposal } => !!h.proposal;

/**
 * A proposed passage with the application's note (D7b): the note, not the
 * highlight, has a state. A passage without one is a plain mark of known origin, removable, with no state.
 */
export const hasAiNote = (h: Highlight): boolean => !!h.proposal?.note;

/** A note on a passage the user has not validated yet («da validare» or «Da rivedere»): dashed in the text, named apart on the sign. */
export const isOpenProposal = (h: Highlight): boolean => !!h.proposal?.note && h.proposal.note.state !== 'validated';

/**
 * What a screen reader hears on a sign: "2 note e 1 evidenziazione in questo passo". The passages with an
 * application's note (D7b) come last, apart, in the row's words: "1 nota in questo passo; 3 passaggi proposti
 * dall'IA: 1 da validare · 1 da rivedere · 1 validato". `highlights` leaves them out. An application's glosses (D8)
 * after them, the same way: "…; 2 glosse dell'IA: 1 da validare · 1 validato".
 */
export function signAriaLabel(
  notes: number,
  highlights: number,
  threads = 0,
  proposals: AiReviewCounts = { proposed: 0, validated: 0, review: 0 },
  glosses: AiReviewCounts = { proposed: 0, validated: 0, review: 0 },
): string {
  const parts: string[] = [];
  if (notes > 0) parts.push(`${notes} ${notes === 1 ? 'nota' : 'note'}`);
  if (highlights > 0) parts.push(`${highlights} ${highlights === 1 ? 'evidenziazione' : 'evidenziazioni'}`);
  if (threads > 0) parts.push(`${threads} ${threads === 1 ? 'glossa' : 'glosse'}`);
  const all = proposals.proposed + proposals.review + proposals.validated;
  const glossed = glosses.proposed + glosses.review + glosses.validated;
  const assistant = [
    all > 0 ? `${all} ${all === 1 ? 'passaggio proposto' : 'passaggi proposti'} dall'IA: ${aiReviewSummary(proposals)}` : '',
    glossed > 0 ? `${GLOSS_WORDS.count(glossed)}: ${aiReviewSummary(glosses)}` : '',
  ].filter(Boolean).join('; ');
  if (parts.length === 0) return assistant || 'in questo passo';
  const own = parts.length === 1
    ? `${parts[0]} in questo passo`
    : `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]} in questo passo`;
  return assistant ? `${own}; ${assistant}` : own;
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
