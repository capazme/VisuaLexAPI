import { describe, it, expect } from 'vitest';
import { deriveProvenance } from '../types';
import { PROVENANCE_STYLE } from '../graphStyles';
import { provenanceMeta } from '../../../qa/format';

/**
 * `confirmed` is what the co-evolution promotion engine and the provisional
 * review write; it used to fall into the `seed` bucket ("Corpus") on /grafo
 * and into the grey "unknown" chip on the Q&A sources.
 */
describe('confirmed provenance', () => {
  it('is derived as its own value, not folded into seed', () => {
    expect(deriveProvenance({ properties: { provenance: 'confirmed' } })).toBe('confirmed');
    expect(deriveProvenance({ properties: { provenance: 'live_unconfirmed' } })).toBe('live_unconfirmed');
  });

  it('has a canvas style and a Q&A chip descriptor', () => {
    expect(PROVENANCE_STYLE.confirmed.lineWidth).toBeGreaterThan(PROVENANCE_STYLE.seed.lineWidth);
    expect(provenanceMeta('confirmed').label).toMatch(/confermata/);
    expect(provenanceMeta('confirmed').stripe).not.toBe('bg-slate-300');
  });
});
