import { describe, it, expect } from 'vitest';
import { isArticleCenter, isOpenableResult, resolveCenterNodeId } from '../graphCenter';
import type { GraphSearchItem } from '../../shared/types';

/** Same NIR version-marker strip GraphExplorerPage uses (gotcha #6). */
function stripVersionMarker(u: string): string {
  const i = u.indexOf('!');
  return i === -1 ? u : u.slice(0, i);
}

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

describe('resolveCenterNodeId (audit item 3 — canon anchoring null-safe)', () => {
  const nodes = [
    { id: 'n1', urn: 'urn:nir:stato:codice.civile~art2043' },
    { id: 'n2', urn: 'urn:nir:stato:codice.civile~art2059!vig=2024-01-01' },
  ];

  it('returns the first node when there is no urn to resolve against', () => {
    expect(resolveCenterNodeId(nodes, null, stripVersionMarker)).toBe('n1');
    expect(resolveCenterNodeId(nodes, undefined, stripVersionMarker)).toBe('n1');
  });

  it('returns null for an empty node list regardless of urn', () => {
    expect(resolveCenterNodeId([], 'urn:x', stripVersionMarker)).toBeNull();
  });

  it('matches a node whose urn is EXACTLY equal', () => {
    expect(resolveCenterNodeId(nodes, 'urn:nir:stato:codice.civile~art2043', stripVersionMarker)).toBe('n1');
  });

  it('matches a node after stripping the !vig= version marker on either side (gotcha #6)', () => {
    // Page urn carries the marker, node urn does not.
    expect(
      resolveCenterNodeId(nodes, 'urn:nir:stato:codice.civile~art2043!vig=2024-01-01', stripVersionMarker)
    ).toBe('n1');
    // Node urn carries the marker, page urn does not.
    expect(resolveCenterNodeId(nodes, 'urn:nir:stato:codice.civile~art2059', stripVersionMarker)).toBe('n2');
  });

  it('returns null (never nodes[0]) when the urn matches no node, even after stripping the marker', () => {
    expect(resolveCenterNodeId(nodes, 'urn:nir:stato:codice.civile~art9999', stripVersionMarker)).toBeNull();
    expect(
      resolveCenterNodeId(nodes, 'urn:nir:stato:codice.civile~art9999!vig=2024-01-01', stripVersionMarker)
    ).toBeNull();
  });
});
