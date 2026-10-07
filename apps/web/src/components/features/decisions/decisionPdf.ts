/**
 * A decision as a PDF of ours (design 2026-10-05 §12.1): what it holds (`decisionPdfModel`, pure)
 * and how it is drawn (`writeDecisionPdf`). The reader's highlights and notes are optional. They
 * are placed with the same `resolveAnchors` over the same projection the reading surface uses
 * (root rule 23), so a mark lands in the PDF exactly where it lands on screen; those that do not
 * land are listed at the end, never dropped. No licence line, as on the page.
 */
import { jsPDF } from 'jspdf';
import type { Annotation, Highlight } from '../../../types';
import type { FoundDecision } from '../../../types/decisions';
import { resolveAnchors } from '../../../utils/articleAnnotations';
import { formatDateItalianLong, withPreposition } from '../../../utils/dateUtils';
import {
  describeNotice,
  formatDecisionCitation,
  formatDecisionHeading,
  formatDecisionShort,
} from '../../../utils/decisionLinks';
import { decisionProjection, layoutDecision, unmatchedAnchors } from '../../../utils/decisionRender';
import { PDF_MARGIN, PDF_WIDTH, createPdfWriter } from '../../../utils/pdfWriter';

export interface DecisionPdfParagraph {
  text: string;
  /** Marked passages as [from, to) offsets into `text`. */
  marks: Array<[number, number]>;
  /** The bodies of the notes anchored in this paragraph, printed after it. */
  notes: string[];
}

export interface DecisionPdfModel {
  heading: string;
  subheading: string;
  notices: string[];
  blocks: Array<{ label: string; paragraphs: DecisionPdfParagraph[] }>;
  /** The reader's notes with no passage (a free note has no anchor to lose), under the text. */
  freeNotes: string[];
  /** Anchors that no longer land in the text, as quoted passages. */
  unmatched: string[];
  footer: string;
  fileName: string;
}

export interface DecisionPdfOptions {
  annotations?: { highlights: Highlight[]; notes: Annotation[] };
  /** ISO day of the download. */
  consultedOn: string;
  /**
   * Whether the anchors whose words the court withdrew are listed under «Non ritrovate nel testo
   * attuale». The owner has not yet answered whether a personal export lists them (asked 7 Oct
   * 2026): this default is the one place that answer changes. Built per the design: listed.
   */
  includeUnmatched?: boolean;
}

/**
 * A paragraph's lines as one running text (the space between two lines is CSS on the page; the
 * projection has none), with each line's start in the projection and in that text, so a range of
 * the projection maps onto the text.
 */
function runningText(lines: string[], starts: number[]): { text: string; toText(offset: number, end: boolean): number } {
  let text = '';
  const at: number[] = [];
  lines.forEach((line, i) => {
    if (i > 0 && !/\s$/.test(text) && !/^\s/.test(line)) text += ' ';
    at.push(text.length);
    text += line;
  });
  return {
    text,
    toText(offset, end) {
      for (let i = 0; i < lines.length; i++) {
        const from = starts[i];
        const to = from + lines[i].length;
        if (end ? offset <= to : offset < to) return at[i] + Math.max(0, offset - from);
      }
      return text.length;
    },
  };
}

export function decisionPdfModel(answer: FoundDecision, options: DecisionPdfOptions): DecisionPdfModel {
  const { annotations, consultedOn, includeUnmatched = true } = options;
  const { identita, attributi, testo } = answer;
  const plain = decisionProjection(testo);
  const highlights = annotations?.highlights ?? [];
  const notes = annotations?.notes ?? [];
  const resolved = annotations ? resolveAnchors(plain, highlights, notes.filter((n) => typeof n.startOffset === 'number' && Boolean(n.anchorText))) : [];

  const blocks = layoutDecision(testo)
    .filter((b) => b.paragraphs.length > 0)
    .map(({ label, paragraphs }) => ({
      label,
      paragraphs: paragraphs.map(({ start, end, ranges }): DecisionPdfParagraph => {
        const run = runningText(ranges.map((r) => plain.slice(r.from, r.to)), ranges.map((r) => r.from));
        const marks: Array<[number, number]> = [];
        const own: string[] = [];
        for (const a of resolved) {
          if (a.kind === 'highlight') {
            const from = Math.max(a.start, start);
            const to = Math.min(a.end, end);
            if (from < to) marks.push([run.toText(from, false), run.toText(to, true)]);
          } else if (a.kind === 'note' && a.end > start && a.end <= end) {
            own.push(a.note.text);
          }
        }
        marks.sort((x, y) => x[0] - y[0]);
        return { text: run.text, marks, notes: own };
      }),
    }));

  const lost = annotations && includeUnmatched ? unmatchedAnchors(testo, highlights, notes) : { highlights: [], annotations: [] };
  const unmatched = [
    ...lost.highlights.map((h) => `«${h.text}»`),
    ...lost.annotations.map((n) => `nota: ${n.text} — su «${n.anchorText}»`),
  ];

  return {
    heading: formatDecisionCitation(identita, attributi),
    subheading: formatDecisionHeading(identita, attributi),
    notices: answer.avvisi.map((n) => describeNotice(n, attributi)),
    blocks,
    freeNotes: annotations ? notes.filter((n) => !(typeof n.startOffset === 'number' && n.anchorText)).map((n) => n.text) : [],
    unmatched,
    footer: `Fonte: ${answer.fonte.nome} · consultata ${withPreposition('il', formatDateItalianLong(consultedOn))}`,
    fileName: `${formatDecisionShort({ ...identita, sezione: attributi.sezione }).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '')}.pdf`,
  };
}

const BODY = 11;
const LEADING = BODY * 1.5;
const MARK_FILL: [number, number, number] = [254, 240, 138];

/** Merges overlapping marks so a passage is painted once. */
function mergeMarks(marks: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [from, to] of marks) {
    const last = out[out.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

export function writeDecisionPdf(model: DecisionPdfModel): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const w = createPdfWriter(doc, { footerLeft: model.footer, font: 'times' });

  w.write(model.heading, 13, 'bold', 18);
  w.write(model.subheading, 10, 'normal', 14, true);
  model.notices.forEach((notice) => w.write(notice, 10, 'italic', 14, true));
  w.y += 8;

  for (const block of model.blocks) {
    w.ensureSpace(LEADING * 3);
    w.y += 6;
    w.write(block.label.toUpperCase(), 9, 'bold', 14, true);
    for (const paragraph of block.paragraphs) {
      doc.setFont('times', 'normal');
      doc.setFontSize(BODY);
      const lines = doc.splitTextToSize(paragraph.text, PDF_WIDTH) as string[];
      const marks = mergeMarks(paragraph.marks);
      let cursor = 0;
      for (const line of lines) {
        w.ensureSpace(LEADING);
        // `ensureSpace` may have changed the page's font (the footer): set it again.
        doc.setFont('times', 'normal');
        doc.setFontSize(BODY);
        const from = paragraph.text.indexOf(line, cursor);
        const lineFrom = from === -1 ? cursor : from;
        const lineTo = lineFrom + line.length;
        cursor = lineTo;
        for (const [mFrom, mTo] of marks) {
          const a = Math.max(mFrom, lineFrom);
          const b = Math.min(mTo, lineTo);
          if (a >= b) continue;
          const x = PDF_MARGIN + doc.getTextWidth(line.slice(0, a - lineFrom));
          const width = doc.getTextWidth(line.slice(a - lineFrom, b - lineFrom));
          doc.setFillColor(...MARK_FILL);
          doc.rect(x, w.y - BODY * 0.85, width, BODY * 1.1, 'F');
        }
        doc.text(line, PDF_MARGIN, w.y);
        w.y += LEADING;
      }
      for (const note of paragraph.notes) w.write(`Nota: ${note}`, 9, 'italic', 12, true);
      w.y += 6;
    }
  }

  if (model.freeNotes.length > 0) {
    w.ensureSpace(48);
    w.y += 10;
    w.write('Note sulla decisione', 11, 'bold', 16);
    model.freeNotes.forEach((item) => { w.write(item, 10, 'normal', 13); w.y += 4; });
  }

  if (model.unmatched.length > 0) {
    w.ensureSpace(48);
    w.y += 10;
    w.write('Non ritrovate nel testo attuale', 11, 'bold', 16);
    model.unmatched.forEach((item) => w.write(item, 9, 'normal', 12, true));
  }

  w.footer();
  return doc;
}
