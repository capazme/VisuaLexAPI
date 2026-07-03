import { useEffect, useRef } from 'react';
import { Graph } from '@antv/g6';
import type { NodeData, EdgeData, LayoutOptions } from '@antv/g6';
import { nodeStyleMapper, edgeStyleMapper } from './graphStyles';

/**
 * Shared G6 v5 graph canvas for both the article side rail and the /grafo page.
 *
 * Default export so consumers can code-split it via
 * `React.lazy(() => import('.../GraphCanvas'))` — @antv/g6 is heavy and must not
 * land in the main bundle.
 *
 * Filtering (hiddenNodeTypes/hiddenEdgeTypes) and legend highlight
 * (highlightNodeType) are applied imperatively via setElementVisibility /
 * setElementState WITHOUT re-running the layout, so the user's mental map of
 * the graph is preserved while exploring.
 */

export type GraphLayoutName =
  | 'cose-bilkent'
  | 'dagre'
  | 'breadthfirst'
  | 'concentric'
  | 'circle';

export interface GraphCanvasProps {
  nodes: NodeData[];
  edges: EdgeData[];
  layout?: GraphLayoutName;
  height?: number | string;
  /** Hide all nodes of these semantic types (and their dangling edges). */
  hiddenNodeTypes?: ReadonlySet<string>;
  /** Hide all edges of these relation types. */
  hiddenEdgeTypes?: ReadonlySet<string>;
  /** Emphasize nodes of this type (legend hover); fade the rest. null = clear. */
  highlightNodeType?: string | null;
  /**
   * Emphasize this SET of node ids (Slice 4 P1 "sources-as-nodes"): matched
   * nodes go `active`, the rest `inactive`. Takes precedence over
   * `highlightNodeType`. `null`/empty clears the emphasis.
   */
  highlightNodeIds?: ReadonlySet<string> | null;
  onNodeClick?: (nodeId: string) => void;
  onNodeDblClick?: (nodeId: string) => void;
  /**
   * Slice 4 P2a: a click on an edge (real relation OR synthetic contrast arc)
   * — the page resolves the id to a GraphEdgeSelection and opens the Nodo tab.
   */
  onEdgeClick?: (edgeId: string) => void;
}

function layoutConfig(name: GraphLayoutName): LayoutOptions {
  switch (name) {
    case 'dagre':
      return { type: 'antv-dagre', rankdir: 'TB', nodesep: 28, ranksep: 60 };
    case 'breadthfirst':
      return { type: 'antv-dagre', rankdir: 'LR', nodesep: 22, ranksep: 65 };
    case 'concentric':
      return { type: 'concentric', nodeSize: 34 };
    case 'circle':
      return { type: 'circular' };
    case 'cose-bilkent':
    default:
      return {
        type: 'd3-force',
        link: { distance: 130, strength: 0.4 },
        collide: { radius: 44, strength: 0.9 },
        manyBody: { strength: -320 },
        center: {},
        alphaDecay: 0.028,
      } as LayoutOptions;
  }
}

const NODE_STATE = {
  selected: { lineWidth: 3, stroke: '#0f172a', fillOpacity: 0.32 },
  active: { lineWidth: 3, fillOpacity: 0.3 },
  inactive: { opacity: 0.18 },
};
const EDGE_STATE = {
  active: { strokeOpacity: 1, lineWidth: 2.5, labelOpacity: 1 },
  inactive: { strokeOpacity: 0.06, labelOpacity: 0 },
};

function dataSignature(nodes: NodeData[], edges: EdgeData[]): string {
  return `${nodes.map((n) => n.id).join(',')}|${edges.map((e) => e.id).join(',')}`;
}

type Visibility = 'visible' | 'hidden';

function buildVisibilityMap(
  nodes: NodeData[],
  edges: EdgeData[],
  hiddenNodeTypes?: ReadonlySet<string>,
  hiddenEdgeTypes?: ReadonlySet<string>
): Record<string, Visibility> {
  const hiddenNodeIds = new Set<string>();
  const map: Record<string, Visibility> = {};
  for (const n of nodes) {
    const t = n.data?.type as string | undefined;
    const hidden = !!(t && hiddenNodeTypes?.has(t));
    if (hidden && n.id != null) hiddenNodeIds.add(String(n.id));
    if (n.id != null) map[String(n.id)] = hidden ? 'hidden' : 'visible';
  }
  for (const e of edges) {
    const t = e.data?.type as string | undefined;
    const hidden =
      !!(t && hiddenEdgeTypes?.has(t)) ||
      (e.source != null && hiddenNodeIds.has(String(e.source))) ||
      (e.target != null && hiddenNodeIds.has(String(e.target)));
    if (e.id != null) map[String(e.id)] = hidden ? 'hidden' : 'visible';
  }
  return map;
}

function buildHighlightState(
  nodes: NodeData[],
  edges: EdgeData[],
  type: string | null | undefined,
  ids: ReadonlySet<string> | null | undefined
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  // Id-set emphasis (deliberation sources) wins over the legend's type emphasis.
  const byIds = !!(ids && ids.size > 0);
  const active = byIds || !!type;
  for (const n of nodes) {
    if (n.id == null) continue;
    const id = String(n.id);
    if (!active) {
      map[id] = [];
      continue;
    }
    const isActive = byIds ? ids!.has(id) : n.data?.type === type;
    map[id] = isActive ? ['active'] : ['inactive'];
  }
  for (const e of edges) {
    if (e.id == null) continue;
    map[String(e.id)] = active ? ['inactive'] : [];
  }
  return map;
}

export default function GraphCanvas({
  nodes,
  edges,
  layout = 'cose-bilkent',
  height = 300,
  hiddenNodeTypes,
  hiddenEdgeTypes,
  highlightNodeType,
  highlightNodeIds,
  onNodeClick,
  onNodeDblClick,
  onEdgeClick,
}: GraphCanvasProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const dataSigRef = useRef<string>('');
  // Latest render() promise — all imperative ops (visibility/state) chain on it
  // so they never run before the in-flight render resolves (G6 requirement).
  const renderRef = useRef<Promise<unknown>>(Promise.resolve());

  // Keep handlers in refs so the once-attached listeners never go stale.
  const clickRef = useRef(onNodeClick);
  const dblRef = useRef(onNodeDblClick);
  const edgeClickRef = useRef(onEdgeClick);
  useEffect(() => {
    clickRef.current = onNodeClick;
    dblRef.current = onNodeDblClick;
    edgeClickRef.current = onEdgeClick;
  }, [onNodeClick, onNodeDblClick, onEdgeClick]);

  // Create the graph once. Data/filter/layout changes are applied by the
  // sibling effects below (G6 is an external system synced imperatively).
  useEffect(() => {
    if (!containerRef.current) return;
    const graph = new Graph({
      container: containerRef.current,
      autoResize: true,
      autoFit: 'view',
      padding: 24,
      data: { nodes, edges },
      node: { style: nodeStyleMapper, state: NODE_STATE },
      edge: { type: 'quadratic', style: edgeStyleMapper, state: EDGE_STATE },
      layout: layoutConfig(layout),
      behaviors: [
        'zoom-canvas',
        'drag-canvas',
        'drag-element',
        'click-select',
        // Hover emphasizes the node + its 1-degree neighbourhood (and reveals
        // their relation labels). It does NOT fade the rest — an aggressive
        // `inactiveState` left elements stuck transparent after a click. The
        // dim-others focus is reserved for the explicit legend hover.
        { type: 'hover-activate', degree: 1, state: 'active' },
      ],
    });
    graphRef.current = graph;
    dataSigRef.current = dataSignature(nodes, edges);

    graph.on('node:click', (e) => {
      const id = (e as unknown as { target?: { id?: string } }).target?.id;
      if (id) clickRef.current?.(id);
    });
    graph.on('node:dblclick', (e) => {
      const id = (e as unknown as { target?: { id?: string } }).target?.id;
      if (id) dblRef.current?.(id);
    });
    graph.on('edge:click', (e) => {
      const id = (e as unknown as { target?: { id?: string } }).target?.id;
      if (id) edgeClickRef.current?.(id);
    });

    // render() rejects with "The graph instance has been destroyed" if the
    // component unmounts (or StrictMode double-mounts) before it settles.
    // Swallow that rejection so it never surfaces as an unhandled error.
    renderRef.current = graph.render();
    renderRef.current.catch(() => {});

    return () => {
      graph.destroy();
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data OR filter change. Relayout only when the node/edge set actually changed;
  // a filter-only change just toggles visibility (preserves positions).
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    const sig = dataSignature(nodes, edges);
    const visibility = buildVisibilityMap(nodes, edges, hiddenNodeTypes, hiddenEdgeTypes);
    if (sig !== dataSigRef.current) {
      dataSigRef.current = sig;
      g.setData({ nodes, edges });
      renderRef.current = g.render();
      renderRef.current.catch(() => {});
    }
    // Apply visibility after the latest render resolves (covers both the data
    // path's fresh render and a filter-only change racing the initial render).
    // Guard on the instance still being current — the render may resolve after
    // a destroy (unmount / StrictMode), and calling into a destroyed graph throws.
    void renderRef.current
      .then(() => {
        if (graphRef.current === g) g.setElementVisibility(visibility);
      })
      .catch(() => {});
  }, [nodes, edges, hiddenNodeTypes, hiddenEdgeTypes]);

  // Legend hover (type) OR deliberation sources (id-set) → emphasize the match,
  // fade the rest (no relayout). The id-set wins when both are set.
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    void renderRef.current
      .then(() => {
        if (graphRef.current === g) {
          g.setElementState(buildHighlightState(nodes, edges, highlightNodeType, highlightNodeIds));
        }
      })
      .catch(() => {});
  }, [highlightNodeType, highlightNodeIds, nodes, edges]);

  // Re-run layout when the layout changes (no data refetch).
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    g.setLayout(layoutConfig(layout));
    // layout() also rejects if the instance is destroyed mid-flight.
    void g.layout().catch(() => {});
  }, [layout]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
