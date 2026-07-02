import { describe, it, expect } from 'vitest';
import { isArticleCenter, isOpenableResult } from '../graphCenter';
import type { GraphSearchItem } from '../../shared/types';

describe('isArticleCenter (C1/C2)', () => {
  it('classifies a Norma type as an article (case-insensitive)', () => {
    expect(isArticleCenter('Norma', null)).toBe(true);
    expect(isArticleCenter('norma', undefined)).toBe(true);
  });

  it('classifies concept types as NOT articles', () => {
    expect(isArticleCenter('ConcettoGiuridico', 'concetto:colpa')).toBe(false);
    expect(isArticleCenter('DefinizioneLegale', undefined)).toBe(false);
    expect(isArticleCenter('PrincipioGiuridico', null)).toBe(false);
  });

  it('falls back to the ~art urn marker when no type is given (deeplink)', () => {
    expect(isArticleCenter(null, 'urn:nir:stato:codice.civile~art2043')).toBe(true);
    expect(isArticleCenter(undefined, 'urn:nir:stato:codice.civile~art467-bis')).toBe(true);
  });

  it('a concept urn without the ~art marker is not an article', () => {
    expect(isArticleCenter(null, 'concetto:colpa')).toBe(false);
    expect(isArticleCenter(undefined, undefined)).toBe(false);
  });
});

describe('isOpenableResult (C4)', () => {
  const item = (id: string): GraphSearchItem => ({ id, nome: id, tipo: 'Norma' });

  it('drops live: leaked node ids (case-insensitive)', () => {
    expect(isOpenableResult(item('live:abc'))).toBe(false);
    expect(isOpenableResult(item('LIVE:abc'))).toBe(false);
  });

  it('keeps real graph results', () => {
    expect(isOpenableResult(item('norma:2043'))).toBe(true);
    expect(isOpenableResult(item('concetto:colpa'))).toBe(true);
  });
});
