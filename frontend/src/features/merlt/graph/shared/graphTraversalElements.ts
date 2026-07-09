import type { NodeData, EdgeData } from '@antv/g6';
import type { GraphTraversalEdge } from '../../qa/types';
import { formatRetrievedUrn } from '../../qa/format';

/**
 * "Segui il ragionamento sul grafo" (walk mode) — turn the systemic expert's
 * ordered node→relation→node walk into a SELF-CONTAINED G6 element set: a
 * dedicated mini-graph replayed step-by-step on its own canvas (advisor
 * decision: a second small GraphCanvas instance, not a mutation of the main
 * subgraph — the walk routinely visits nodes never loaded into the current
 * view, e.g. `modalita:*` concept nodes at depth 1-2 around an article).
 *
 * Node ids ARE the raw urns (source_urn/target_urn) — de-duped by id, first
 * occurrence wins its label/type. Edge ids are synthesized as
 * `w<iteration>:<source>-<relation_type>-<target>` (stable, unique even when
 * the SAME relation type repeats across iterations between different nodes)
 * so `highlightEdgeIds` / step-sequencing can address one exact hop.
 *
 * Radial-replay annotations (user decision: NO aggregation, every hop stays a
 * distinct node+edge — rings by graph distance from the seed instead):
 *  - `data.isSeed` — the walk's origin, the node with the max OUT-degree
 *    across the hops (fallback: the first step's source). Anchors the radial
 *    layout's center (`GraphCanvas`'s `layoutFocusNodeId`).
 *  - `data.iteration` — the round a node was first REACHED as a target (0 for
 *    the seed and any other source-only node) — mirrors the ring index once
 *    laid out radially, since graph distance from the seed equals the round
 *    in this walk shape.
 *  - `data.walkNode` — set on every node the walk produced, so
 *    `graphStyles.nodeStyleMapper` can gate its walk-only sizing/label rules
 *    without touching the main subgraph canvas (which never sets this flag).
 *  - `data.walkLeaf` — leaf concept nodes (ModalitaGiuridica / ConcettoGiuridico,
 *    excluding the seed) — the dense outer fan whose persistent label is
 *    suppressed on canvas (kept on hover/selection).
 */

export interface GraphTraversalStep {
  /** Synthesized, stable edge id — matches the edge in the returned elements. */
  edgeId: string;
  iteration: number;
  sourceId: string;
  targetId: string;
  relationType: string;
}

export interface GraphTraversalElements {
  nodes: NodeData[];
  edges: EdgeData[];
  /** One entry per input edge, IN ORDER — the sequencer walks this array. */
  steps: GraphTraversalStep[];
}

/** Leaf concept types whose persistent label is suppressed in the radial replay (see `data.walkLeaf` above). */
const LEAF_NODE_TYPES = new Set(['ModalitaGiuridica', 'ConcettoGiuridico']);

/** Best-effort node "type" guess from a urn, for canvas styling (graphStyles' NODE_TYPE_STYLE). */
function guessNodeType(urn: string, targetType?: string): string {
  if (targetType) return targetType;
  if (urn.startsWith('live:')) return 'ConcettoGiuridico';
  if (urn.startsWith('massima_') || urn.includes('massima_cassazione')) return 'AttoGiudiziario';
  if (urn.startsWith('modalita:')) return 'ModalitaGiuridica';
  if (/normattiva\.it/i.test(urn) || urn.startsWith('urn:nir:')) return 'Norma';
  return 'ConcettoGiuridico';
}

function toNode(id: string, type: string): NodeData {
  return {
    id,
    data: { label: formatRetrievedUrn(id), type, urn: id },
  };
}

export function graphTraversalToElements(walk: GraphTraversalEdge[]): GraphTraversalElements {
  const nodesById = new Map<string, NodeData>();
  const edges: EdgeData[] = [];
  const steps: GraphTraversalStep[] = [];
  const seenEdgeIds = new Set<string>();
  // Seed detection: out-degree per node (source-side hop count).
  const outDegree = new Map<string, number>();
  // Round a node was first REACHED as a target — the basis for `data.iteration`.
  const targetFirstIteration = new Map<string, number>();

  for (const hop of walk) {
    if (!hop.source_urn || !hop.target_urn) continue;
    if (!nodesById.has(hop.source_urn)) {
      nodesById.set(hop.source_urn, toNode(hop.source_urn, guessNodeType(hop.source_urn)));
    }
    if (!nodesById.has(hop.target_urn)) {
      nodesById.set(hop.target_urn, toNode(hop.target_urn, guessNodeType(hop.target_urn, hop.target_type)));
    }
    outDegree.set(hop.source_urn, (outDegree.get(hop.source_urn) ?? 0) + 1);
    if (!targetFirstIteration.has(hop.target_urn)) {
      targetFirstIteration.set(hop.target_urn, hop.iteration);
    }

    let edgeId = `w${hop.iteration}:${hop.source_urn}-${hop.relation_type}-${hop.target_urn}`;
    // Extremely defensive: if the SAME hop repeats verbatim, keep ids unique
    // by suffixing an occurrence counter (the sequencer needs one entry per step).
    let suffix = 0;
    while (seenEdgeIds.has(edgeId)) {
      suffix += 1;
      edgeId = `w${hop.iteration}:${hop.source_urn}-${hop.relation_type}-${hop.target_urn}#${suffix}`;
    }
    seenEdgeIds.add(edgeId);

    edges.push({
      id: edgeId,
      source: hop.source_urn,
      target: hop.target_urn,
      data: { label: hop.relation_type, type: hop.relation_type },
    });
    steps.push({
      edgeId,
      iteration: hop.iteration,
      sourceId: hop.source_urn,
      targetId: hop.target_urn,
      relationType: hop.relation_type,
    });
  }

  // Seed = max out-degree (first-inserted id wins ties — Map iteration order
  // mirrors first-encounter order); falls back to the first step's source for
  // the (practically unreachable, since every step's source counts toward
  // outDegree) case where no out-degree entry exists.
  let seedId: string | undefined;
  let seedDegree = -1;
  for (const [id, degree] of outDegree) {
    if (degree > seedDegree) {
      seedDegree = degree;
      seedId = id;
    }
  }
  if (seedId === undefined) seedId = steps[0]?.sourceId;

  for (const [id, node] of nodesById) {
    const type = (node.data as { type?: string } | undefined)?.type;
    const isSeed = id === seedId;
    node.data = {
      ...node.data,
      isSeed,
      walkNode: true,
      iteration: targetFirstIteration.get(id) ?? 0,
      walkLeaf: !isSeed && !!type && LEAF_NODE_TYPES.has(type),
    };
  }

  return { nodes: [...nodesById.values()], edges, steps };
}
