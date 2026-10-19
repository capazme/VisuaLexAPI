import type { GraphNode } from '../shared/types';
import type { QaRetrievedSource } from '../../qa/types';

/**
 * Bidirectional source-chip ↔ graph-node linking helpers (audit item 3). Kept
 * in a non-component module so both directions stay unit-testable without a
 * canvas/DOM. Both are resilient when the node isn't on the current canvas —
 * they simply return null/false, never throw.
 */

/**
 * Resolve a chip's target (`source.node_id ?? source.urn`) to a node already
 * present in the current subgraph — the same join `handleSourceCenter` uses
 * for its explicit re-center click, reused here for the non-destructive hover.
 */
export function resolveLocalSourceNode(
  nodeIdOrUrn: string,
  nodesById: Map<string, GraphNode>,
  nodes: GraphNode[]
): GraphNode | null {
  return nodesById.get(nodeIdOrUrn) ?? nodes.find((n) => n.urn === nodeIdOrUrn) ?? null;
}

/**
 * True when a consulted source resolves to the given graph node — the reverse
 * join for "selecting a node on the canvas highlights its matching source
 * chip". Mirrors the canvas sources-as-nodes join (GraphExplorerPage's
 * `sourceHighlightIds`): node_id first, else urn.
 */
export function sourceMatchesNode(source: QaRetrievedSource, node: GraphNode | null | undefined): boolean {
  if (!node) return false;
  if (source.node_id) return source.node_id === node.id;
  return Boolean(node.urn) && source.urn === node.urn;
}
