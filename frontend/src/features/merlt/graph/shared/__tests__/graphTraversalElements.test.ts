import { describe, it, expect } from 'vitest';
import { graphTraversalToElements } from '../graphTraversalElements';
import type { GraphTraversalEdge } from '../../../qa/types';

function edge(partial: Partial<GraphTraversalEdge>): GraphTraversalEdge {
  return {
    iteration: 0,
    source_urn: 'urn:a',
    relation_type: 'IMPONE',
    target_urn: 'urn:b',
    target_type: 'ModalitaGiuridica',
    ...partial,
  };
}

describe('graphTraversalToElements (walk-mode self-contained mini-graph)', () => {
  it('builds one node per unique urn and one edge per hop', () => {
    const out = graphTraversalToElements([
      edge({ source_urn: 'urn:a', target_urn: 'urn:b' }),
      edge({ iteration: 1, source_urn: 'urn:b', target_urn: 'urn:c' }),
    ]);
    expect(out.nodes.map((n) => n.id)).toEqual(['urn:a', 'urn:b', 'urn:c']);
    expect(out.edges).toHaveLength(2);
    expect(out.steps).toHaveLength(2);
  });

  it('de-duplicates nodes shared across hops (first occurrence wins the type)', () => {
    const out = graphTraversalToElements([
      edge({ source_urn: 'urn:a', target_urn: 'urn:b', target_type: 'ModalitaGiuridica' }),
      edge({ iteration: 1, source_urn: 'urn:b', target_urn: 'urn:c', target_type: 'ConcettoGiuridico' }),
      // urn:b appears again as a SOURCE — must not duplicate the node.
      edge({ iteration: 2, source_urn: 'urn:b', target_urn: 'urn:d' }),
    ]);
    const ids = out.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
    expect(ids).toContain('urn:b');
  });

  it('synthesizes stable, unique edge ids keyed on iteration+source+relation+target', () => {
    const out = graphTraversalToElements([
      edge({ iteration: 0, source_urn: 'urn:a', relation_type: 'IMPONE', target_urn: 'urn:b' }),
      edge({ iteration: 1, source_urn: 'urn:a', relation_type: 'IMPONE', target_urn: 'urn:b' }), // same hop again, different iteration
    ]);
    const ids = out.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(2); // still unique
    expect(ids[0]).toContain('w0:');
    expect(ids[1]).toContain('w1:');
  });

  it('preserves iteration order in the returned steps array', () => {
    const out = graphTraversalToElements([
      edge({ iteration: 2, source_urn: 'urn:a', target_urn: 'urn:x' }),
      edge({ iteration: 0, source_urn: 'urn:a', target_urn: 'urn:y' }),
    ]);
    // Steps follow INPUT order (the walk's own order), not a re-sort by iteration.
    expect(out.steps.map((s) => s.targetId)).toEqual(['urn:x', 'urn:y']);
  });

  it('drops a hop missing source_urn or target_urn', () => {
    const out = graphTraversalToElements([
      edge({ source_urn: '', target_urn: 'urn:b' }),
      edge({ source_urn: 'urn:a', target_urn: '' }),
      edge({ source_urn: 'urn:a', target_urn: 'urn:b' }),
    ]);
    expect(out.edges).toHaveLength(1);
    expect(out.steps).toHaveLength(1);
  });

  it('returns empty elements for an empty walk', () => {
    const out = graphTraversalToElements([]);
    expect(out.nodes).toEqual([]);
    expect(out.edges).toEqual([]);
    expect(out.steps).toEqual([]);
  });

  it('carries the relation type onto the edge label/type and the step', () => {
    const out = graphTraversalToElements([edge({ relation_type: 'ESPRIME_PRINCIPIO' })]);
    expect(out.edges[0].data).toMatchObject({ label: 'ESPRIME_PRINCIPIO', type: 'ESPRIME_PRINCIPIO' });
    expect(out.steps[0].relationType).toBe('ESPRIME_PRINCIPIO');
  });

  it('a node carries urn + a readable label in its data', () => {
    const out = graphTraversalToElements([
      edge({ source_urn: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:...~art2043', target_urn: 'urn:b' }),
    ]);
    const source = out.nodes.find((n) => n.id === 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:...~art2043');
    expect(source?.data).toMatchObject({ urn: source?.id });
    expect((source?.data as { label?: string })?.label).toContain('2043');
  });
});
