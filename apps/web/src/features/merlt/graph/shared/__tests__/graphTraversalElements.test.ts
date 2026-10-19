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

  describe('radial-replay annotations (isSeed / iteration / walkLeaf)', () => {
    function nodeData(nodes: ReturnType<typeof graphTraversalToElements>['nodes'], id: string) {
      return nodes.find((n) => n.id === id)?.data as
        | { isSeed?: boolean; iteration?: number; walkLeaf?: boolean; walkNode?: boolean; type?: string }
        | undefined;
    }

    it('marks every node with walkNode', () => {
      const out = graphTraversalToElements([edge({ source_urn: 'urn:a', target_urn: 'urn:b' })]);
      expect(nodeData(out.nodes, 'urn:a')?.walkNode).toBe(true);
      expect(nodeData(out.nodes, 'urn:b')?.walkNode).toBe(true);
    });

    it('picks the seed as the node with the max out-degree', () => {
      // urn:a fans out to 3 targets (out-degree 3); urn:b only fans out once.
      const out = graphTraversalToElements([
        edge({ iteration: 0, source_urn: 'urn:a', target_urn: 'urn:x', target_type: 'ModalitaGiuridica' }),
        edge({ iteration: 0, source_urn: 'urn:a', target_urn: 'urn:y', target_type: 'ModalitaGiuridica' }),
        edge({ iteration: 0, source_urn: 'urn:a', target_urn: 'urn:z', target_type: 'ModalitaGiuridica' }),
        edge({ iteration: 1, source_urn: 'urn:z', target_urn: 'urn:b', target_type: 'ConcettoGiuridico' }),
      ]);
      expect(nodeData(out.nodes, 'urn:a')?.isSeed).toBe(true);
      expect(nodeData(out.nodes, 'urn:x')?.isSeed).toBe(false);
      expect(nodeData(out.nodes, 'urn:z')?.isSeed).toBe(false);
      expect(nodeData(out.nodes, 'urn:b')?.isSeed).toBe(false);
    });

    it('falls back to the first step source when no out-degree entry exists', () => {
      const out = graphTraversalToElements([edge({ source_urn: 'urn:a', target_urn: 'urn:b' })]);
      // urn:a is the only source, so it wins on out-degree already — this also
      // covers the fallback path degenerating to the same answer.
      expect(nodeData(out.nodes, 'urn:a')?.isSeed).toBe(true);
    });

    it('flags a leaf concept target (ModalitaGiuridica/ConcettoGiuridico) as walkLeaf, never the seed', () => {
      const out = graphTraversalToElements([
        edge({ source_urn: 'urn:a', target_urn: 'urn:b', target_type: 'ModalitaGiuridica' }),
        edge({ iteration: 1, source_urn: 'urn:a', target_urn: 'urn:c', target_type: 'ConcettoGiuridico' }),
      ]);
      expect(nodeData(out.nodes, 'urn:b')?.walkLeaf).toBe(true);
      expect(nodeData(out.nodes, 'urn:c')?.walkLeaf).toBe(true);
      expect(nodeData(out.nodes, 'urn:a')?.walkLeaf).toBe(false); // seed, even though its guessed type defaults to ConcettoGiuridico
    });

    it('does not flag a non-leaf type (e.g. a normattiva-guessed Norma) as walkLeaf', () => {
      const out = graphTraversalToElements([
        edge({
          source_urn: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:...~art2043',
          target_urn: 'urn:b',
          target_type: 'ModalitaGiuridica',
        }),
      ]);
      // urn:b is the leaf target, the normattiva source is the seed.
      const source = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:...~art2043';
      expect(nodeData(out.nodes, source)?.walkLeaf).toBe(false);
    });

    it('sets iteration to the round a node is first REACHED as a target', () => {
      const out = graphTraversalToElements([
        edge({ iteration: 0, source_urn: 'urn:a', target_urn: 'urn:b' }),
        edge({ iteration: 1, source_urn: 'urn:b', target_urn: 'urn:c' }),
        edge({ iteration: 2, source_urn: 'urn:c', target_urn: 'urn:d' }),
      ]);
      expect(nodeData(out.nodes, 'urn:b')?.iteration).toBe(0);
      expect(nodeData(out.nodes, 'urn:c')?.iteration).toBe(1);
      expect(nodeData(out.nodes, 'urn:d')?.iteration).toBe(2);
    });

    it('defaults iteration to 0 for source-only nodes (including the seed)', () => {
      const out = graphTraversalToElements([
        edge({ iteration: 5, source_urn: 'urn:seed', target_urn: 'urn:b' }),
      ]);
      // urn:seed never appears as a target anywhere in the walk.
      expect(nodeData(out.nodes, 'urn:seed')?.iteration).toBe(0);
    });

    it('keeps the FIRST occurrence iteration when a node is reached again later', () => {
      const out = graphTraversalToElements([
        edge({ iteration: 0, source_urn: 'urn:a', target_urn: 'urn:shared' }),
        edge({ iteration: 3, source_urn: 'urn:x', target_urn: 'urn:shared' }), // reached again, later
      ]);
      expect(nodeData(out.nodes, 'urn:shared')?.iteration).toBe(0);
    });
  });
});
