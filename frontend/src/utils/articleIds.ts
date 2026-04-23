import type { ArticleData } from '../types';

/**
 * Build the per-article unique identifier used throughout the app to
 * distinguish articles living in the main body from those in annexes.
 * Format: `all{allegato}:{numero}` when the article belongs to an annex,
 * plain `{numero}` otherwise.
 */
export function getUniqueArticleId(article: ArticleData): string {
  const { allegato, numero_articolo } = article.norma_data;
  return allegato ? `all${allegato}:${numero_articolo}` : numero_articolo;
}

/**
 * Project the list of loaded unique IDs down to plain article numbers
 * that belong to the current annex context. When `currentAnnex` is null
 * we only keep dispositivo entries (no `allN:` prefix); otherwise we
 * keep only the entries for that specific annex and strip the prefix.
 */
export function filterLoadedIdsForAnnex(
  loadedIds: readonly string[],
  currentAnnex: string | null,
): string[] {
  return loadedIds
    .filter(id => currentAnnex ? id.startsWith(`all${currentAnnex}:`) : !id.includes(':'))
    .map(id => id.includes(':') ? id.split(':').pop()! : id);
}
