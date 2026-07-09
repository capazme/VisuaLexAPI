import type { NodeData, EdgeData } from '@antv/g6';
import type { NodeProvenance } from './types';

/**
 * G6 v5 styling for the MERL-T legal knowledge graph.
 *
 * ~20 node labels + 15 relation types. Each node type gets a colour + a G6
 * built-in shape; each relation type an edge colour + line style. Anything not
 * in the maps falls back to a neutral default so nothing renders invisible.
 *
 * Colours are hand-picked for hue separation (canvas render — no CSS vars).
 */

export type G6NodeShape =
  | 'circle'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'star'
  | 'hexagon';

export interface NodeTypeStyle {
  color: string;
  g6Type: G6NodeShape;
}

export interface EdgeTypeStyle {
  color: string;
  dash?: boolean;
}

export const NODE_TYPE_STYLE: Record<string, NodeTypeStyle> = {
  // Normative sources — blues
  Norma: { color: '#2563eb', g6Type: 'rect' },
  Comma: { color: '#3b82f6', g6Type: 'rect' },
  Lettera: { color: '#60a5fa', g6Type: 'rect' },
  // Concepts & principles — purples
  ConcettoGiuridico: { color: '#7c3aed', g6Type: 'circle' },
  DefinizioneLegale: { color: '#8b5cf6', g6Type: 'circle' },
  PrincipioGiuridico: { color: '#a855f7', g6Type: 'star' },
  // Doctrine & case law — ambers
  Dottrina: { color: '#d97706', g6Type: 'diamond' },
  AttoGiudiziario: { color: '#b45309', g6Type: 'diamond' },
  Caso: { color: '#f59e0b', g6Type: 'diamond' },
  // Facts, acts, effects — greens/teals
  FattoGiuridico: { color: '#059669', g6Type: 'hexagon' },
  AttoGiuridicoEntita: { color: '#10b981', g6Type: 'hexagon' },
  EffettoGiuridico: { color: '#14b8a6', g6Type: 'ellipse' },
  // Subjects & roles — pinks
  SoggettoGiuridico: { color: '#db2777', g6Type: 'circle' },
  Ruolo: { color: '#ec4899', g6Type: 'circle' },
  // Modalities, exceptions, procedures, remedies
  ModalitaGiuridica: { color: '#475569', g6Type: 'rect' },
  Eccezione: { color: '#ef4444', g6Type: 'triangle' },
  Procedura: { color: '#0ea5e9', g6Type: 'rect' },
  Rimedio: { color: '#22c55e', g6Type: 'rect' },
  Clausola: { color: '#6366f1', g6Type: 'rect' },
  Termine: { color: '#64748b', g6Type: 'rect' },
};

export const EDGE_TYPE_STYLE: Record<string, EdgeTypeStyle> = {
  DISCIPLINA: { color: '#2563eb' },
  interpreta: { color: '#7c3aed' },
  APPLICA_A: { color: '#0ea5e9' },
  contiene: { color: '#94a3b8' },
  IMPONE: { color: '#dc2626' },
  commenta: { color: '#d97706', dash: true },
  ESPRIME_PRINCIPIO: { color: '#a855f7' },
  ATTRIBUISCE_RESPONSABILITA: { color: '#db2777' },
  PREVEDE: { color: '#059669' },
  DEFINISCE: { color: '#8b5cf6' },
  STABILISCE_TERMINE: { color: '#64748b' },
  PREVEDE_SANZIONE: { color: '#ef4444' },
  modifica: { color: '#f59e0b', dash: true },
  abroga: { color: '#b91c1c', dash: true },
  inserisce: { color: '#16a34a', dash: true },
};

const DEFAULT_NODE_COLOR = '#94a3b8';
const DEFAULT_EDGE_COLOR = '#cbd5e1';

/**
 * Radial-replay walk-mode sizing (GraphTraversalPlayer / graphTraversalElements —
 * gated on `data.walkNode`, so the main subgraph canvas is never affected).
 * Fixed dark ring for the seed anchor — distinct from every type hue so the
 * origin of the walk reads unambiguously regardless of its semantic type.
 */
const SEED_RING_COLOR = '#0f172a';
const WALK_LEAF_SIZE = 20;
const WALK_LARGE_TYPES = new Set(['Norma', 'Comma', 'AttoGiudiziario', 'Caso']);
const WALK_MEDIUM_TYPES = new Set(['PrincipioGiuridico', 'DefinizioneLegale']);
const WALK_DEFAULT_SIZE = 30;
const WALK_SEED_SIZE = 54;

function walkNodeSize(type: string | undefined, isSeed: boolean, isLeaf: boolean): number {
  if (isSeed) return WALK_SEED_SIZE;
  if (isLeaf) return WALK_LEAF_SIZE;
  if (type && WALK_LARGE_TYPES.has(type)) return 46;
  if (type && WALK_MEDIUM_TYPES.has(type)) return 30;
  return WALK_DEFAULT_SIZE;
}

/**
 * Border treatment keyed on node provenance (Slice 4 P1).
 *
 * The border, NOT the fill, encodes provenance so the type hue (fill) stays
 * legible: a `seed` node looks exactly as before; `community_validated` gets a
 * thicker peer-review ring; `live_unconfirmed` gets a dashed amber outline that
 * overrides the type stroke so provisional sources are unmistakable on canvas.
 */
export interface ProvenanceStyle {
  lineWidth: number;
  lineDash?: [number, number];
  /** When set, overrides the type-hue stroke (amber for provisional). */
  strokeOverride?: string;
}

const PROVISIONAL_AMBER = '#d97706';

export const PROVENANCE_STYLE: Record<NodeProvenance, ProvenanceStyle> = {
  seed: { lineWidth: 1.75 },
  community_validated: { lineWidth: 3 },
  live_unconfirmed: { lineWidth: 2, lineDash: [4, 3], strokeOverride: PROVISIONAL_AMBER },
};

/**
 * Ids of edges incident to `nodeId` (either endpoint) — audit item 1: when a
 * node is selected, its incident edges are promoted to the 'active' G6 state
 * so EDGE_STATE.active's `labelOpacity: 1` reveals their relation labels
 * (normally hidden until hover). Empty for a null/absent node — no-op, never
 * throws. Used by GraphCanvas's `buildElementStates`.
 */
export function incidentEdgeIds(edges: EdgeData[], nodeId: string | null | undefined): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!nodeId) return ids;
  for (const e of edges) {
    if (e.id == null) continue;
    if (String(e.source) === nodeId || String(e.target) === nodeId) ids.add(String(e.id));
  }
  return ids;
}

/** Render shape for a semantic node type (fallback: circle). */
export function nodeG6Type(semanticType: string | undefined): G6NodeShape {
  return (semanticType && NODE_TYPE_STYLE[semanticType]?.g6Type) || 'circle';
}

/**
 * Slice 4 P2a — canon-node styling. A synthetic canon node (`data.kind:'canon'`)
 * carries its own colour + routing weight; size/opacity scale with the weight so
 * a consulted canon reads bold and a not-consulted one stays a dim hint.
 */
function canonNodeStyle(data: {
  label?: string;
  color?: string;
  weight?: number;
}): Record<string, unknown> {
  const color = data.color ?? '#475569';
  const w = typeof data.weight === 'number' ? Math.max(0, Math.min(1, data.weight)) : 0;
  const size = 26 + Math.round(28 * w); // 26px (dim) → 54px (dominant canon)
  const opacity = 0.28 + 0.62 * w;
  return {
    fill: color,
    fillOpacity: opacity,
    stroke: color,
    strokeOpacity: opacity,
    lineWidth: 2.5,
    // A luminous halo ring — a silhouette NO corpus node type carries — so a
    // canon "voice" is unmistakable next to a corpus PrincipioGiuridico star.
    halo: true,
    haloStroke: color,
    haloLineWidth: 6,
    haloStrokeOpacity: 0.2 + 0.3 * w,
    size,
    labelText: data.label ?? '',
    labelFill: color,
    labelFontSize: 12,
    labelFontWeight: 700,
    labelPlacement: 'bottom',
    labelBackground: true,
    labelBackgroundFill: '#ffffff',
    labelBackgroundOpacity: 0.85,
    labelBackgroundRadius: 3,
    labelPadding: [1, 4],
  };
}

/** G6 node style mapper — reads the semantic type/label from `datum.data`. */
export function nodeStyleMapper(datum: NodeData): Record<string, unknown> {
  const data = (datum.data ?? {}) as {
    kind?: string;
    type?: string;
    label?: string;
    color?: string;
    weight?: number;
    provenance?: NodeProvenance;
    trust?: number;
    isSeed?: boolean;
    walkNode?: boolean;
    walkLeaf?: boolean;
  };
  if (data.kind === 'canon') return canonNodeStyle(data);
  const color = (data.type && NODE_TYPE_STYLE[data.type]?.color) || DEFAULT_NODE_COLOR;
  const prov = data.provenance ? PROVENANCE_STYLE[data.provenance] : undefined;
  // Trust nudges fill saturation so a solid seed reads denser than a faint
  // provisional source; clamped so nothing disappears or over-saturates.
  const fillOpacity =
    typeof data.trust === 'number'
      ? Math.min(0.32, Math.max(0.1, 0.1 + 0.22 * data.trust))
      : 0.18;

  const base: Record<string, unknown> = {
    // Soft tinted fill + saturated border in the type hue → readable, not garish.
    // Provenance overrides the border (ring / dashed amber), never the fill hue.
    fill: color,
    fillOpacity,
    stroke: prov?.strokeOverride ?? color,
    lineWidth: prov?.lineWidth ?? 1.75,
    lineDash: prov?.lineDash,
    size: 30,
    radius: 6,
    labelText: data.label ?? '',
    labelFill: '#0f172a',
    labelFontSize: 10,
    labelFontWeight: 500,
    labelPlacement: 'bottom',
    labelMaxWidth: 130,
    labelWordWrap: true,
    labelMaxLines: 2,
    labelBackground: true,
    labelBackgroundFill: '#ffffff',
    labelBackgroundOpacity: 0.72,
    labelBackgroundRadius: 3,
    labelPadding: [1, 3],
  };

  // Radial-replay overrides (GraphTraversalPlayer only — gated on `walkNode`,
  // set exclusively by graphTraversalToElements; the main subgraph canvas
  // never sets this flag, so its nodes fall through unchanged above).
  if (data.walkNode !== true) return base;

  const isSeed = data.isSeed === true;
  const isLeaf = data.walkLeaf === true;
  return {
    ...base,
    fillOpacity: isSeed ? Math.min(0.55, fillOpacity + 0.24) : fillOpacity,
    stroke: isSeed ? SEED_RING_COLOR : base.stroke,
    lineWidth: isSeed ? 3 : base.lineWidth,
    size: walkNodeSize(data.type, isSeed, isLeaf),
    // Leaves (the dense outer fan) lose their persistent label — the seed and
    // every other walk node keep the full label as before.
    ...(isLeaf ? { labelText: '', labelOpacity: 0, labelMaxLines: 1 } : {}),
  };
}

/** Contrast-arc colours (Slice 4 P2a). Oxblood for an organic split; a
 *  distinct violet for a deliberate devil's-advocate challenge. */
export const CONTRAST_ARC_COLOR = '#b91c1c';
export const DEVILS_ADVOCATE_ARC_COLOR = '#7c3aed';

/**
 * Slice 4 P2a — contrast-arc styling: a dashed edge between two canon nodes,
 * thickness ∝ `conflictScore`. A devil's-advocate dissent is drawn in a distinct
 * violet with a tighter dash so a deliberate challenge reads apart from an
 * organic split.
 */
function contrastEdgeStyle(data: {
  conflictScore?: number;
  devilsAdvocate?: boolean;
  label?: string;
}): Record<string, unknown> {
  const score = typeof data.conflictScore === 'number' ? Math.max(0, Math.min(1, data.conflictScore)) : 0;
  const devil = data.devilsAdvocate === true;
  const color = devil ? DEVILS_ADVOCATE_ARC_COLOR : CONTRAST_ARC_COLOR;
  return {
    stroke: color,
    strokeOpacity: 0.85,
    lineWidth: 1.5 + 5 * score, // 1.5px (faint) → 6.5px (sharp contrast)
    lineDash: devil ? [2, 3] : [6, 4],
    endArrow: false,
    startArrow: false,
    labelText: data.label ?? 'contrasto',
    labelOpacity: 0,
    labelFontSize: 9,
    labelFill: color,
    labelBackground: true,
    labelBackgroundFill: '#ffffff',
    labelBackgroundOpacity: 0.9,
    labelBackgroundRadius: 2,
  };
}

/** G6 edge style mapper — reads the relation type/label from `datum.data`. */
export function edgeStyleMapper(datum: EdgeData): Record<string, unknown> {
  const data = (datum.data ?? {}) as {
    kind?: string;
    type?: string;
    label?: string;
    conflictScore?: number;
    devilsAdvocate?: boolean;
  };
  if (data.kind === 'contrast') return contrastEdgeStyle(data);
  if (data.kind === 'canon-anchor') {
    // Structural tether canon→center: faint, arrow-less, unlabeled; it only
    // guides the layout, never a relation the jurist inspects.
    return {
      stroke: '#cbd5e1',
      strokeOpacity: 0.25,
      lineWidth: 1,
      lineDash: [2, 4],
      endArrow: false,
      labelText: '',
      labelOpacity: 0,
    };
  }
  const spec = data.type ? EDGE_TYPE_STYLE[data.type] : undefined;
  const color = spec?.color ?? DEFAULT_EDGE_COLOR;
  return {
    stroke: color,
    strokeOpacity: 0.5,
    lineWidth: 1.25,
    lineDash: spec?.dash ? [4, 4] : undefined,
    endArrow: true,
    endArrowSize: 6,
    // Relation labels hidden until hover (hover-activate flips labelOpacity) to
    // keep dense graphs clean; text stays set for tooltips/accessibility.
    labelText: data.label ?? '',
    labelOpacity: 0,
    labelFontSize: 9,
    labelFill: '#475569',
    labelBackground: true,
    labelBackgroundFill: '#ffffff',
    labelBackgroundOpacity: 0.85,
    labelBackgroundRadius: 2,
  };
}
