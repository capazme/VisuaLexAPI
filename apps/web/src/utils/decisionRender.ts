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

  // Lay the text out first: each line is a range of the projection (no `\n` in it), so
  // `renderSpan` over `plain` cuts and nests the marks per line, each segment self-contained.
  let offset = 0;
  const layout = blockTexts(testo).map(([key, name, text]) => {
    const label = key === 'epigrafe' && !testo.motivazione ? 'Testo' : name;
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

  // A paragraph is a block of the pseudo-structure the signs are counted over.
  const all = layout.flatMap((b) => b.paragraphs);
  const groups = signs
    ? groupAnchorsByBlock(plain, { blocks: all.map((p) => ({ start: p.start, end: p.end, kind: 'comma' as const })) } as ArticleStructure, anchors)
    : null;

  let index = 0;
  return layout
    .filter((b) => b.paragraphs.length > 0)
    .map(({ label, paragraphs }) => {
      const html = paragraphs
        .map(({ ranges }) => {
          const lines = ranges
            .map(({ from, to }) => `<span class="vlx-dec-line">${renderSpan(plain, from, to, marks, false)}</span>`)
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
