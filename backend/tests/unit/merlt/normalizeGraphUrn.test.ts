import { describe, it, expect } from 'vitest';
import { normalizeGraphUrn } from '../../../src/services/merlt/graphClient';

// The seed AND VisuaLex key Norma nodes by the FULL Normattiva URL form, and
// MERL-T matches on exact URN/node_id equality. normalizeGraphUrn must drop
// ONLY the NIR version marker (from the first "!") and PRESERVE the URL wrapper
// — stripping the wrapper makes every seeded article unmatchable.
describe('normalizeGraphUrn — strip only the version marker, keep the seed key form', () => {
  const FULL =
    'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043';

  it('leaves the full Normattiva URL form unchanged (the seed/VisuaLex key)', () => {
    expect(normalizeGraphUrn(FULL)).toBe(FULL);
  });

  it('strips the version marker (!vig=) but keeps the URL wrapper', () => {
    expect(normalizeGraphUrn(`${FULL}!vig=`)).toBe(FULL);
  });

  it('strips the version marker on a bare NIR urn too', () => {
    expect(normalizeGraphUrn('urn:nir:stato:codice.civile:1942~art2043!vig=')).toBe(
      'urn:nir:stato:codice.civile:1942~art2043',
    );
  });

  it('leaves a marker-less urn unchanged (bare or wrapped)', () => {
    const bare = 'urn:nir:stato:codice.civile:1942~art2043';
    expect(normalizeGraphUrn(bare)).toBe(bare);
  });
});
