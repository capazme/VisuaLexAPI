import type { GraphElements } from './graphTransform';

export interface TypeCount {
  type: string;
  count: number;
}

export interface TypeCounts {
  nodes: TypeCount[];
  edges: TypeCount[];
}

function tally(items: Array<{ data?: { type?: unknown } }>): TypeCount[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const t = it.data?.type;
    if (typeof t !== 'string' || !t) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/**
 * Tally node/edge counts per semantic type for the filter panel / legend.
 * Reads `data.type` (Norma, DISCIPLINA, …); items without a type are skipped.
 */
export function computeTypeCounts(elements: GraphElements): TypeCounts {
  return {
    nodes: tally(elements.nodes as Array<{ data?: { type?: unknown } }>),
    edges: tally(elements.edges as Array<{ data?: { type?: unknown } }>),
  };
}
