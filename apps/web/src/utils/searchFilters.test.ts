import { describe, expect, it } from 'vitest';
import { matchesSearchFilters } from './searchFilters';
import type { ArticleData } from '../types';

const article = (overrides: Partial<ArticleData> = {}): ArticleData => ({
  norma_data: {
    tipo_atto: 'legge',
    data: '2020-01-01',
    numero_articolo: '1',
  },
  article_text: 'testo',
  ...overrides,
});

describe('matchesSearchFilters', () => {
  it('accepts an article when no filters are provided', () => {
    expect(matchesSearchFilters(article())).toBe(true);
  });

  it('filters EUR-Lex acts separately from Normattiva acts', () => {
    expect(matchesSearchFilters(article({ norma_data: { ...article().norma_data, tipo_atto: 'regolamento UE' } }), {
      source: 'eurlex', onlyHistorical: false,
    })).toBe(true);
    expect(matchesSearchFilters(article(), {
      source: 'eurlex', onlyHistorical: false,
    })).toBe(false);
  });

  it('supports the historical filter', () => {
    expect(matchesSearchFilters(article({ versionInfo: { isHistorical: true } }), {
      source: 'all', onlyHistorical: true,
    })).toBe(true);
    expect(matchesSearchFilters(article(), {
      source: 'all', onlyHistorical: true,
    })).toBe(false);
  });

  it('filters by year range', () => {
    expect(matchesSearchFilters(article(), { source: 'all', onlyHistorical: false, yearFrom: 2019, yearTo: 2021 })).toBe(true);
    expect(matchesSearchFilters(article(), { source: 'all', onlyHistorical: false, yearFrom: 2021 })).toBe(false);
  });
});
