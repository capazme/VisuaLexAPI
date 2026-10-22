import { jsPDF } from 'jspdf';
import type { Annotation, DossierItem, Highlight } from '../../../types';
import type { FoundDecision } from '../../../types/decisions';
import { resolveAnchors } from '../../../utils/articleAnnotations';
import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { getRubricText, parseArticleStructure } from '../../../utils/articleStructure';
import { todayInRome } from '../../../utils/dateUtils';
import { fetchDecisionCached } from '../../../utils/decisionFetchCache';
import { identityOf } from '../../../utils/decisionLinks';
import { isAnchoredNote } from '../../../utils/decisionRender';
import { describeVersion, historicalItemLabel } from '../../../utils/versionDisplay';
import { articleLabel, countsLine, layoutDossier } from './dossierLayout';
import { decisionCitationOf } from './dossierUtils';
import {
  BODY as DECISION_BODY, LEADING as DECISION_LEADING,
  decisionPdfModel, decisionTextBetween, drawDecisionBlocks, drawDecisionHead, drawDecisionTail,
  type DecisionPdfModel,
} from '../decisions/decisionPdf';
import { PDF_MARGIN, createPdfWriter, type PdfFont, type PdfWriter } from '../../../utils/pdfWriter';
import { claudeMarkSentence } from '../../ui/claudeMarkSentence';
import { EXCERPT_GAP, articleTextBetween, excerptParts, type ExcerptPart } from './pdfExcerpts';

/**
 * The dossier's PDF as the page is (spec §9): the notes, then each act named
 * once with its articles beneath it. Each article carries the text the reader
 * shows, fetched through the session cache — a stored `article_text` is never
 * used, because items added through MCP or «Importa da norma» have none.
 *
 * Two things were added on 13 Oct 2026 (spec 2026-10-13-dossier-pdf-decisions-design.md): the
 * selected decisions as «Giurisprudenza» after the acts, and «solo le parti evidenziate e annotate»,
 * which prints for each article and decision the passages the reader marked (`pdfExcerpts.ts`).
 */

export interface PdfArticle {
  label: string;
  /** The notes about this article, each with who wrote it when an application did. */
  notes: string[];
  rubrica: string | null;
  versionLabel: string | null;
  text: string;
  missing: 'none' | 'blocked' | 'unavailable';
  /** «Solo le parti»: the marked passages, printed in place of `text` (empty: nothing is marked). */
  excerpt?: ExcerptPart[];
  /** «Solo le parti»: the reader's marks could not be read, so nothing can be said of them. */
  marksUnavailable?: boolean;
}

/** A decision of the «Giurisprudenza» section. */
export interface PdfDecision {
  /** The dossier's citation of it, which heads it when its text cannot be read. */
  citation: string;
  /** The decision as its own PDF lays it out; null when it could not be read. */
  model: DecisionPdfModel | null;
  /** «Solo le parti»: the marked passages in place of the text (empty: nothing is marked); null in the full text, or when the decision has no text. */
  excerpt: ExcerptPart[] | null;
  /** The reader's marks could not be read: the text is printed without them, and the PDF says so. */
  marksUnavailable?: boolean;
}

export type PdfBlock =
  | { kind: 'notes'; notes: string[] }
  | { kind: 'act'; heading: string; title: string | null; articles: PdfArticle[] }
  | { kind: 'decisions'; heading: string; decisions: PdfDecision[] };

export interface LoadedText {
  text: string | null;
  blockedReason?: string;
  rubrica?: string | null;
  /** A past text takes no marks (gotcha 32): in «solo le parti» it has no passage. */
  readOnly?: boolean;
}

/** A decision read for the PDF: the found answer, or null when it could not be read. */
export type LoadedDecision = FoundDecision | null;

/** The reader's highlights and notes of one text. */
export interface PdfMarks {
  highlights: Highlight[];
  notes: Annotation[];
  /** They could not be read (the server refused or failed): never «nothing marked». */
  unavailable?: boolean;
}

export const PDF_TEXT_UNAVAILABLE = 'Testo non disponibile al momento';
export const PDF_NO_MARKS = 'Nessuna parte evidenziata o annotata';
export const PDF_MARKS_UNAVAILABLE = 'Evidenziazioni e note non disponibili al momento';
export const PDF_DECISIONS_HEADING = 'Giurisprudenza';

// A note as the PDF prints it: its text, then who wrote it when an application did.
function noteLine(note: DossierItem): string {
  return note.createdBy ? `${String(note.data)} (${claudeMarkSentence(note.createdBy)})` : String(note.data);
}

function plain(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Every article's text, as many at a time as the cache allows; a failure is logged and kept as a gap. */
export async function loadDossierTexts(
  items: DossierItem[],
  onProgress: (done: number, total: number) => void,
): Promise<Map<string, LoadedText>> {
  const norms = items.filter((i): i is Extract<DossierItem, { type: 'norma' }> => i.type === 'norma');
  const texts = new Map<string, LoadedText>();
  let done = 0;
  onProgress(0, norms.length);
  await Promise.all(norms.map(async (item) => {
    try {
      const article = await fetchArticleForNorma(item.data);
      // A text that may not be exported (gotcha 32) says why instead.
      const display = describeVersion(article.validity, item.data);
      const raw = article.article_text || '';
      texts.set(item.id, display.canCopyOrSave
        ? { text: raw, rubrica: raw ? getRubricText(raw, parseArticleStructure(raw)) : null, readOnly: display.readOnly }
        : { text: null, blockedReason: display.copyBlockedReason });
    } catch (err) {
      console.error('PDF: article text unavailable for', item.data.urn ?? item.id, err);
      texts.set(item.id, { text: null });
    } finally {
      done += 1;
      onProgress(done, norms.length);
    }
  }));
  return texts;
}

/** The PDF's line of counts: the page's, with only the decisions chosen for it — the others are not printed. */
export function pdfCountsLine(items: DossierItem[], decisionIds: ReadonlySet<string>): string {
  return countsLine(items.filter((item) => item.type !== 'sentenza' || decisionIds.has(item.id)));
}

const DECISION_FETCHES_AT_ONCE = 3;

/**
 * The chosen decisions' texts, through the session cache the reader uses, a few at a time. A failure
 * (or an answer that is not a found decision) is kept as null: the PDF says the text is unavailable.
 */
export async function loadDossierDecisions(
  items: DossierItem[],
  ids: ReadonlySet<string>,
  onProgress: (done: number, total: number) => void,
): Promise<Map<string, LoadedDecision>> {
  const chosen = items.filter((i): i is Extract<DossierItem, { type: 'sentenza' }> => i.type === 'sentenza' && ids.has(i.id));
  const loaded = new Map<string, LoadedDecision>();
  let done = 0;
  let next = 0;
  onProgress(0, chosen.length);
  const worker = async () => {
    while (next < chosen.length) {
      const item = chosen[next++];
      try {
        const answer = await fetchDecisionCached(identityOf(item.data));
        loaded.set(item.id, answer.esito === 'trovata' ? answer : null);
      } catch (err) {
        console.error('PDF: decision unavailable for', decisionCitationOf(item.data), err);
        loaded.set(item.id, null);
      }
      done += 1;
      onProgress(done, chosen.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DECISION_FETCHES_AT_ONCE, chosen.length) }, worker));
  return loaded;
}

export interface PdfBuildOptions {
  /** «Solo le parti evidenziate e annotate»: the marked passages in place of the texts. */
  excerpts?: boolean;
  /** The reader's marks by item id: the articles' (only needed in excerpt mode) and the decisions'. */
  marks?: Map<string, PdfMarks>;
  /** The decisions to print, by item id (the dossier's order is kept); none when absent. */
  decisions?: Map<string, LoadedDecision>;
  /** ISO day written in each decision's source line («Fonte: … · consultata il …»); today in Rome by default. */
  consultedOn?: string;
}

const NO_MARKS: PdfMarks = { highlights: [], notes: [] };

/** An article's marked passages: anchors over `article_text` without its `\n`, the passages cut from the stored text. */
function articleExcerpt(raw: string, marks: PdfMarks): ExcerptPart[] {
  const { length, textBetween } = articleTextBetween(raw);
  // `resolveAnchors` itself passes over a note with no offset or no quoted text.
  const anchors = resolveAnchors(raw.replace(/\n/g, ''), marks.highlights, marks.notes);
  return excerptParts(length, anchors, textBetween);
}

function pdfDecision(item: Extract<DossierItem, { type: 'sentenza' }>, answer: LoadedDecision, options: PdfBuildOptions): PdfDecision {
  const citation = decisionCitationOf(item.data);
  if (!answer) return { citation, model: null, excerpt: null };
  const marks = options.marks?.get(item.id) ?? NO_MARKS;
  const model = decisionPdfModel(answer, {
    consultedOn: options.consultedOn ?? todayInRome(),
    annotations: { highlights: marks.highlights, notes: marks.notes },
  });
  let excerpt: ExcerptPart[] | null = null;
  if (options.excerpts) {
    const { projection, length, textBetween } = decisionTextBetween(answer.testo);
    if (length > 0) {
      const anchors = resolveAnchors(projection, marks.highlights, marks.notes.filter(isAnchoredNote));
      excerpt = excerptParts(length, anchors, textBetween);
    }
  }
  return { citation, model, excerpt, ...(marks.unavailable ? { marksUnavailable: true } : {}) };
}

/** The PDF's sections; `titles` maps an act's key to its title (none for a code). */
export function buildPdfBlocks(
  items: DossierItem[],
  texts: Map<string, LoadedText>,
  titles: Map<string, string | null>,
  options: PdfBuildOptions = {},
): PdfBlock[] {
  const layout = layoutDossier(items);
  const blocks: PdfBlock[] = [];
  if (layout.notes.length > 0) blocks.push({ kind: 'notes', notes: layout.notes.map(noteLine) });
  for (const act of layout.acts) {
    blocks.push({
      kind: 'act',
      heading: act.heading,
      title: titles.get(act.key) ?? null,
      articles: act.articles.map((item): PdfArticle => {
        const loaded = texts.get(item.id);
        const base = {
          label: articleLabel(item.data),
          notes: (layout.attached.get(item.id) ?? []).map(noteLine),
          rubrica: loaded?.rubrica ?? null,
          versionLabel: historicalItemLabel(item.data),
        };
        if (loaded?.text) {
          const marks = loaded.readOnly ? NO_MARKS : options.marks?.get(item.id) ?? NO_MARKS;
          return {
            ...base, text: plain(loaded.text), missing: 'none',
            ...(options.excerpts ? { excerpt: articleExcerpt(loaded.text, marks) } : {}),
            ...(options.excerpts && marks.unavailable ? { marksUnavailable: true } : {}),
          };
        }
        if (loaded?.blockedReason) return { ...base, text: loaded.blockedReason, missing: 'blocked' };
        return { ...base, text: PDF_TEXT_UNAVAILABLE, missing: 'unavailable' };
      }),
    });
  }
  const chosen = layout.decisions.filter((item) => options.decisions?.has(item.id));
  if (chosen.length > 0) {
    blocks.push({
      kind: 'decisions',
      heading: PDF_DECISIONS_HEADING,
      decisions: chosen.map((item) => pdfDecision(item, options.decisions?.get(item.id) ?? null, options)),
    });
  }
  return blocks;
}

/** How many texts' highlights and notes the PDF could not read (printed as «non disponibili»), for the toast. */
export function countMarksUnavailable(blocks: PdfBlock[]): number {
  return blocks.reduce((n, b) => {
    if (b.kind === 'act') return n + b.articles.filter((a) => a.marksUnavailable).length;
    if (b.kind === 'decisions') return n + b.decisions.filter((d) => d.model && d.marksUnavailable).length;
    return n;
  }, 0);
}

/** How many texts the PDF could not print (an article or a decision), for the toast. */
export function countUnavailable(blocks: PdfBlock[]): number {
  return blocks.reduce((n, b) => {
    if (b.kind === 'act') return n + b.articles.filter((a) => a.missing === 'unavailable').length;
    if (b.kind === 'decisions') return n + b.decisions.filter((d) => d.model === null).length;
    return n;
  }, 0);
}

export interface DossierPdfHeader {
  title: string;
  description?: string;
  tags?: string[];
  /** «3 norme · 1 sentenza»: what the page says under the title. */
  countsLine: string;
  /** The day of the export, already written for the page. */
  exportedOn: string;
}

/** How a text's passages are set: the face and size of the text they are cut from. */
interface ExcerptStyle { font: PdfFont; size: number; leading: number }

/**
 * The passages of «solo le parti»: each passage's text as it is (a `\n` inside it breaks the line),
 * then the notes anchored in it, and «[…]» where text was left out. A text with no passage says so.
 */
function drawExcerpt(w: PdfWriter, parts: ExcerptPart[], style: ExcerptStyle): void {
  if (parts.length === 0) {
    w.write(PDF_NO_MARKS, 9, 'italic', 12, true);
    return;
  }
  for (const part of parts) {
    if (part.kind === 'gap') {
      w.write(EXCERPT_GAP, style.size, 'normal', style.leading, true, style.font);
      continue;
    }
    w.write(part.text, style.size, 'normal', style.leading, false, style.font);
    part.notes.forEach((text) => w.write(`Nota: ${text}`, 9, 'italic', 12, true));
    w.y += 4;
  }
}

function drawPdfDecision(w: PdfWriter, decision: PdfDecision): void {
  const { model, excerpt } = decision;
  if (!model) {
    w.write(decision.citation, 13, 'bold', 18);
    w.write(PDF_TEXT_UNAVAILABLE, 10, 'italic', 14, true);
    return;
  }
  drawDecisionHead(w, model);
  // Its source and the day it was read, which its own PDF carries in the page footer.
  w.write(model.footer, 8, 'normal', 11, true);
  w.y += 4;
  if (decision.marksUnavailable) w.write(PDF_MARKS_UNAVAILABLE, 9, 'italic', 12, true);
  if (excerpt && !decision.marksUnavailable) drawExcerpt(w, excerpt, { font: 'times', size: DECISION_BODY, leading: DECISION_LEADING });
  else if (!excerpt) drawDecisionBlocks(w, model);
  drawDecisionTail(w, model);
}

/** Draws the dossier's PDF: the header, then the sections `buildPdfBlocks` made. */
export function writeDossierPdf(header: DossierPdfHeader, blocks: PdfBlock[]): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const w = createPdfWriter(doc, { footerLeft: `${header.title} · VisuaLex` });
  const { ensureSpace, write } = w;

  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, 595, 12, 'F');
  write(header.title, 22, 'bold', 28);
  write(`Fascicolo normativo · ${header.countsLine} · Esportato il ${header.exportedOn}`, 9, 'normal', 18, true);
  if (header.description) {
    write(header.description, 11, 'italic', 14);
    w.y += 6;
  }
  if (header.tags?.length) write(`Tag: ${header.tags.join(' · ')}`, 9, 'normal', 13, true);
  doc.setDrawColor(190);
  doc.line(PDF_MARGIN, w.y + 4, 551, w.y + 4);
  w.y += 22;

  blocks.forEach((block) => {
    if (block.kind === 'decisions') {
      ensureSpace(48);
      write(block.heading, 14, 'bold', 18);
      w.y += 6;
      block.decisions.forEach((decision) => {
        ensureSpace(48);
        drawPdfDecision(w, decision);
        w.y += 10;
      });
      w.y += 8;
      return;
    }
    if (block.kind === 'notes') {
      ensureSpace(32);
      write('Note', 14, 'bold', 18);
      block.notes.forEach((text) => { write(text, 10, 'normal', 13); w.y += 6; });
      w.y += 10;
      return;
    }
    ensureSpace(48);
    write(block.heading, 14, 'bold', 18);
    if (block.title) write(block.title, 10, 'italic', 13, true);
    w.y += 6;
    block.articles.forEach((article) => {
      ensureSpace(32);
      const head = `${article.label}${article.rubrica ? ` — ${article.rubrica}` : ''}${article.versionLabel ? ` · ${article.versionLabel}` : ''}`;
      write(head, 11, 'bold', 15);
      article.notes.forEach((text) => write(`Nota: ${text}`, 9, 'italic', 12));
      if (article.marksUnavailable) write(PDF_MARKS_UNAVAILABLE, 9, 'italic', 12, true);
      else if (article.excerpt) drawExcerpt(w, article.excerpt, { font: 'helvetica', size: 9, leading: 12 });
      else write(article.text, 9, article.missing === 'none' ? 'normal' : 'italic', 12, article.missing !== 'none');
      w.y += 10;
    });
    w.y += 8;
  });

  w.footer();
  return doc;
}
