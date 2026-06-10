import { describe, it, expect } from 'vitest';
import { normalizeGraphUrn } from '../../../src/services/merlt/graphClient';

/**
 * Anti-regressione (vedi CLAUDE.md "URN version-marker mismatch"):
 * il seed del grafo MEMORIZZA la forma URL Normattiva COMPLETA, wrapper incluso.
 * `normalizeGraphUrn` deve strippare SOLO il marker `!vig=`/`!orig=`, MAI il
 * wrapper URL — altrimenti il match col seed fallisce sempre.
 */
describe('normalizeGraphUrn — strip ONLY the NIR version marker', () => {
  it('preserves the full Normattiva URL wrapper', () => {
    const url = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:costituzione~art1';
    expect(normalizeGraphUrn(url)).toBe(url);
  });

  it('strips the !vig= version marker, keeping the wrapper', () => {
    expect(
      normalizeGraphUrn(
        'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:codice.civile:1942~art2043!vig=',
      ),
    ).toBe('https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:codice.civile:1942~art2043');
  });

  it('strips !orig=… too (same NIR marker family)', () => {
    expect(
      normalizeGraphUrn(
        'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:costituzione~art1!orig=1947',
      ),
    ).toBe('https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:costituzione~art1');
  });

  it('leaves a bare canonical NIR urn unchanged (no wrapper, no marker)', () => {
    const bare = 'urn:nir:stato:codice.civile:1942~art2043';
    expect(normalizeGraphUrn(bare)).toBe(bare);
  });

  it('strips the marker on a bare NIR urn too', () => {
    expect(normalizeGraphUrn('urn:nir:stato:costituzione~art1!vig=')).toBe(
      'urn:nir:stato:costituzione~art1',
    );
  });
});
