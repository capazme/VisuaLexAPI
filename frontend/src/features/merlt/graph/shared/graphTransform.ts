import type { GraphData, NodeData, EdgeData } from '@antv/g6';
import type { SubgraphResponse, GraphNode, GraphNodeData } from './types';
import { deriveProvenance, readNodeTrust } from './types';
import { nodeG6Type, humanizeEdgeType } from './graphStyles';

export type GraphElements = Required<Pick<GraphData, 'nodes' | 'edges'>>;

/** Map ONE raw BFF node to its G6 item (shared by transform + merge paths). */
function toNodeData(node: GraphNode, expanded?: boolean): NodeData {
  const data: GraphNodeData = {
    label: node.label,
    type: node.type,
    urn: node.urn ?? undefined,
    provenance: deriveProvenance(node),
    trust: readNodeTrust(node),
    properties: node.properties,
    // F2: nodes that entered the view via expand-in-place carry the tag so
    // consumers can tell them apart from the original subgraph.
    ...(expanded ? { expanded: true } : {}),
  };
  return { id: node.id, type: nodeG6Type(node.type), data };
}

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
    nodes.push(toNodeData(node));
  }

  const edges: EdgeData[] = [];
  for (const edge of response.edges) {
    if (!seen.has(edge.source) || !seen.has(edge.target)) continue;
    const id = edge.id ?? `${edge.source}-${edge.type}-${edge.target}`;
    edges.push({
      id,
      source: edge.source,
      target: edge.target,
      data: { label: humanizeEdgeType(edge.type), type: edge.type },
    });
  }

  return { nodes, edges };
}

/**
 * F2 (Wave 2) — expand-in-place merge: layer a RAW delta subgraph (a node's
 * depth-1 neighborhood) on top of already-transformed elements.
 *
 *  - node dedupe by id: existing nodes WIN (their object identity — and thus
 *    any position the canvas carried onto them — is preserved);
 *  - new nodes are transformed exactly like {@link transformSubgraphResponse}
 *    and tagged `data.expanded: true`;
 *  - edges deduped by id (synthesized from source/type/target when missing)
 *    and dropped when dangling against the MERGED node set — so a delta edge
 *    pointing at a pre-existing node is kept, unlike a lone transform of the
 *    delta would;
 *  - returns `current` UNCHANGED (same reference) when the delta adds nothing,
 *    so canvas data signatures never churn spuriously.
 */
export function mergeElements(
  current: GraphElements,
  delta: Pick<SubgraphResponse, 'nodes' | 'edges'>
): GraphElements {
  const nodeIds = new Set(
    current.nodes.filter((n) => n.id != null).map((n) => String(n.id))
  );
  const addedNodes: NodeData[] = [];
  for (const node of delta.nodes) {
    if (nodeIds.has(node.id)) continue;
    nodeIds.add(node.id);
    addedNodes.push(toNodeData(node, true));
  }

  const edgeIds = new Set(
    current.edges.filter((e) => e.id != null).map((e) => String(e.id))
  );
  const addedEdges: EdgeData[] = [];
  for (const edge of delta.edges) {
    const id = edge.id ?? `${edge.source}-${edge.type}-${edge.target}`;
    if (edgeIds.has(id)) continue;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    edgeIds.add(id);
    addedEdges.push({
      id,
      source: edge.source,
      target: edge.target,
      data: { label: humanizeEdgeType(edge.type), type: edge.type },
    });
  }

  if (addedNodes.length === 0 && addedEdges.length === 0) return current;
  return {
    nodes: [...current.nodes, ...addedNodes],
    edges: [...current.edges, ...addedEdges],
  };
}
