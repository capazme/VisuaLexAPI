import type { GraphData, NodeData, EdgeData } from '@antv/g6';
import type { SubgraphResponse, GraphNodeData } from './types';
import { deriveProvenance, readNodeTrust } from './types';
import { nodeG6Type } from './graphStyles';

export type GraphElements = Required<Pick<GraphData, 'nodes' | 'edges'>>;

/**
 * Convert a BFF subgraph response into G6 v5 GraphData.
 *
 * Invariants preserved from the data contract:
 *  - node ids unique (later duplicates dropped),
 *  - every edge references existing source AND target (dangling edges dropped),
 *  - edge id synthesized from source/type/target when MERL-T omits it.
 *
 * The semantic label lives in `data.type` (Norma, ConcettoGiuridico, …); the
 * G6 render shape is the item-level `type` (circle/rect/…), derived from it.
 *
 * Slice 4 P1 widens `node.data` to also carry `provenance`, `trust` and a raw
 * `properties` passthrough so the CANVAS (not just the drawer) can colour nodes
 * by provenance/trust. Dedup + dangling-edge logic is unchanged.
 */
export function transformSubgraphResponse(response: SubgraphResponse): GraphElements {
  const seen = new Set<string>();
  const nodes: NodeData[] = [];

  for (const node of response.nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    const data: GraphNodeData = {
      label: node.label,
      type: node.type,
      urn: node.urn ?? undefined,
      provenance: deriveProvenance(node),
      trust: readNodeTrust(node),
      properties: node.properties,
    };
    nodes.push({ id: node.id, type: nodeG6Type(node.type), data });
  }

  const edges: EdgeData[] = [];
  for (const edge of response.edges) {
    if (!seen.has(edge.source) || !seen.has(edge.target)) continue;
    const id = edge.id ?? `${edge.source}-${edge.type}-${edge.target}`;
    edges.push({
      id,
      source: edge.source,
      target: edge.target,
      data: { label: edge.type, type: edge.type },
    });
  }

  return { nodes, edges };
}
