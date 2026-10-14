import type { DossierItem } from '../../../types';
import { appStore } from '../../../store/useAppStore';
import { decisionKey, identityOf } from '../../../utils/decisionLinks';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import type { PdfMarks } from './dossierPdf';

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
 * (only «solo le parti» prints them), and those of the chosen decisions. They are loaded through the
 * store's own actions (the reading surfaces do the same, and a row never opened holds none) and read
 * back from the store filtered as the readers filter them: the article's `buildItemKey` and
 * `uniqueArticleIdFromNorma`, the decision's `decisionKey` with no article.
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
  const { loadAnnotationsForArticle, loadHighlightsForArticle } = appStore.getState();
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const { normaKey, articleId } = wanted[next++];
      await Promise.all([loadHighlightsForArticle(normaKey, articleId), loadAnnotationsForArticle(normaKey, articleId)]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOADS_AT_ONCE, wanted.length) }, worker));

  const { highlights, annotations } = appStore.getState();
  const marks = new Map<string, PdfMarks>();
  for (const { itemId, normaKey, articleId } of wanted) {
    marks.set(itemId, {
      highlights: highlights.filter((h) => h.normaKey === normaKey && h.articleId === articleId),
      notes: annotations.filter((a) => a.normaKey === normaKey && a.articleId === articleId),
    });
  }
  return marks;
}
