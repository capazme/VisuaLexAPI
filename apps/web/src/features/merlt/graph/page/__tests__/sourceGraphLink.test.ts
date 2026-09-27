import { describe, it, expect } from 'vitest';
import { resolveLocalSourceNode, sourceMatchesNode } from '../sourceGraphLink';
import type { GraphNode } from '../../shared/types';
import type { QaRetrievedSource } from '../../../qa/types';

function node(overrides: Partial<GraphNode> = {}): GraphNode {
  return { id: 'node-2043', urn: 'urn:x~art2043', type: 'Norma', label: 'Art. 2043', ...overrides };
}

function source(overrides: Partial<QaRetrievedSource> = {}): QaRetrievedSource {
  return { urn: 'urn:x~art2043', provenance: 'seed', trust: 0.8, node_id: null, ...overrides };
}

describe('resolveLocalSourceNode', () => {
  it('resolves by node id first', () => {
    const n = node();
    expect(resolveLocalSourceNode('node-2043', new Map([['node-2043', n]]), [n])).toBe(n);
  });

  it('falls back to a urn match when not a known node id', () => {
    const n = node();
    expect(resolveLocalSourceNode('urn:x~art2043', new Map(), [n])).toBe(n);
  });

  it('is resilient (null) when the node is not on the current canvas', () => {
    expect(resolveLocalSourceNode('urn:absent', new Map(), [])).toBeNull();
  });
});

describe('sourceMatchesNode', () => {
  it('matches by node_id when present', () => {
    const n = node({ id: 'node-2043' });
    expect(sourceMatchesNode(source({ node_id: 'node-2043' }), n)).toBe(true);
    expect(sourceMatchesNode(source({ node_id: 'other' }), n)).toBe(false);
  });

  it('falls back to urn when node_id is absent', () => {
    const n = node({ urn: 'urn:x~art2043' });
    expect(sourceMatchesNode(source({ node_id: null, urn: 'urn:x~art2043' }), n)).toBe(true);
    expect(sourceMatchesNode(source({ node_id: null, urn: 'urn:other' }), n)).toBe(false);
  });

  it('is resilient (false) when the node is null/undefined', () => {
    expect(sourceMatchesNode(source(), null)).toBe(false);
    expect(sourceMatchesNode(source(), undefined)).toBe(false);
  });

  it('is false when the node has no urn and the source carries no node_id', () => {
    const n = node({ urn: undefined });
    expect(sourceMatchesNode(source({ node_id: null }), n)).toBe(false);
  });
});
