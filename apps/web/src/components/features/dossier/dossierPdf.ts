import { jsPDF } from 'jspdf';
import type { DossierItem } from '../../../types';
import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { getRubricText, parseArticleStructure } from '../../../utils/articleStructure';
import { describeVersion, historicalItemLabel } from '../../../utils/versionDisplay';
import { articleLabel, layoutDossier } from './dossierLayout';
import { PDF_MARGIN, createPdfWriter } from '../../../utils/pdfWriter';
import { claudeMarkSentence } from './dossierUtils';

/**
 * The dossier's PDF as the page is (spec §9): the notes, then each act named
 * once with its articles beneath it. Each article carries the text the reader
 * shows, fetched through the session cache — a stored `article_text` is never
 * used, because items added through MCP or «Importa da norma» have none.
 */

export interface PdfArticle {
  label: string;
  /** The notes about this article, each with who wrote it when an application did. */
  notes: string[];
  rubrica: string | null;
  versionLabel: string | null;
  text: string;
  missing: 'none' | 'blocked' | 'unavailable';
}

export type PdfBlock =
  | { kind: 'notes'; notes: string[] }
  | { kind: 'act'; heading: string; title: string | null; articles: PdfArticle[] };

export interface LoadedText {
  text: string | null;
  blockedReason?: string;
  rubrica?: string | null;
}

export const PDF_TEXT_UNAVAILABLE = 'Testo non disponibile al momento';

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
        ? { text: raw, rubrica: raw ? getRubricText(raw, parseArticleStructure(raw)) : null }
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

/** The PDF's sections; `titles` maps an act's key to its title (none for a code). */
export function buildPdfBlocks(
  items: DossierItem[],
  texts: Map<string, LoadedText>,
  titles: Map<string, string | null>,
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
        if (loaded?.text) return { ...base, text: plain(loaded.text), missing: 'none' };
        if (loaded?.blockedReason) return { ...base, text: loaded.blockedReason, missing: 'blocked' };
        return { ...base, text: PDF_TEXT_UNAVAILABLE, missing: 'unavailable' };
      }),
    });
  }
  return blocks;
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
      write(article.text, 9, article.missing === 'none' ? 'normal' : 'italic', 12, article.missing !== 'none');
      w.y += 10;
    });
    w.y += 8;
  });

  w.footer();
  return doc;
}
