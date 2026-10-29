import type { DossierItem } from '../../../types';
import { annotationService } from '../../../services/annotationService';
import { highlightService } from '../../../services/highlightService';
import { decisionKey, identityOf } from '../../../utils/decisionLinks';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { annotationApiToStore, articleRootOf, buildWireNormaKeyPrefix, highlightApiToStore } from '../../../utils/storeApiMappers';
import type { PdfMarks } from './dossierPdf';
import { isRemovalPending } from '../../../store/deferredRemovals';

// A decision's highlights and notes are stored under its key with no article, as the reading surface does.
const NO_ARTICLE = '';
const LOADS_AT_ONCE = 6;

interface Wanted {
  itemId: string;
  normaKey: string;
  articleId: string;
}

/**
 * The reader's highlights and notes for the PDF, by item id: the articles' when `articles` is set
 * (only «solo le parti» prints them), and those of the chosen decisions. Read from the server with the
 * store's own wire prefix and mappers, then filtered as the readers filter them: the article's
 * `buildItemKey` and `uniqueArticleIdFromNorma`, the decision's `decisionKey` with no article.
 *
 * Not through the store's `load…ForArticle`: those swallow a failure (a 429 says nothing) and return
 * at once while a reader's own load of the same article is still on its way, and either would print
 * «Nessuna parte evidenziata o annotata» over a text that has some. A text whose marks could not be
 * read is `unavailable`, and the PDF says so.
 */
export async function loadPdfMarks(
  items: DossierItem[],
  options: { articles: boolean; decisionIds: ReadonlySet<string> },
): Promise<Map<string, PdfMarks>> {
  const wanted: Wanted[] = [];
  for (const item of items) {
    if (item.type === 'norma' && options.articles) {
      wanted.push({ itemId: item.id, normaKey: buildItemKey(item.data), articleId: uniqueArticleIdFromNorma(item.data) });
    } else if (item.type === 'sentenza' && options.decisionIds.has(item.id)) {
      wanted.push({ itemId: item.id, normaKey: decisionKey(identityOf(item.data)), articleId: NO_ARTICLE });
    }
  }
  const marks = new Map<string, PdfMarks>();
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const { itemId, normaKey, articleId } = wanted[next++];
      const prefix = buildWireNormaKeyPrefix(normaKey, articleRootOf(articleId));
      try {
        const [highlights, notes] = await Promise.all([
          highlightService.getByNormaKeyPrefix(prefix),
          annotationService.getByNormaKeyPrefix(prefix),
        ]);
        marks.set(itemId, {
          // A mark removed and still waiting behind «Annulla» is the server's for a few seconds more: never in a PDF or
          // a Forum publication (`deferredRemovals`).
          highlights: highlights.map(highlightApiToStore)
            .filter((h) => h.normaKey === normaKey && h.articleId === articleId && !isRemovalPending(`highlight:${h.id}`)),
          notes: notes.map(annotationApiToStore)
            .filter((a) => a.normaKey === normaKey && a.articleId === articleId && !isRemovalPending(`annotation:${a.id}`)),
        });
      } catch (err) {
        console.error('PDF: highlights and notes unavailable for', normaKey, err);
        marks.set(itemId, { highlights: [], notes: [], unavailable: true });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOADS_AT_ONCE, wanted.length) }, worker));
  return marks;
}
