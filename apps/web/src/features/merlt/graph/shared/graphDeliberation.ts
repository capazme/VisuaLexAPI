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

/**
 * Fixed angle (radians, canvas convention: 0=E, π/2=S, π=O, -π/2=N) for each of
 * the 4 preleggi canons — a deterministic corona around the centered article
 * instead of leaving the force layout to scatter/overlap/push them off-screen
 * (audit item 5). GraphCanvas pins the corona to this ring in a post-layout
 * placement pass (see `repositionCanonNodes`).
 */
export const CANON_RING_ANGLE: Record<CanonKey, number> = {
  literal: -Math.PI / 2, // N
  systemic: 0, // E
  principles: Math.PI / 2, // S
  precedent: Math.PI, // O
};

/** Radius (px) of the canon corona around the center node. */
export const CANON_RING_RADIUS = 150;

/**
 * Deterministic position for a canon node on its fixed-angle ring around the
 * center. An unknown/extra canon key (beyond the 4 preleggi — the engine may
 * report more) falls back to an evenly-spaced diagonal slot keyed by `index`,
 * so it never collides with N/E/S/O nor with another extra.
 */
export function canonRingPosition(
  canonKey: string,
  center: { x: number; y: number },
  index: number,
  radius: number = CANON_RING_RADIUS
): { x: number; y: number } {
  const angle = CANON_RING_ANGLE[canonKey as CanonKey] ?? index * (Math.PI / 4) + Math.PI / 4;
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
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
  /**
   * Canon that played devil's advocate (`devils_advocate_flag.expert`), when
   * MERL-T derives one. A contrast arc is marked only when it touches THIS
   * canon; when absent/null (no derivation, or organic disagreement) every
   * active arc is marked, matching the pre-attribution global behaviour.
   */
  devilsAdvocateExpert?: string | null;
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
  const { contributions, conflicts, devilsAdvocateActive, devilsAdvocateExpert, centerNodeId } = input;
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
        // "Canone: …" prefix so a collegio voice is never mistaken for a corpus
        // PrincipioGiuridico node (which is also a star) in a principles debate.
        label: style?.label ? `Canone: ${style.label}` : key,
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
    // Scope the marker to the dissenting canon when one is derivable; fall
    // back to marking every active arc when it isn't (see interface doc).
    const devil =
      devilsAdvocateActive &&
      (!devilsAdvocateExpert || devilsAdvocateExpert === c.expert_a || devilsAdvocateExpert === c.expert_b);
    contrastEdges.push({
      id,
      source: `${CANON_NODE_PREFIX}${c.expert_a}`,
      target: `${CANON_NODE_PREFIX}${c.expert_b}`,
      data: {
        kind: 'contrast',
        conflictScore: score,
        devilsAdvocate: devil,
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
    /** See {@link DeliberationOverlayInput.devilsAdvocateExpert}. */
    devilsAdvocateExpert?: string | null;
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
    // The specific dissenting canon, only when it is one of THIS conflict's
    // two endpoints — otherwise leave it undefined so the badge falls back
    // to the generic (unscoped) wording.
    const scopedExpert =
      opts.devilsAdvocateExpert &&
      (opts.devilsAdvocateExpert === conflict.expert_a || opts.devilsAdvocateExpert === conflict.expert_b)
        ? opts.devilsAdvocateExpert
        : undefined;
    const isDevilsAdvocate =
      opts.devilsAdvocateActive && (!opts.devilsAdvocateExpert || scopedExpert !== undefined);
    return {
      kind: 'contrast',
      conflict,
      expertALabel: opts.canonLabel(conflict.expert_a),
      expertBLabel: opts.canonLabel(conflict.expert_b),
      isDevilsAdvocate,
      ...(scopedExpert !== undefined ? { devilsAdvocateExpertLabel: opts.canonLabel(scopedExpert) } : {}),
    };
  }
  const edge = opts.edgesById.get(edgeId);
  return edge ? { kind: 'relation', edge } : null;
}
