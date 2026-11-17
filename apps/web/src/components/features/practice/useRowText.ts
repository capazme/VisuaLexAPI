import { useEffect } from 'react';
import { appStore, useAppStore } from '../../../store/useAppStore';
import type { ArticleData } from '../../../types';
import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { articleRowKey, isBoundPractice, practiceArticleKey } from '../../../utils/practice';

/** The rows whose text is being asked for: one request per row, however many readers mount it meanwhile. */
const asking = new Set<string>();

/** Where a bound row's text is (LC54): coming, or failed; null when there is nothing to say (a Corpus row, a text there). */
export type RowTextState = 'loading' | 'failed' | null;

/**
 * A bound table's row is built without its text (LC51 c1): read — its row open, its window, the phone's reader — it
 * asks for it once and keeps it in the row (`setPracticeArticleText`); a failed load leaves its `error` there, so it is
 * not asked again until «Riprova» (`retryRowText`). A Corpus row always came with its text, or with its error, and asks
 * nothing. Returns what the reader shows in the text's place meanwhile.
 */
export function useRowText(practiceId: string, actId: string, article: ArticleData | undefined, reading: boolean): RowTextState {
  const bound = useAppStore((s) => s.practices.some((p) => p.id === practiceId && isBoundPractice(p)));
  const missing = reading && bound && !!article && !article.article_text && !article.error;
  const norma = article?.norma_data;
  useEffect(() => {
    if (!missing || !norma) return;
    const articleKey = practiceArticleKey({ norma_data: norma });
    const key = articleRowKey(practiceId, actId, articleKey);
    if (asking.has(key)) return;
    asking.add(key);
    const put = (loaded: ArticleData) => appStore.getState().setPracticeArticleText(practiceId, actId, articleKey, loaded);
    fetchArticleForNorma(norma)
      .then(put, (e: unknown) => put({ norma_data: norma, error: e instanceof Error ? e.message : 'Testo non disponibile' }))
      .finally(() => asking.delete(key));
  }, [missing, norma, practiceId, actId]);
  if (!bound || !article || article.article_text) return null;
  return article.error ? 'failed' : 'loading';
}

/** «Riprova»: the row loses its error, so the reader reading it asks for the text again. */
export function retryRowText(practiceId: string, actId: string, article: ArticleData): void {
  appStore.getState().setPracticeArticleText(practiceId, actId, practiceArticleKey(article), { norma_data: article.norma_data });
}
