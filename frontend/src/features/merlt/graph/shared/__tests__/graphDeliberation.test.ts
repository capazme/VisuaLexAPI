import { describe, it, expect } from 'vitest';
import {
  buildDeliberationOverlay,
  canonKeyFromNodeId,
  canonNodeVisual,
  CANON_NODE_PREFIX,
  CONTRAST_EDGE_PREFIX,
  contrastEdgeId,
  isDeliberationElementId,
  readDeliberation,
  resolveEdgeSelection,
  withDeliberationOverlay,
} from '../graphDeliberation';
import type { GraphElements } from '../graphTransform';
import type { DisagreementConflict, ExpertContribution, GraphEdge } from '../types';

function contribution(expert: string, weight: number, thesis = 't'): ExpertContribution {
  return { expert, thesis, confidence: 0.8, weight };
}

function conflict(a: string, b: string, score: number, point = 'perché'): DisagreementConflict {
  return { expert_a: a, expert_b: b, conflict_score: score, contention_point: point };
}

describe('graphDeliberation — overlay construction', () => {
  it('injects one canon node per contribution, id-namespaced, weight carried', () => {
    const overlay = buildDeliberationOverlay({
      contributions: [contribution('literal', 0.6), contribution('principles', 0.2)],
      conflicts: [],
      devilsAdvocateActive: false,
      centerNodeId: null,
    });

    expect(overlay.nodes.map((n) => n.id)).toEqual([
      `${CANON_NODE_PREFIX}literal`,
      `${CANON_NODE_PREFIX}principles`,
    ]);
    const literal = overlay.nodes[0];
    expect(literal.data).toMatchObject({ kind: 'canon', canon: 'literal', label: 'Letterale', weight: 0.6 });
    // No center → canons float (no anchor edges).
    expect(overlay.edges).toHaveLength(0);
  });

  it('orders canons in art. 12 preleggi order regardless of input order', () => {
    const overlay = buildDeliberationOverlay({
      contributions: [
        contribution('precedent', 0.3),
        contribution('literal', 0.9),
        contribution('systemic', 0.5),
      ],
      conflicts: [],
      devilsAdvocateActive: false,
    });
    expect(overlay.nodes.map((n) => (n.data as { canon: string }).canon)).toEqual([
      'literal',
      'systemic',
      'precedent',
    ]);
  });

  it('anchors each canon to the center node so the layout places them around it', () => {
    const overlay = buildDeliberationOverlay({
      contributions: [contribution('literal', 0.6)],
      conflicts: [],
      devilsAdvocateActive: false,
      centerNodeId: 'node-2043',
    });
    const anchor = overlay.edges.find((e) => e.source === 'node-2043');
    expect(anchor).toBeTruthy();
    expect(anchor!.target).toBe(`${CANON_NODE_PREFIX}literal`);
    expect((anchor!.data as { kind: string }).kind).toBe('canon-anchor');
  });

  it('builds a contrast arc for each conflict, thickness signal via conflict_score', () => {
    const overlay = buildDeliberationOverlay({
      contributions: [contribution('literal', 0.6), contribution('principles', 0.4)],
      conflicts: [conflict('literal', 'principles', 0.68)],
      devilsAdvocateActive: false,
    });
    const arc = overlay.edges.find((e) => e.id?.startsWith(CONTRAST_EDGE_PREFIX));
    expect(arc).toBeTruthy();
    expect(arc!.source).toBe(`${CANON_NODE_PREFIX}literal`);
    expect(arc!.target).toBe(`${CANON_NODE_PREFIX}principles`);
    expect(arc!.data).toMatchObject({ kind: 'contrast', conflictScore: 0.68, devilsAdvocate: false });
  });

  it('marks the contrast arc when the devil\'s-advocate flag is active', () => {
    const overlay = buildDeliberationOverlay({
      contributions: [contribution('literal', 0.6), contribution('principles', 0.4)],
      conflicts: [conflict('literal', 'principles', 0.5)],
      devilsAdvocateActive: true,
    });
    const arc = overlay.edges.find((e) => e.id?.startsWith(CONTRAST_EDGE_PREFIX))!;
    expect((arc.data as { devilsAdvocate: boolean }).devilsAdvocate).toBe(true);
  });

  it('drops a conflict whose endpoint canon was not consulted', () => {
    const overlay = buildDeliberationOverlay({
      contributions: [contribution('literal', 0.6)],
      conflicts: [conflict('literal', 'precedent', 0.7)], // precedent absent
      devilsAdvocateActive: false,
    });
    expect(overlay.edges.filter((e) => e.id?.startsWith(CONTRAST_EDGE_PREFIX))).toHaveLength(0);
  });

  it('produces no canon nodes on a degenerate no-expert answer', () => {
    const overlay = buildDeliberationOverlay({
      contributions: [],
      conflicts: [conflict('literal', 'principles', 0.7)],
      devilsAdvocateActive: false,
    });
    expect(overlay.nodes).toHaveLength(0);
    expect(overlay.edges).toHaveLength(0);
  });

  it('a not-consulted canon (weight 0) renders smaller/dimmer than a dominant one', () => {
    const dim = canonNodeVisual(0);
    const bold = canonNodeVisual(1);
    expect(bold.size).toBeGreaterThan(dim.size);
    expect(bold.opacity).toBeGreaterThan(dim.opacity);
  });
});

describe('graphDeliberation — id helpers', () => {
  it('contrastEdgeId is order-independent', () => {
    expect(contrastEdgeId('canon:a', 'canon:b')).toBe(contrastEdgeId('canon:b', 'canon:a'));
  });
  it('canonKeyFromNodeId extracts a valid canon, null otherwise', () => {
    expect(canonKeyFromNodeId('canon:literal')).toBe('literal');
    expect(canonKeyFromNodeId('canon:bogus')).toBeNull();
    expect(canonKeyFromNodeId('node-2043')).toBeNull();
  });
  it('isDeliberationElementId flags synthetic ids only', () => {
    expect(isDeliberationElementId('canon:literal')).toBe(true);
    expect(isDeliberationElementId('contrast:canon:a--canon:b')).toBe(true);
    expect(isDeliberationElementId('node-2043')).toBe(false);
  });
});

describe('graphDeliberation — withDeliberationOverlay', () => {
  const base: GraphElements = { nodes: [{ id: 'n1' }], edges: [] };

  it('returns the SAME reference when there is nothing to overlay', () => {
    expect(withDeliberationOverlay(base, null)).toBe(base);
    expect(withDeliberationOverlay(base, { nodes: [], edges: [] })).toBe(base);
  });

  it('appends overlay nodes/edges without mutating the real subgraph', () => {
    const merged = withDeliberationOverlay(base, {
      nodes: [{ id: 'canon:literal' }],
      edges: [{ id: 'contrast:x', source: 'a', target: 'b' }],
    });
    expect(merged.nodes.map((n) => n.id)).toEqual(['n1', 'canon:literal']);
    expect(merged.edges).toHaveLength(1);
    // The input elements are untouched.
    expect(base.nodes).toHaveLength(1);
    expect(base.edges).toHaveLength(0);
  });
});

describe('graphDeliberation — resolveEdgeSelection', () => {
  const conflicts = [conflict('literal', 'principles', 0.68, 'testo/spirito')];
  const relation: GraphEdge = { id: 'e1', source: 'a', target: 'b', type: 'DISCIPLINA' };
  const edgesById = new Map<string, GraphEdge>([['e1', relation]]);
  const canonLabel = (k: string): string => ({ literal: 'Letterale', principles: 'Principî' }[k] ?? k);

  it('resolves a real relation edge to a { kind: relation } selection', () => {
    const sel = resolveEdgeSelection('e1', { edgesById, conflicts, devilsAdvocateActive: false, canonLabel });
    expect(sel).toEqual({ kind: 'relation', edge: relation });
  });

  it('resolves a contrast arc to a { kind: contrast } selection with labels + conflict', () => {
    const id = contrastEdgeId('canon:literal', 'canon:principles');
    const sel = resolveEdgeSelection(id, { edgesById, conflicts, devilsAdvocateActive: true, canonLabel });
    expect(sel).toEqual({
      kind: 'contrast',
      conflict: conflicts[0],
      expertALabel: 'Letterale',
      expertBLabel: 'Principî',
      isDevilsAdvocate: true,
    });
  });

  it('returns null for a canon-anchor tether (structural, not inspectable)', () => {
    const sel = resolveEdgeSelection('canon:anchor:literal', {
      edgesById,
      conflicts,
      devilsAdvocateActive: false,
      canonLabel,
    });
    expect(sel).toBeNull();
  });

  it('returns null for an unknown edge id', () => {
    expect(
      resolveEdgeSelection('ghost', { edgesById, conflicts, devilsAdvocateActive: false, canonLabel }),
    ).toBeNull();
  });
});

describe('graphDeliberation — readDeliberation (defensive off QaAnswer)', () => {
  it('reads all three fields when present', () => {
    const d = readDeliberation({
      expert_contributions: [contribution('literal', 0.5)],
      disagreement_analysis: { has_disagreement: true, conflicts: [conflict('literal', 'systemic', 0.4)] },
      devils_advocate_flag: { active: true, expert: null },
    });
    expect(d.expert_contributions).toHaveLength(1);
    expect(d.disagreement_analysis?.has_disagreement).toBe(true);
    expect(d.devils_advocate_flag?.active).toBe(true);
  });

  it('returns nulls for a convergent / pre-P2a answer with no deliberation fields', () => {
    const d = readDeliberation({ synthesis: 'x' });
    expect(d.expert_contributions).toBeNull();
    expect(d.disagreement_analysis).toBeNull();
    expect(d.devils_advocate_flag).toBeNull();
  });

  it('drops malformed contributions and a non-conforming disagreement object', () => {
    const d = readDeliberation({
      expert_contributions: [{ expert: 'literal', weight: 0.5, thesis: 't', confidence: 1 }, { nope: 1 }],
      disagreement_analysis: { has_disagreement: 'yes' }, // wrong types → rejected
    });
    expect(d.expert_contributions).toHaveLength(1);
    expect(d.disagreement_analysis).toBeNull();
  });

  it('tolerates a null/undefined answer', () => {
    expect(readDeliberation(null)).toEqual({});
    expect(readDeliberation(undefined)).toEqual({});
  });
});
