import { describe, it, expect } from 'vitest';
import { computeTypeCounts } from '../graphFilters';
import type { GraphElements } from '../graphTransform';

function elements(partial: Partial<GraphElements>): GraphElements {
  return { nodes: [], edges: [], ...partial };
}

describe('computeTypeCounts', () => {
  it('counts node and edge types, sorted by count desc', () => {
    const out = computeTypeCounts(
      elements({
        nodes: [
          { id: 'a', data: { type: 'Norma' } },
          { id: 'b', data: { type: 'Norma' } },
          { id: 'c', data: { type: 'ConcettoGiuridico' } },
        ],
        edges: [
          { id: 'e1', source: 'a', target: 'b', data: { type: 'DISCIPLINA' } },
          { id: 'e2', source: 'a', target: 'c', data: { type: 'APPLICA_A' } },
          { id: 'e3', source: 'b', target: 'c', data: { type: 'APPLICA_A' } },
        ],
      })
    );

    expect(out.nodes).toEqual([
      { type: 'Norma', count: 2 },
      { type: 'ConcettoGiuridico', count: 1 },
    ]);
    expect(out.edges).toEqual([
      { type: 'APPLICA_A', count: 2 },
      { type: 'DISCIPLINA', count: 1 },
    ]);
  });

  it('ignores items with no type', () => {
    const out = computeTypeCounts(
      elements({ nodes: [{ id: 'a', data: {} }, { id: 'b' }] })
    );
    expect(out.nodes).toEqual([]);
  });

  it('returns empty for empty input', () => {
    const out = computeTypeCounts(elements({}));
    expect(out.nodes).toEqual([]);
    expect(out.edges).toEqual([]);
  });
});
