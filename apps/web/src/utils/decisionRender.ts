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
import { groupAnchorsByBlock, resolveAnchors } from './articleAnnotations';
import { highlightOpen, noteOpen, renderSpan, signHtml, type Mark } from './articleRender';
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

interface DecisionLayout {
  label: string;
  paragraphs: Array<{ start: number; end: number; ranges: Array<{ from: number; to: number }> }>;
}

/**
 * The text laid out in projection offsets: per block its label, per paragraph its range and the
 * range of each of its lines (a line holds no `\n`, so a range of the projection is its text).
 */
function layoutDecision(testo: DecisionText): DecisionLayout[] {
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
}

export function renderDecisionHtml({ testo, highlights, annotations, signs = false }: RenderDecisionInput): string {
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

  const layout = layoutDecision(testo);
  const groups = signs ? groupAnchorsByBlock(plain, decisionStructure(testo), anchors) : null;

  let index = 0;
  return layout
    .filter((b) => b.paragraphs.length > 0)
    .map(({ label, paragraphs }) => {
      const html = paragraphs
        .map(({ ranges }) => {
          const lines = ranges
            // A carriage return inside a line is kept by the projection but the HTML parser would
            // turn it into a line feed: as a character reference it reaches the DOM unchanged.
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
 * The anchors that do not land in the text, to be listed and never dropped (spec §8.4): their
 * text was changed at the source, or the decision came without its text.
 */
export function unmatchedAnchors(
  testo: DecisionText,
  highlights: readonly Highlight[],
  annotations: readonly Annotation[],
): { highlights: Highlight[]; annotations: Annotation[] } {
  const landed = resolveAnchors(decisionProjection(testo), highlights, annotations);
  const hl = new Set(landed.flatMap((a) => (a.kind === 'highlight' ? [a.highlight.id] : [])));
  const nt = new Set(landed.flatMap((a) => (a.kind === 'note' ? [a.note.id] : [])));
  return { highlights: highlights.filter((h) => !hl.has(h.id)), annotations: annotations.filter((a) => !nt.has(a.id)) };
}
