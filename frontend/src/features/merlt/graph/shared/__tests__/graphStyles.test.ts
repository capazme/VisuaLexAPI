import { describe, it, expect } from 'vitest';
import {
  NODE_TYPE_STYLE,
  EDGE_TYPE_STYLE,
  PROVENANCE_STYLE,
  CONTRAST_ARC_COLOR,
  DEVILS_ADVOCATE_ARC_COLOR,
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

  it('declares a style for each of the three provenance states', () => {
    expect(PROVENANCE_STYLE).toHaveProperty('seed');
    expect(PROVENANCE_STYLE).toHaveProperty('community_validated');
    expect(PROVENANCE_STYLE).toHaveProperty('live_unconfirmed');
  });

  it('seed provenance keeps the plain type border (no dash, no override)', () => {
    const style = nodeStyleMapper({ id: 'n', data: { type: 'Norma', provenance: 'seed' } });
    // Stroke stays the type hue; no dash.
    expect(style.stroke).toBe(NODE_TYPE_STYLE.Norma.color);
    expect(style.lineDash).toBeUndefined();
  });

  it('community_validated provenance thickens the border (ring), keeps the type hue', () => {
    const style = nodeStyleMapper({ id: 'n', data: { type: 'Norma', provenance: 'community_validated' } });
    expect(style.stroke).toBe(NODE_TYPE_STYLE.Norma.color);
    expect(style.lineWidth).toBe(PROVENANCE_STYLE.community_validated.lineWidth);
    expect(style.lineWidth).toBeGreaterThan(PROVENANCE_STYLE.seed.lineWidth);
  });

  it('live_unconfirmed provenance draws a dashed amber border overriding the type hue', () => {
    const style = nodeStyleMapper({ id: 'n', data: { type: 'Norma', provenance: 'live_unconfirmed' } });
    expect(style.lineDash).toEqual(PROVENANCE_STYLE.live_unconfirmed.lineDash);
    expect(style.stroke).toBe(PROVENANCE_STYLE.live_unconfirmed.strokeOverride);
    expect(style.stroke).not.toBe(NODE_TYPE_STYLE.Norma.color);
  });

  it('trust nudges fill opacity within a clamped range', () => {
    const high = nodeStyleMapper({ id: 'h', data: { type: 'Norma', trust: 1 } });
    const low = nodeStyleMapper({ id: 'l', data: { type: 'Norma', trust: 0 } });
    expect(high.fillOpacity as number).toBeGreaterThan(low.fillOpacity as number);
    expect(high.fillOpacity as number).toBeLessThanOrEqual(0.32);
    expect(low.fillOpacity as number).toBeGreaterThanOrEqual(0.1);
  });

  describe('Slice 4 P2a — canon nodes + contrast arcs', () => {
    it('a canon node uses its own colour and scales size/opacity with the weight', () => {
      const bold = nodeStyleMapper({
        id: 'canon:literal',
        data: { kind: 'canon', canon: 'literal', label: 'Letterale', color: '#1e3a8a', weight: 1 },
      });
      const dim = nodeStyleMapper({
        id: 'canon:precedent',
        data: { kind: 'canon', canon: 'precedent', label: 'Precedente', color: '#7f1d1d', weight: 0 },
      });
      expect(bold.fill).toBe('#1e3a8a');
      expect(bold.labelText).toBe('Letterale');
      // A consulted canon reads bolder + bigger than a not-consulted one.
      expect(bold.size as number).toBeGreaterThan(dim.size as number);
      expect(bold.fillOpacity as number).toBeGreaterThan(dim.fillOpacity as number);
    });

    it('a contrast arc is dashed, thickens with conflict_score, no arrow', () => {
      const sharp = edgeStyleMapper({
        id: 'contrast:a--b',
        source: 'a',
        target: 'b',
        data: { kind: 'contrast', conflictScore: 1, devilsAdvocate: false, label: 'x' },
      });
      const faint = edgeStyleMapper({
        id: 'contrast:c--d',
        source: 'c',
        target: 'd',
        data: { kind: 'contrast', conflictScore: 0, devilsAdvocate: false },
      });
      expect(sharp.stroke).toBe(CONTRAST_ARC_COLOR);
      expect(sharp.lineDash).toBeTruthy();
      expect(sharp.endArrow).toBe(false);
      expect(sharp.lineWidth as number).toBeGreaterThan(faint.lineWidth as number);
    });

    it('a devil\'s-advocate contrast arc gets the distinct violet styling', () => {
      const devil = edgeStyleMapper({
        id: 'contrast:a--b',
        source: 'a',
        target: 'b',
        data: { kind: 'contrast', conflictScore: 0.5, devilsAdvocate: true },
      });
      expect(devil.stroke).toBe(DEVILS_ADVOCATE_ARC_COLOR);
      expect(devil.stroke).not.toBe(CONTRAST_ARC_COLOR);
    });

    it('a canon-anchor tether is faint and unlabeled (layout-only)', () => {
      const anchor = edgeStyleMapper({
        id: 'canon:anchor:literal',
        source: 'node',
        target: 'canon:literal',
        data: { kind: 'canon-anchor' },
      });
      expect(anchor.endArrow).toBe(false);
      expect(anchor.labelText).toBe('');
      expect(anchor.strokeOpacity as number).toBeLessThan(0.5);
    });
  });
});
