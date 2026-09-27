import { describe, it, expect } from 'vitest';
import { MAX_EMPTY_STATE_SOURCES, pickEmptyStateSources } from '../emptyStateSources';
import type { QaRetrievedSource } from '../../../qa/types';

function source(overrides: Partial<QaRetrievedSource>): QaRetrievedSource {
  return { urn: 'urn:x', provenance: 'seed', trust: 0.8, node_id: null, ...overrides };
}

describe('pickEmptyStateSources (audit item 2)', () => {
  it('returns sources as-is when under the cap', () => {
    const sources = [source({ urn: 'urn:a' }), source({ urn: 'urn:b' })];
    expect(pickEmptyStateSources(sources)).toEqual(sources);
  });

  it('dedupes by node_id when present, else by urn', () => {
    const sources = [
      source({ urn: 'urn:a', node_id: 'n1' }),
      source({ urn: 'urn:a', node_id: 'n1' }), // exact duplicate (node_id)
      source({ urn: 'urn:b', node_id: null }),
      source({ urn: 'urn:b', node_id: null }), // exact duplicate (urn fallback)
    ];
    const picked = pickEmptyStateSources(sources);
    expect(picked).toHaveLength(2);
    expect(picked.map((s) => s.node_id ?? s.urn)).toEqual(['n1', 'urn:b']);
  });

  it('caps at the given max, default MAX_EMPTY_STATE_SOURCES', () => {
    const sources = Array.from({ length: 10 }, (_, i) => source({ urn: `urn:${i}` }));
    expect(pickEmptyStateSources(sources)).toHaveLength(MAX_EMPTY_STATE_SOURCES);
    expect(pickEmptyStateSources(sources, 3)).toHaveLength(3);
  });

  it('returns an empty array for no sources', () => {
    expect(pickEmptyStateSources([])).toEqual([]);
  });
});
