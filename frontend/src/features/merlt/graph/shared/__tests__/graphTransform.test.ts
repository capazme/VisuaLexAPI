import { describe, it, expect } from 'vitest';
import { transformSubgraphResponse } from '../graphTransform';
import type { SubgraphResponse } from '../types';

function resp(partial: Partial<SubgraphResponse>): SubgraphResponse {
  return { nodes: [], edges: [], ...partial };
}

describe('transformSubgraphResponse (G6 GraphData)', () => {
  it('maps nodes to G6 node items carrying id + data{label,type,urn}', () => {
    const out = transformSubgraphResponse(
      resp({
        nodes: [
          { id: 'norma:2043', urn: 'urn:...;2043', type: 'Norma', label: 'Art. 2043 c.c.' },
        ],
      })
    );

    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0].id).toBe('norma:2043');
    expect(out.nodes[0].data).toMatchObject({
      label: 'Art. 2043 c.c.',
      type: 'Norma',
      urn: 'urn:...;2043',
    });
    expect(out.edges).toHaveLength(0);
  });

  it('maps edges to G6 edge items with id/source/target + data{label,type}', () => {
    const out = transformSubgraphResponse(
      resp({
        nodes: [
          { id: 'a', type: 'Norma', label: 'A' },
          { id: 'b', type: 'Principio', label: 'B' },
        ],
        edges: [{ id: 'e1', source: 'a', target: 'b', type: 'ESPRIME_PRINCIPIO' }],
      })
    );

    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({ id: 'e1', source: 'a', target: 'b' });
    expect(out.edges[0].data).toMatchObject({ type: 'ESPRIME_PRINCIPIO', label: 'ESPRIME_PRINCIPIO' });
  });

  it('drops edges whose source or target node is absent', () => {
    const out = transformSubgraphResponse(
      resp({
        nodes: [{ id: 'a', type: 'Norma', label: 'A' }],
        edges: [
          { id: 'e-ok', source: 'a', target: 'a', type: 'X' },
          { id: 'e-bad-target', source: 'a', target: 'ghost', type: 'X' },
          { id: 'e-bad-source', source: 'ghost', target: 'a', type: 'X' },
        ],
      })
    );

    expect(out.edges.map((e) => e.id)).toEqual(['e-ok']);
  });

  it('de-duplicates nodes sharing the same id', () => {
    const out = transformSubgraphResponse(
      resp({
        nodes: [
          { id: 'dup', type: 'Norma', label: 'first' },
          { id: 'dup', type: 'Norma', label: 'second' },
        ],
      })
    );

    expect(out.nodes).toHaveLength(1);
  });

  it('synthesizes a stable edge id when the source edge has none', () => {
    const out = transformSubgraphResponse(
      resp({
        nodes: [
          { id: 'a', type: 'Norma', label: 'A' },
          { id: 'b', type: 'Norma', label: 'B' },
        ],
        edges: [{ source: 'a', target: 'b', type: 'DISCIPLINA' } as never],
      })
    );

    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].id).toBe('a-DISCIPLINA-b');
  });

  it('returns empty arrays for an empty response', () => {
    const out = transformSubgraphResponse(resp({}));
    expect(out.nodes).toEqual([]);
    expect(out.edges).toEqual([]);
  });
});
