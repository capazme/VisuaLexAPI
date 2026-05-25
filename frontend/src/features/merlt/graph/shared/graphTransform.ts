import type { ElementDefinition } from 'cytoscape';
import type { SubgraphResponse } from './types';

export interface CytoscapeElements {
  nodes: ElementDefinition[];
  edges: ElementDefinition[];
}

/**
 * Convert a BFF subgraph response into cytoscape element definitions.
 *
 * Two correctness invariants cytoscape itself enforces, handled here so the
 * view never throws:
 *  - node ids must be unique (later duplicates are dropped),
 *  - every edge must reference existing source AND target nodes (dangling
 *    edges are dropped rather than crashing cytoscape on init).
 */
export function transformSubgraphResponse(response: SubgraphResponse): CytoscapeElements {
  const seen = new Set<string>();
  const nodes: ElementDefinition[] = [];

  for (const node of response.nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    nodes.push({
      data: {
        id: node.id,
        label: node.label,
        type: node.type,
        urn: node.urn ?? undefined,
      },
    });
  }

  const edges: ElementDefinition[] = [];
  for (const edge of response.edges) {
    if (!seen.has(edge.source) || !seen.has(edge.target)) continue;
    const id = edge.id ?? `${edge.source}-${edge.type}-${edge.target}`;
    edges.push({
      data: {
        id,
        source: edge.source,
        target: edge.target,
        type: edge.type,
        label: edge.type,
      },
    });
  }

  return { nodes, edges };
}
