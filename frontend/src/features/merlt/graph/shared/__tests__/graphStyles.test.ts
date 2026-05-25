import { describe, it, expect } from 'vitest';
import {
  NODE_TYPE_STYLE,
  EDGE_TYPE_STYLE,
  nodeG6Type,
  nodeStyleMapper,
  edgeStyleMapper,
} from '../graphStyles';

describe('graphStyles (G6)', () => {
  it('covers the core Italian legal-graph labels and relation types', () => {
    expect(NODE_TYPE_STYLE).toHaveProperty('Norma');
    expect(NODE_TYPE_STYLE).toHaveProperty('ConcettoGiuridico');
    expect(NODE_TYPE_STYLE).toHaveProperty('PrincipioGiuridico');
    expect(EDGE_TYPE_STYLE).toHaveProperty('DISCIPLINA');
    expect(EDGE_TYPE_STYLE).toHaveProperty('abroga');
  });

  it('maps a known node type to its declared G6 shape, unknown → circle fallback', () => {
    expect(nodeG6Type('Norma')).toBe(NODE_TYPE_STYLE.Norma.g6Type);
    expect(nodeG6Type('TotallyUnknown')).toBe('circle');
  });

  it('nodeStyleMapper uses the type colour and the datum label', () => {
    const style = nodeStyleMapper({ id: 'n', data: { type: 'Norma', label: 'Art. 2043' } });
    expect(style.fill).toBe(NODE_TYPE_STYLE.Norma.color);
    expect(style.labelText).toBe('Art. 2043');
  });

  it('nodeStyleMapper falls back gracefully for an unknown/missing type', () => {
    const style = nodeStyleMapper({ id: 'n', data: { label: 'x' } });
    expect(typeof style.fill).toBe('string');
    expect(style.fill).toBeTruthy();
  });

  it('edgeStyleMapper uses the relation colour and label, unknown → fallback', () => {
    const known = edgeStyleMapper({ id: 'e', source: 'a', target: 'b', data: { type: 'DISCIPLINA', label: 'DISCIPLINA' } });
    expect(known.stroke).toBe(EDGE_TYPE_STYLE.DISCIPLINA.color);
    expect(known.labelText).toBe('DISCIPLINA');

    const unknown = edgeStyleMapper({ id: 'e2', source: 'a', target: 'b', data: { type: 'WAT' } });
    expect(typeof unknown.stroke).toBe('string');
    expect(unknown.stroke).toBeTruthy();
  });
});
