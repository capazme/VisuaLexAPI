import type { ArticleData, SearchFilters } from '../types';

function yearOf(value?: string): number | null {
  if (!value) return null;
  const match = value.match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function sourceOf(article: ArticleData): SearchFilters['source'] {
  const actType = (article.norma_data?.tipo_atto || '').toLowerCase();
  if (actType.includes('regolamento ue') || actType.includes('direttiva') || actType.includes('eur')) {
    return 'eurlex';
  }
  return 'normattiva';
}

/** Returns true when a streamed article satisfies all selected filters. */
export function matchesSearchFilters(article: ArticleData, filters?: SearchFilters): boolean {
  if (!filters) return true;

  if (filters.source !== 'all' && sourceOf(article) !== filters.source) return false;
  if (filters.onlyHistorical && !article.versionInfo?.isHistorical) return false;

  const year = yearOf(article.norma_data?.data_versione || article.norma_data?.data);
  if (filters.yearFrom && (year === null || year < filters.yearFrom)) return false;
  if (filters.yearTo && (year === null || year > filters.yearTo)) return false;

  return true;
}

export function defaultSearchFilters(): SearchFilters {
  return {
    source: 'all',
    onlyHistorical: false,
  };
}

/**
 * How many of the palette's filters narrow a search: the source, «Solo versioni storiche», and the
 * years (one filter, from either end or both).
 */
export function countActiveFilters(filters: SearchFilters): number {
  return (filters.source !== 'all' ? 1 : 0)
    + (filters.onlyHistorical ? 1 : 0)
    + (filters.yearFrom !== undefined || filters.yearTo !== undefined ? 1 : 0);
}

/** The filters' state in words, beside their disclosure: «Nessun filtro», «1 filtro attivo», «2 filtri attivi». */
export function activeFiltersLabel(filters: SearchFilters): string {
  const count = countActiveFilters(filters);
  if (count === 0) return 'Nessun filtro';
  return count === 1 ? '1 filtro attivo' : `${count} filtri attivi`;
}
