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
      return { type: 'antv-dagre', rankdir: 'TB', nodesep: 25, ranksep: 55 };
    case 'breadthfirst':
      return { type: 'antv-dagre', rankdir: 'LR', nodesep: 20, ranksep: 60 };
    case 'concentric':
      return { type: 'concentric', nodeSize: 32 };
    case 'circle':
      return { type: 'circular' };
    case 'cose-bilkent':
    default:
      return {
        type: 'd3-force',
        link: { distance: 90 },
        collide: { radius: 30 },
        manyBody: { strength: -180 },
      };
  }
}

const SELECTED_STATE_STYLE = { lineWidth: 3, stroke: '#0f172a', halo: true };

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
      data: { nodes, edges },
      node: { style: nodeStyleMapper, state: { selected: SELECTED_STATE_STYLE } },
      edge: { type: 'line', style: edgeStyleMapper },
      layout: layoutConfig(layout),
      behaviors: ['zoom-canvas', 'drag-canvas', 'drag-element', 'click-select'],
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
