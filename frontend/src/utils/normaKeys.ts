import type { NormaVisitata } from '../types';

const sanitize = (str: string) => str.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();

/**
 * Store-level norm+article key. MUST stay byte-identical to the memo that
 * lived in ArticleTabContent — annotations/highlights are keyed on it, so a
 * drift would orphan every existing annotation.
 */
export function buildItemKey(norma: NormaVisitata): string {
  const parts = [norma.tipo_atto];
  if (norma.numero_atto?.trim()) parts.push(norma.numero_atto);
  if (norma.data?.trim()) parts.push(norma.data);
  if (norma.allegato?.trim()) parts.push(`all${norma.allegato}`);
  if (norma.numero_articolo?.trim()) parts.push(norma.numero_articolo);
  return parts.map(part => sanitize(part || '')).join('--');
}

/**
 * Per-article unique identifier used throughout the app to distinguish
 * articles living in the main body from those in annexes.
 * Format: `all{allegato}:{numero}` when the article belongs to an annex,
 * plain `{numero}` otherwise.
 */
export function uniqueArticleIdFromNorma(
  norma: Pick<NormaVisitata, 'allegato' | 'numero_articolo'>,
): string {
  return norma.allegato ? `all${norma.allegato}:${norma.numero_articolo}` : norma.numero_articolo;
}
