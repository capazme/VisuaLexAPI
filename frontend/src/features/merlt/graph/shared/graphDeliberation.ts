import type { NodeData, EdgeData } from '@antv/g6';
import type { GraphElements } from './graphTransform';
import type {
  CanonKey,
  DeliberationFields,
  DevilsAdvocateFlag,
  DisagreementAnalysis,
  DisagreementConflict,
  ExpertContribution,
  GraphEdge,
  GraphEdgeSelection,
} from './types';
import { CANON_KEYS } from './types';

/**
 * Slice 4 P2a — "il dibattito visibile": overlay the multi-canon debate ON the
 * G6 graph. Pure, side-effect-free element construction so it unit-tests without
 * a canvas and stays reference-stable for React memoization.
 *
 * Two synthetic element families are appended to the real subgraph:
 *  - **canon nodes** (`canon:<key>`): the 4 interpretive canons, size/opacity ∝
 *    routing weight (from `expert_contributions`); a not-consulted canon (weight
 *    ≈ 0) stays dim/small. Linked to the centered node so the force layout places
 *    them AROUND the article; floated (unlinked) when there is no center.
 *  - **contrast arcs** (`contrast:<a>--<b>`): a dashed edge between two canon
 *    nodes for each `disagreement_analysis.conflicts` entry, thickness ∝
 *    `conflict_score`; marked when the devil's-advocate flag is active.
 *
 * The overlay is DERIVED and appended only in render — it never mutates the real
 * `graph.data`/`graph.elements`, so the export-slice and a plain subgraph stay
 * clean (lifecycle: no answer → no overlay; new ask → previous overlay dropped).
 */

/**
 * Read the deliberation fields off a Q&A answer. `QaAnswer` (owned by the qa
 * feature) does not type them yet, so we narrow structurally from `unknown`.
 * Every field is optional — a convergent answer carries no disagreement object,
 * and a pre-P2a BFF omits all three (→ empty overlay, plain subgraph).
 */
export function readDeliberation(answer: unknown): DeliberationFields {
  if (!answer || typeof answer !== 'object') return {};
  const a = answer as Record<string, unknown>;

  const contributions = Array.isArray(a.expert_contributions)
    ? (a.expert_contributions as unknown[]).filter(isExpertContribution)
    : null;

  const disagreement = isDisagreementAnalysis(a.disagreement_analysis)
    ? (a.disagreement_analysis as DisagreementAnalysis)
    : null;

  const devils = isDevilsAdvocateFlag(a.devils_advocate_flag)
    ? (a.devils_advocate_flag as DevilsAdvocateFlag)
    : null;

  return {
    expert_contributions: contributions,
    disagreement_analysis: disagreement,
    devils_advocate_flag: devils,
  };
}

function isExpertContribution(v: unknown): v is ExpertContribution {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.expert === 'string' && typeof c.weight === 'number';
}

function isDisagreementAnalysis(v: unknown): v is DisagreementAnalysis {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return typeof d.has_disagreement === 'boolean' && Array.isArray(d.conflicts);
}

function isDevilsAdvocateFlag(v: unknown): v is DevilsAdvocateFlag {
  if (!v || typeof v !== 'object') return false;
  return typeof (v as Record<string, unknown>).active === 'boolean';
}

/** Canon colours (design §3.1): distinct, hue-separated, canvas-rendered. */
export const CANON_STYLE: Record<CanonKey, { label: string; color: string }> = {
  literal: { label: 'Letterale', color: '#1e3a8a' }, // ink-blue
  systemic: { label: 'Sistematico', color: '#0f766e' }, // verdigris
  principles: { label: 'Principî', color: '#b45309' }, // ochre
  precedent: { label: 'Precedente', color: '#7f1d1d' }, // oxblood
};

/** Synthetic id namespace — kept out of the real node/edge id space. */
export const CANON_NODE_PREFIX = 'canon:';
export const CONTRAST_EDGE_PREFIX = 'contrast:';

/** Canon key of a synthetic canon node id, or null if not a canon node. */
export function canonKeyFromNodeId(id: string): CanonKey | null {
  if (!id.startsWith(CANON_NODE_PREFIX)) return null;
  const key = id.slice(CANON_NODE_PREFIX.length);
  return (CANON_KEYS as readonly string[]).includes(key) ? (key as CanonKey) : null;
}

/** True when the id belongs to a synthetic deliberation element (node or edge). */
export function isDeliberationElementId(id: string): boolean {
  return id.startsWith(CANON_NODE_PREFIX) || id.startsWith(CONTRAST_EDGE_PREFIX);
}

/** Stable, order-independent contrast-arc id for a canon pair. */
export function contrastEdgeId(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `${CONTRAST_EDGE_PREFIX}${x}--${y}`;
}

/** Weight per canon from the contributions (0 when a canon wasn't consulted). */
function weightByCanon(contributions: ExpertContribution[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of contributions) {
    const w = typeof c.weight === 'number' && Number.isFinite(c.weight) ? c.weight : 0;
    map.set(c.expert, Math.max(0, w));
  }
  return map;
}

/** Size/opacity for a canon node ∝ its routing weight (clamped, always visible). */
export function canonNodeVisual(weight: number): { size: number; opacity: number } {
  const w = Math.max(0, Math.min(1, weight));
  // A consulted canon grows to ~54px; a not-consulted one stays a dim ~26px hint.
  return { size: 26 + Math.round(28 * w), opacity: 0.28 + 0.62 * w };
}

export interface DeliberationOverlayInput {
  contributions: ExpertContribution[];
  conflicts: DisagreementConflict[];
  devilsAdvocateActive: boolean;
  /** Real node id the canons attach to (the centered article), if present. */
  centerNodeId?: string | null;
}

export interface DeliberationOverlay {
  nodes: NodeData[];
  edges: EdgeData[];
}

/**
 * Build the canon-node + contrast-arc overlay. Only canons that appear in
 * `contributions` are injected — a degenerate no-expert answer yields no canon
 * nodes (and therefore no arcs). Contrast arcs are dropped when either endpoint
 * canon is absent (defensive: the arc needs both nodes present to render).
 */
export function buildDeliberationOverlay(input: DeliberationOverlayInput): DeliberationOverlay {
  const { contributions, conflicts, devilsAdvocateActive, centerNodeId } = input;
  const weights = weightByCanon(contributions);

  const nodes: NodeData[] = [];
  const anchorEdges: EdgeData[] = [];
  const present = new Set<string>();

  // Inject canon nodes in the fixed art. 12 preleggi order (literal → precedent),
  // then any extra experts the engine reported (kept last, styled neutrally).
  const orderedKeys = [
    ...CANON_KEYS.filter((k) => weights.has(k)),
    ...[...weights.keys()].filter((k) => !(CANON_KEYS as readonly string[]).includes(k)),
  ];

  for (const key of orderedKeys) {
    const weight = weights.get(key) ?? 0;
    const style = (CANON_STYLE as Record<string, { label: string; color: string }>)[key];
    const nodeId = `${CANON_NODE_PREFIX}${key}`;
    present.add(key);
    nodes.push({
      id: nodeId,
      // A distinct G6 shape (star) so canons read as "voices", not corpus nodes.
      type: 'star',
      data: {
        kind: 'canon',
        canon: key,
        label: style?.label ?? key,
        color: style?.color ?? '#475569',
        weight,
      },
    });
    // Attach to the centered article so the layout arranges canons around it.
    if (centerNodeId) {
      anchorEdges.push({
        id: `${CANON_NODE_PREFIX}anchor:${key}`,
        source: centerNodeId,
        target: nodeId,
        data: { kind: 'canon-anchor' },
      });
    }
  }

  const contrastEdges: EdgeData[] = [];
  const seenContrast = new Set<string>();
  for (const c of conflicts) {
    if (!present.has(c.expert_a) || !present.has(c.expert_b)) continue;
    const id = contrastEdgeId(`${CANON_NODE_PREFIX}${c.expert_a}`, `${CANON_NODE_PREFIX}${c.expert_b}`);
    if (seenContrast.has(id)) continue;
    seenContrast.add(id);
    const score = typeof c.conflict_score === 'number' ? Math.max(0, Math.min(1, c.conflict_score)) : 0;
    contrastEdges.push({
      id,
      source: `${CANON_NODE_PREFIX}${c.expert_a}`,
      target: `${CANON_NODE_PREFIX}${c.expert_b}`,
      data: {
        kind: 'contrast',
        conflictScore: score,
        devilsAdvocate: devilsAdvocateActive,
        label: c.contention_point ?? 'contrasto',
      },
    });
  }

  return { nodes, edges: [...anchorEdges, ...contrastEdges] };
}

/**
 * Merge a deliberation overlay onto the real subgraph elements. Returns the same
 * `elements` reference when there is nothing to overlay so downstream memos stay
 * stable (no synthetic churn on plain exploration).
 */
export function withDeliberationOverlay(
  elements: GraphElements,
  overlay: DeliberationOverlay | null
): GraphElements {
  if (!overlay || (overlay.nodes.length === 0 && overlay.edges.length === 0)) return elements;
  return {
    nodes: [...elements.nodes, ...overlay.nodes],
    edges: [...elements.edges, ...overlay.edges],
  };
}

/**
 * Resolve a clicked edge id to a {@link GraphEdgeSelection}. A synthetic contrast
 * arc resolves to the matching conflict (with readable canon labels + the
 * devil's-advocate marker); a real relation edge resolves to its {@link GraphEdge}.
 * Returns null for canon-anchor edges (structural, not inspectable) or unknown ids.
 */
export function resolveEdgeSelection(
  edgeId: string,
  opts: {
    edgesById: Map<string, GraphEdge>;
    conflicts: DisagreementConflict[];
    devilsAdvocateActive: boolean;
    canonLabel: (key: string) => string;
  }
): GraphEdgeSelection | null {
  if (edgeId.startsWith(`${CANON_NODE_PREFIX}anchor:`)) return null;
  if (edgeId.startsWith(CONTRAST_EDGE_PREFIX)) {
    const conflict = opts.conflicts.find(
      (c) =>
        contrastEdgeId(`${CANON_NODE_PREFIX}${c.expert_a}`, `${CANON_NODE_PREFIX}${c.expert_b}`) === edgeId
    );
    if (!conflict) return null;
    return {
      kind: 'contrast',
      conflict,
      expertALabel: opts.canonLabel(conflict.expert_a),
      expertBLabel: opts.canonLabel(conflict.expert_b),
      isDevilsAdvocate: opts.devilsAdvocateActive,
    };
  }
  const edge = opts.edgesById.get(edgeId);
  return edge ? { kind: 'relation', edge } : null;
}
