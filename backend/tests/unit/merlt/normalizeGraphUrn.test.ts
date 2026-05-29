import { describe, it, expect } from 'vitest';
import { normalizeGraphUrn } from '../../../src/services/merlt/graphClient';

describe('normalizeGraphUrn — VisuaLex urn → seed-canonical NIR', () => {
  it('strips the URL wrapper VisuaLex stores around the urn:nir form', () => {
    expect(
      normalizeGraphUrn(
        'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:costituzione~art1',
      ),
    ).toBe('urn:nir:stato:costituzione~art1');
  });

  it('strips the version marker (!vig= / !orig=)', () => {
    expect(normalizeGraphUrn('urn:nir:stato:codice.civile:1942~art2043!vig=')).toBe(
      'urn:nir:stato:codice.civile:1942~art2043',
    );
  });

  it('strips BOTH URL wrapper AND version marker together (the real VisuaLex shape)', () => {
    expect(
      normalizeGraphUrn(
        'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:costituzione~art1!vig=',
      ),
    ).toBe('urn:nir:stato:costituzione~art1');
  });

  it('leaves a bare canonical NIR urn unchanged', () => {
    const bare = 'urn:nir:stato:codice.civile:1942~art2043';
    expect(normalizeGraphUrn(bare)).toBe(bare);
  });

  it('does not chop a urn that starts at index 0 (no wrapper)', () => {
    // `urn:nir:` is at index 0 → urnStart > 0 is false → no slice.
    expect(normalizeGraphUrn('urn:nir:stato:costituzione~art2')).toBe(
      'urn:nir:stato:costituzione~art2',
    );
  });
});
