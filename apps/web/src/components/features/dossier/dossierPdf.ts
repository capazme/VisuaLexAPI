import type { DossierItem } from '../../../types';
import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { getRubricText, parseArticleStructure } from '../../../utils/articleStructure';
import { describeVersion, historicalItemLabel } from '../../../utils/versionDisplay';
import { articleLabel, layoutDossier } from './dossierLayout';

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
  const by = note.createdBy ? ` (scritta da ${note.createdBy.clientName?.trim() || "un'applicazione collegata"})` : '';
  return `${String(note.data)}${by}`;
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
