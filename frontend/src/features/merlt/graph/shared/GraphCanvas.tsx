import { useEffect, useRef } from 'react';
import { Graph } from '@antv/g6';
import type { NodeData, EdgeData, LayoutOptions } from '@antv/g6';
import { nodeStyleMapper, edgeStyleMapper } from './graphStyles';

/**
 * Shared G6 v5 graph canvas for both the article side rail and the /grafo page.
 *
 * Default export so consumers can code-split it via
 * `React.lazy(() => import('.../GraphCanvas'))` — @antv/g6 is heavy and must not
 * land in the main bundle. Same prop contract as the previous Cytoscape view,
 * so the side rail / page didn't change shape.
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
  onNodeClick?: (nodeId: string) => void;
  onNodeDblClick?: (nodeId: string) => void;
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
      // d3-force tuned to spread nodes and prevent overlap (collide ≈ node size
      // + label room); gentle settling so it doesn't jitter forever.
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

// Node/edge state styles driven by click-select + hover-activate.
const NODE_STATE = {
  selected: { lineWidth: 3, stroke: '#0f172a', fillOpacity: 0.32 },
  active: { lineWidth: 3, fillOpacity: 0.3 },
  inactive: { opacity: 0.18 },
};
const EDGE_STATE = {
  active: { strokeOpacity: 1, lineWidth: 2.5, labelOpacity: 1 },
  inactive: { strokeOpacity: 0.06, labelOpacity: 0 },
};

export default function GraphCanvas({
  nodes,
  edges,
  layout = 'cose-bilkent',
  height = 300,
  onNodeClick,
  onNodeDblClick,
}: GraphCanvasProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);

  // Keep handlers in refs so the once-attached listeners never go stale.
  const clickRef = useRef(onNodeClick);
  const dblRef = useRef(onNodeDblClick);
  useEffect(() => {
    clickRef.current = onNodeClick;
    dblRef.current = onNodeDblClick;
  }, [onNodeClick, onNodeDblClick]);

  // Create the graph once. Data/layout changes are handled by the effects below.
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
        // Hover a node → highlight it + its 1-degree neighbourhood, fade the rest
        // (and reveal the relation labels of the active edges).
        { type: 'hover-activate', degree: 1, state: 'active', inactiveState: 'inactive' },
      ],
    });
    graphRef.current = graph;

    graph.on('node:click', (e) => {
      const id = (e as unknown as { target?: { id?: string } }).target?.id;
      if (id) clickRef.current?.(id);
    });
    graph.on('node:dblclick', (e) => {
      const id = (e as unknown as { target?: { id?: string } }).target?.id;
      if (id) dblRef.current?.(id);
    });

    void graph.render();

    return () => {
      graph.destroy();
      graphRef.current = null;
    };
    // Create-once: subsequent nodes/edges/layout changes are applied by the
    // sibling effects below (G6 graph is an external system synced imperatively).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-feed data when nodes/edges change.
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    g.setData({ nodes, edges });
    void g.render();
  }, [nodes, edges]);

  // Re-run layout when the layout changes (no data refetch).
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    g.setLayout(layoutConfig(layout));
    void g.layout();
  }, [layout]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
