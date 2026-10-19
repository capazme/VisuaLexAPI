import { describe, it, expect } from 'vitest';
import { mergeElements, transformSubgraphResponse } from '../graphTransform';
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
    // Audit item 8: the label is humanized for display (canvas + walk caption);
    // `type` stays the raw wire value for style lookups (EDGE_TYPE_STYLE, etc).
    expect(out.edges[0].data).toMatchObject({ type: 'ESPRIME_PRINCIPIO', label: 'Esprime principio' });
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

  it('widens node.data with provenance/trust/properties for the canvas', () => {
    const out = transformSubgraphResponse(
      resp({
        nodes: [
          {
            id: 'live:1',
            type: 'AttoGiudiziario',
            label: 'Massima live',
            properties: { provenance: 'live_unconfirmed', trust: 0.6, massima: 'x' },
          },
        ],
      })
    );
    expect(out.nodes[0].data).toMatchObject({
      provenance: 'live_unconfirmed',
      trust: 0.6,
    });
    // Raw properties pass through so the drawer can read them off node.data too.
    expect((out.nodes[0].data as { properties?: Record<string, unknown> }).properties).toEqual({
      provenance: 'live_unconfirmed',
      trust: 0.6,
      massima: 'x',
    });
  });

  it('derives community_validated provenance from the boolean flag', () => {
    const out = transformSubgraphResponse(
      resp({ nodes: [{ id: 'v', type: 'ConcettoGiuridico', label: 'V', properties: { community_validated: true } }] })
    );
    expect((out.nodes[0].data as { provenance?: string }).provenance).toBe('community_validated');
  });

  it('leaves provenance undefined when no provenance signal exists (plain seed styling)', () => {
    const out = transformSubgraphResponse(
      resp({ nodes: [{ id: 'n', type: 'Norma', label: 'Art. 2043' }] })
    );
    expect((out.nodes[0].data as { provenance?: string }).provenance).toBeUndefined();
    expect((out.nodes[0].data as { trust?: number }).trust).toBeUndefined();
  });

  it('reads provenance/trust from metadata when properties omit them', () => {
    const out = transformSubgraphResponse(
      resp({
        nodes: [
          {
            id: 'm',
            type: 'Norma',
            label: 'X',
            metadata: { community_validated: true, trust: '1.0' },
          },
        ],
      })
    );
    expect((out.nodes[0].data as { provenance?: string }).provenance).toBe('community_validated');
    expect((out.nodes[0].data as { trust?: number }).trust).toBe(1);
  });
});

describe('mergeElements (F2 — expand-in-place merge)', () => {
  const base = () =>
    transformSubgraphResponse(
      resp({
        nodes: [
          { id: 'a', type: 'Norma', label: 'A' },
          { id: 'b', type: 'Norma', label: 'B' },
        ],
        edges: [{ id: 'e1', source: 'a', target: 'b', type: 'DISCIPLINA' }],
      })
    );

  it('appends new nodes tagged expanded and keeps existing node references', () => {
    const current = base();
    const out = mergeElements(current, {
      nodes: [
        { id: 'a', type: 'Norma', label: 'A (dup)' }, // duplicate → dropped
        { id: 'c', type: 'ConcettoGiuridico', label: 'C' },
      ],
      edges: [{ id: 'e2', source: 'a', target: 'c', type: 'ESPRIME_PRINCIPIO' }],
    });

    expect(out.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    // Existing nodes keep their OBJECT IDENTITY (positions carried on them).
    expect(out.nodes[0]).toBe(current.nodes[0]);
    // The duplicate delta node did not overwrite the existing label.
    expect(out.nodes[0].data?.label).toBe('A');
    // New nodes carry the expanded tag; originals do not.
    expect(out.nodes[2].data?.expanded).toBe(true);
    expect(out.nodes[0].data?.expanded).toBeUndefined();
    expect(out.edges.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('keeps a delta edge pointing at a PRE-EXISTING node (union dangling check)', () => {
    const out = mergeElements(base(), {
      nodes: [],
      // Both endpoints already in `current` — a lone transform would keep it
      // too, but the point is the union check: no delta nodes needed.
      edges: [{ source: 'b', target: 'a', type: 'RINVIA_A' }],
    });
    // Id synthesized from source/type/target.
    expect(out.edges.map((e) => e.id)).toEqual(['e1', 'b-RINVIA_A-a']);
  });

  it('drops delta edges dangling against the merged node set and dedupes by id', () => {
    const out = mergeElements(base(), {
      nodes: [{ id: 'c', type: 'Norma', label: 'C' }],
      edges: [
        { id: 'e1', source: 'a', target: 'b', type: 'DISCIPLINA' }, // dup id → dropped
        { id: 'e-ghost', source: 'c', target: 'ghost', type: 'X' }, // dangling → dropped
        { id: 'e2', source: 'c', target: 'a', type: 'X' },
      ],
    });
    expect(out.edges.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('returns the SAME reference when the delta adds nothing (no canvas churn)', () => {
    const current = base();
    const out = mergeElements(current, {
      nodes: [{ id: 'a', type: 'Norma', label: 'A' }],
      edges: [{ id: 'e1', source: 'a', target: 'b', type: 'DISCIPLINA' }],
    });
    expect(out).toBe(current);
  });
});
