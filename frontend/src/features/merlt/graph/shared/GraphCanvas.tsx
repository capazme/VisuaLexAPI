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
  onNodeClick?: (nodeId: string) => void;
  onNodeDblClick?: (nodeId: string) => void;
  /** Click on a relation edge → opens the EdgeDetailsDrawer. */
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
  type: string | null | undefined
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const n of nodes) {
    if (n.id == null) continue;
    if (!type) map[String(n.id)] = [];
    else map[String(n.id)] = n.data?.type === type ? ['active'] : ['inactive'];
  }
  for (const e of edges) {
    if (e.id == null) continue;
    map[String(e.id)] = type ? ['inactive'] : [];
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

    renderRef.current = graph.render();

    return () => {
      graph.destroy();
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data OR filter change. Relayout only when the node/edge set actually changed;
  // a filter-only change just toggles visibility (preserves positions).
  //
  // Every async continuation guards on `graphRef.current === g`: if React 18's
  // StrictMode (or a real unmount) destroyed `g` between effect start and the
  // resolution of the in-flight render, the captured `g` is now dead and
  // calling methods on it logs "The graph instance has been destroyed".
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    const sig = dataSignature(nodes, edges);
    const visibility = buildVisibilityMap(nodes, edges, hiddenNodeTypes, hiddenEdgeTypes);
    if (sig !== dataSigRef.current) {
      dataSigRef.current = sig;
      g.setData({ nodes, edges });
      renderRef.current = g.render();
    }
    void renderRef.current
      .then(() => {
        if (graphRef.current !== g) return;
        g.setElementVisibility(visibility);
      })
      .catch(() => {});
  }, [nodes, edges, hiddenNodeTypes, hiddenEdgeTypes]);

  // Legend hover → emphasize nodes of a type, fade the rest (no relayout).
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    void renderRef.current
      .then(() => {
        if (graphRef.current !== g) return;
        g.setElementState(buildHighlightState(nodes, edges, highlightNodeType));
      })
      .catch(() => {});
  }, [highlightNodeType, nodes, edges]);

  // Re-run layout when the layout changes (no data refetch). Chain on the
  // latest render and guard so we never call .layout() on a destroyed instance
  // (g6's internal layout chain throws "Cannot read properties of undefined
  // (reading 'postLayout')" if the graph dies mid-flight).
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    void renderRef.current
      .then(() => {
        if (graphRef.current !== g) return;
        g.setLayout(layoutConfig(layout));
        return g.layout();
      })
      .catch(() => {});
  }, [layout]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
