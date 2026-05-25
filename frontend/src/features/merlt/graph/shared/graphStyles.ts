import type { StylesheetJsonBlock, Css } from 'cytoscape';

type Stylesheet = StylesheetJsonBlock;

/**
 * Cytoscape stylesheet for the MERL-T legal knowledge graph.
 *
 * The graph carries ~20 node labels and 15 relation types (see the EXP-014
 * Libro IV seed). Each node type gets a colour + shape so the user can read the
 * graph at a glance; each relation type gets an edge colour + line style. Any
 * type not in the maps falls back to the base `node` / `edge` style, so the
 * view never renders a type-less node as invisible.
 *
 * Colours are picked for hue separation rather than theme tokens because
 * cytoscape renders to canvas (CSS variables are not resolvable there).
 */

export interface NodeTypeStyle {
  color: string;
  shape: Css.NodeShape;
}

export interface EdgeTypeStyle {
  color: string;
  lineStyle?: Css.LineStyle;
}

// Grouped by family so related labels share a hue neighbourhood.
export const NODE_TYPE_STYLE: Record<string, NodeTypeStyle> = {
  // Normative sources — blues
  Norma: { color: '#2563eb', shape: 'round-rectangle' },
  Comma: { color: '#3b82f6', shape: 'round-rectangle' },
  Lettera: { color: '#60a5fa', shape: 'round-rectangle' },
  // Concepts & principles — purples
  ConcettoGiuridico: { color: '#7c3aed', shape: 'ellipse' },
  DefinizioneLegale: { color: '#8b5cf6', shape: 'ellipse' },
  PrincipioGiuridico: { color: '#a855f7', shape: 'star' },
  // Doctrine & case law — ambers
  Dottrina: { color: '#d97706', shape: 'diamond' },
  AttoGiudiziario: { color: '#b45309', shape: 'diamond' },
  Caso: { color: '#f59e0b', shape: 'diamond' },
  // Facts, acts, effects — greens/teals
  FattoGiuridico: { color: '#059669', shape: 'hexagon' },
  AttoGiuridicoEntita: { color: '#10b981', shape: 'hexagon' },
  EffettoGiuridico: { color: '#14b8a6', shape: 'tag' },
  // Subjects & roles — pinks
  SoggettoGiuridico: { color: '#db2777', shape: 'ellipse' },
  Ruolo: { color: '#ec4899', shape: 'ellipse' },
  // Modalities, exceptions, procedures, remedies — slates/oranges
  ModalitaGiuridica: { color: '#475569', shape: 'barrel' },
  Eccezione: { color: '#ef4444', shape: 'triangle' },
  Procedura: { color: '#0ea5e9', shape: 'barrel' },
  Rimedio: { color: '#22c55e', shape: 'barrel' },
  Clausola: { color: '#6366f1', shape: 'round-rectangle' },
  Termine: { color: '#64748b', shape: 'barrel' },
};

export const EDGE_TYPE_STYLE: Record<string, EdgeTypeStyle> = {
  DISCIPLINA: { color: '#2563eb' },
  interpreta: { color: '#7c3aed' },
  APPLICA_A: { color: '#0ea5e9' },
  contiene: { color: '#94a3b8' },
  IMPONE: { color: '#dc2626' },
  commenta: { color: '#d97706', lineStyle: 'dashed' },
  ESPRIME_PRINCIPIO: { color: '#a855f7' },
  ATTRIBUISCE_RESPONSABILITA: { color: '#db2777' },
  PREVEDE: { color: '#059669' },
  DEFINISCE: { color: '#8b5cf6' },
  STABILISCE_TERMINE: { color: '#64748b' },
  PREVEDE_SANZIONE: { color: '#ef4444' },
  modifica: { color: '#f59e0b', lineStyle: 'dashed' },
  abroga: { color: '#b91c1c', lineStyle: 'dotted' },
  inserisce: { color: '#16a34a', lineStyle: 'dashed' },
};

/** Build the full cytoscape stylesheet: base styles + per-type overrides. */
export function buildGraphStylesheet(): Stylesheet[] {
  const base: Stylesheet[] = [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'background-color': '#94a3b8',
        shape: 'ellipse',
        width: 28,
        height: 28,
        'font-size': 9,
        color: '#0f172a',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 3,
        'text-wrap': 'wrap',
        'text-max-width': '90px',
        'border-width': 1,
        'border-color': '#475569',
      },
    },
    {
      selector: 'edge',
      style: {
        width: 1.5,
        'line-color': '#cbd5e1',
        'target-arrow-color': '#cbd5e1',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'font-size': 7,
        color: '#64748b',
        'text-rotation': 'autorotate',
      },
    },
    {
      selector: 'node:selected',
      style: { 'border-width': 3, 'border-color': '#0f172a' },
    },
  ];

  const nodeStyles: Stylesheet[] = Object.entries(NODE_TYPE_STYLE).map(([type, s]) => ({
    selector: `node[type="${type}"]`,
    style: { 'background-color': s.color, shape: s.shape },
  }));

  const edgeStyles: Stylesheet[] = Object.entries(EDGE_TYPE_STYLE).map(([type, s]) => ({
    selector: `edge[type="${type}"]`,
    style: {
      'line-color': s.color,
      'target-arrow-color': s.color,
      'line-style': s.lineStyle ?? 'solid',
    },
  }));

  return [...base, ...nodeStyles, ...edgeStyles];
}
