import { describe, it, expect } from 'vitest';
import {
  buildGraphStylesheet,
  NODE_TYPE_STYLE,
  EDGE_TYPE_STYLE,
} from '../graphStyles';

describe('graphStyles', () => {
  it('includes base node and edge selectors (fallback for unknown types)', () => {
    const selectors = buildGraphStylesheet().map((s) => s.selector);
    expect(selectors).toContain('node');
    expect(selectors).toContain('edge');
  });

  it('emits one selector per declared node type', () => {
    const selectors = buildGraphStylesheet().map((s) => s.selector);
    for (const type of Object.keys(NODE_TYPE_STYLE)) {
      expect(selectors).toContain(`node[type="${type}"]`);
    }
  });

  it('emits one selector per declared edge type', () => {
    const selectors = buildGraphStylesheet().map((s) => s.selector);
    for (const type of Object.keys(EDGE_TYPE_STYLE)) {
      expect(selectors).toContain(`edge[type="${type}"]`);
    }
  });

  it('covers the core Italian legal-graph labels and relation types', () => {
    expect(NODE_TYPE_STYLE).toHaveProperty('Norma');
    expect(NODE_TYPE_STYLE).toHaveProperty('ConcettoGiuridico');
    expect(NODE_TYPE_STYLE).toHaveProperty('PrincipioGiuridico');
    expect(EDGE_TYPE_STYLE).toHaveProperty('DISCIPLINA');
    expect(EDGE_TYPE_STYLE).toHaveProperty('abroga');
  });
});
