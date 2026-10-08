/**
 * A decision's text as HTML for `SafeHTML`, with the reader's marks (design 2026-10-05 §8.3).
 *
 * The contract is root rule 23's, for decisions: anchors count characters in the projection —
 * the blocks in reading order, each stripped of ASCII whitespace at its edges, concatenated,
 * every `\n` removed — and the rendered text nodes spell it exactly. Labels, the space between
 * lines and between paragraphs are CSS; the annotation signs are empty elements; every text node
 * is escaped. The marks are the article's own (`highlightOpen`, `noteOpen`, `signHtml`, cut and
 * nested by `renderSpan`), so the same CSS and click handlers work on both.
 *
 * A paragraph is a decision's block for the signs, as a comma is an article's. Highlights are
 * hidden by a CSS class on the container (`highlights-hidden`), as on an article.
 */
import type { Annotation, Highlight } from '../types';
import type { DecisionText } from '../types/decisions';
import { groupAnchorsByBlock, resolveAnchors, type LocatedThread, type ResolvedAnchor } from './articleAnnotations';
import { highlightOpen, noteOpen, renderSpan, signHtml, threadFocusOpen, type Mark } from './articleRender';
import type { ArticleStructure } from './articleStructure';
import { decisionParagraphs } from './decisionText';

const BLOCKS: ReadonlyArray<readonly [keyof DecisionText, string]> = [
  ['epigrafe', 'Epigrafe'],
  ['motivazione', 'Motivazione'],
  ['dispositivo', 'Dispositivo'],
];

// ASCII whitespace only (spec §8.2), as the API's freeze test strips: never `.trim()`, which
// also strips the no-break space and the other Unicode spaces.
const stripEdges = (s: string): string => s.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '');

const blockTexts = (testo: DecisionText): Array<[string, string, string]> =>
  BLOCKS.map(([key, name]) => [key, name, stripEdges(testo[key] ?? '')]);

export function decisionProjection(testo: DecisionText): string {
  return blockTexts(testo)
    .map(([, , text]) => text)
    .join('')
    .replace(/\n/g, '');
}

export interface DecisionLayout {
  label: string;
  paragraphs: Array<{ start: number; end: number; ranges: Array<{ from: number; to: number }> }>;
}

/**
 * The text laid out in projection offsets: per block its label, per paragraph its range and the
 * range of each of its lines (a line holds no `\n`, so a range of the projection is its text).
 */
export function layoutDecision(testo: DecisionText): DecisionLayout[] {
  let offset = 0;
  const texts = blockTexts(testo);
  const hasMotivazione = texts.some(([key, , text]) => key === 'motivazione' && text !== '');
  return texts.map(([key, name, text]) => {
    const label = key === 'epigrafe' && !hasMotivazione ? 'Testo' : name;
    const paragraphs = text
      ? decisionParagraphs(text).map((lines) => {
          const start = offset;
          const ranges = lines.map((line) => {
            const from = offset;
            offset += line.length;
            return { from, to: offset };
          });
          return { start, end: offset, ranges };
        })
      : [];
    return { label, paragraphs };
  });
}

/**
 * A decision's paragraphs as the blocks of an article's structure, in projection offsets: the
 * one list the renderer's `data-block` indices, `groupAnnotationsByBlock` and the popover's
 * host (`describeBlock(decisionProjection(testo), block)` names a block) all read, so a sign and
 * the list it opens never disagree. It depends on the text alone, never on the anchors.
 */
export function decisionStructure(testo: DecisionText): ArticleStructure {
  return {
    blocks: layoutDecision(testo).flatMap((b) => b.paragraphs.map(({ start, end }) => ({ start, end, kind: 'comma' as const }))),
    decorations: [],
    notes: {},
    updates: null,
  };
}

export interface RenderDecisionInput {
  testo: DecisionText;
  highlights: readonly Highlight[];
  annotations: readonly Annotation[];
  /** Draw each annotated paragraph's sign (round B), as the article tab does. */
  signs?: boolean;
  /** Passage discussions located in the projection: counted on the signs, never drawn as marks. */
  threads?: readonly LocatedThread[];
  /** The discussion open in the panel: its words light up (`.vlx-thread-focus`), nested as an article's. */
  focusedThreadId?: string | null;
}

export function renderDecisionHtml({ testo, highlights, annotations, signs = false, threads = [], focusedThreadId = null }: RenderDecisionInput): string {
  const plain = decisionProjection(testo);
  const anchors = resolveAnchors(plain, highlights, annotations);
  const marks: Mark[] = [];
  anchors.forEach((anchor, seq) => {
    if (anchor.kind === 'highlight') {
      marks.push({ start: anchor.start, end: anchor.end, kind: 'highlight', open: highlightOpen(anchor.highlight), close: '</mark>', seq });
    } else if (anchor.kind === 'note') {
      marks.push({ start: anchor.start, end: anchor.end, kind: 'note', open: noteOpen(anchor.note), close: '</span>', seq });
    }
  });

  const focused = focusedThreadId ? threads.find((t) => t.thread.id === focusedThreadId) : undefined;
  if (focused && focused.end > focused.start && focused.end <= plain.length) {
    marks.push({ start: focused.start, end: focused.end, kind: 'thread', open: threadFocusOpen(focused.thread.id), close: '</span>', seq: marks.length });
  }

  const layout = layoutDecision(testo);
  const threadAnchors: ResolvedAnchor[] = threads.map((lt) => ({ kind: 'thread', thread: lt.thread, start: lt.start, end: lt.end }));
  const groups = signs ? groupAnchorsByBlock(plain, decisionStructure(testo), [...anchors, ...threadAnchors]) : null;

  let index = 0;
  return layout
    .filter((b) => b.paragraphs.length > 0)
    .map(({ label, paragraphs }) => {
      const html = paragraphs
        .map(({ ranges }) => {
          const lines = ranges
            // The readers turn every carriage return into a line feed (italgiure:v4), so none
            // reaches the page. Should one come, it is written as a character reference so this
            // HTML is faithful to the projection; SafeHTML's sanitiser re-serialises it, and the
            // page's parser would read it as a line feed: the guarantee is the readers', not ours.
            // (A NUL is dropped by the parser and stays a limit, as in an article.)
            .map(({ from, to }) => `<span class="vlx-dec-line">${renderSpan(plain, from, to, marks, false).replace(/\r/g, '&#13;')}</span>`)
            .join('');
          // After the lines, so a sign is never inside a mark.
          const sign = groups ? signHtml(index, groups[index]) : '';
          index++;
          return `<p class="vlx-dec-para">${lines}${sign}</p>`;
        })
        .join('');
      return `<section class="vlx-dec-block" data-label="${label}" aria-label="${label}">${html}</section>`;
    })
    .join('');
}

/**
 * A note that quotes words of the decision. One without a quote is free (it lives in the notes
 * panel and carries none of the court's words); one with a quote but no usable offset is anchored
 * and, since it cannot land, unmatched. The one definition: the box, the PDF and the exits read it.
 */
export const isAnchoredNote = (a: Annotation): boolean => Boolean(a.anchorText);

/**
 * The anchors that do not land in the text (a note without an anchor is never one), to be listed and never dropped (spec §8.4): their
 * text was changed at the source, or the decision came without its text.
 */
export function unmatchedAnchors(
  testo: DecisionText,
  highlights: readonly Highlight[],
  annotations: readonly Annotation[],
): { highlights: Highlight[]; annotations: Annotation[] } {
  // A free note has no anchor to lose: it lives in the notes panel, never in this list.
  const anchored = annotations.filter(isAnchoredNote);
  const landed = resolveAnchors(decisionProjection(testo), highlights, anchored);
  const hl = new Set(landed.flatMap((a) => (a.kind === 'highlight' ? [a.highlight.id] : [])));
  const nt = new Set(landed.flatMap((a) => (a.kind === 'note' ? [a.note.id] : [])));
  return { highlights: highlights.filter((h) => !hl.has(h.id)), annotations: anchored.filter((a) => !nt.has(a.id)) };
}
