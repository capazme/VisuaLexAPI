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

/** Render shape for a semantic node type (fallback: circle). */
export function nodeG6Type(semanticType: string | undefined): G6NodeShape {
  return (semanticType && NODE_TYPE_STYLE[semanticType]?.g6Type) || 'circle';
}

/** G6 node style mapper — reads the semantic type/label from `datum.data`. */
export function nodeStyleMapper(datum: NodeData): Record<string, unknown> {
  const data = (datum.data ?? {}) as {
    type?: string;
    label?: string;
    provenance?: NodeProvenance;
    trust?: number;
  };
  const color = (data.type && NODE_TYPE_STYLE[data.type]?.color) || DEFAULT_NODE_COLOR;
  const prov = data.provenance ? PROVENANCE_STYLE[data.provenance] : undefined;
  // Trust nudges fill saturation so a solid seed reads denser than a faint
  // provisional source; clamped so nothing disappears or over-saturates.
  const fillOpacity =
    typeof data.trust === 'number'
      ? Math.min(0.32, Math.max(0.1, 0.1 + 0.22 * data.trust))
      : 0.18;
  return {
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
}

/** G6 edge style mapper — reads the relation type/label from `datum.data`. */
export function edgeStyleMapper(datum: EdgeData): Record<string, unknown> {
  const data = (datum.data ?? {}) as { type?: string; label?: string };
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
