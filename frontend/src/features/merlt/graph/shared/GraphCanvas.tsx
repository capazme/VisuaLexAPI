import { useEffect, useImperativeHandle, useRef } from 'react';
import { Graph } from '@antv/g6';
import type { NodeData, EdgeData, LayoutOptions, Point } from '@antv/g6';
import { nodeStyleMapper, edgeStyleMapper, incidentEdgeIds } from './graphStyles';
import { canonRingPosition, isDeliberationElementId } from './graphDeliberation';

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
 *
 * F1 (Wave 2) — persistent canvas:
 *  - position carry-over: on a data change, surviving nodes keep their laid-out
 *    x/y (injected into the new NodeData) so d3-force resumes from the current
 *    picture instead of re-scrambling it; new nodes spawn near their first
 *    positioned neighbour (centroid fallback).
 *  - fit discipline: fitView only on the FIRST render and on explicit `fit()`.
 *    A center CHANGE animates the camera (focusElement) when the new center
 *    already existed in the old graph; same-center updates (overlay arrival,
 *    revalidation refreshes, expand-merges) never move the camera.
 *
 * F3 (Wave 2) — unified selection + camera:
 *  - CONTROLLED selection via `selectedNodeId`/`selectedEdgeId`: the G6
 *    'selected' state is applied imperatively from the props, and the built-in
 *    'click-select' behavior is NOT registered for controlled canvases, so G6
 *    and React can never diverge.
 *  - `canvas:click` (empty background) → `onCanvasClick` so the page can clear
 *    selection + drawer with one gesture.
 *  - `focusNode(id, { select? })` handle: animated camera move to a node.
 *
 * F2 (Wave 2) — expand-in-place:
 *  - a PURE-ADDITION data update (expand-merge, overlay arrival) is applied via
 *    incremental `addData` instead of `setData`, so existing elements (and
 *    their states) are untouched; new nodes spawn near their first positioned
 *    neighbour and the camera never moves.
 *  - `pulseNodeId` emphasizes the node whose expansion is in flight.
 */

export type GraphLayoutName =
  | 'cose-bilkent'
  | 'dagre'
  | 'breadthfirst'
  | 'concentric'
  | 'circle'
  | 'radial';

/**
 * Imperative handle exposed via the `ref` prop (React 19 ref-as-prop, no
 * forwardRef needed). P1.7: the page's "Adatta alla vista" button calls `fit()`.
 */
export interface GraphCanvasHandle {
  /** Fit the whole graph into the viewport (chained on the in-flight render). */
  fit: () => void;
  /**
   * F3: animate the camera to a node already on canvas (400ms focusElement).
   * `select: true` additionally converges the G6 'selected' state right away —
   * the controlled `selectedNodeId` prop should be updated in the same render
   * so React remains the source of truth.
   */
  focusNode: (id: string, opts?: { select?: boolean }) => void;
}

export interface GraphCanvasProps {
  ref?: React.Ref<GraphCanvasHandle>;
  nodes: NodeData[];
  edges: EdgeData[];
  layout?: GraphLayoutName;
  height?: number | string;
  /**
   * `'radial'` layout only: the node the rings are centered on (G6's
   * `focusNode` radial option). Ignored by every other layout. Omit to fall
   * back to the layout's own default (the first node in the data).
   */
  layoutFocusNodeId?: string;
  /**
   * Id of the node the view is centered on (F1 fit discipline). When it CHANGES
   * across a data update, the camera animates to it (if it survived from the
   * previous data) or falls back to a fit; when it is UNCHANGED the camera never
   * moves on data updates. Omit for auxiliary views (side rail, local slices) —
   * they fall back to fit-on-disjoint-replacement.
   */
  centerNodeId?: string | null;
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
  /**
   * F3 CONTROLLED node selection: the id holding the G6 'selected' state
   * (`null` = nothing selected). Providing this prop (even as null) takes over
   * selection entirely — the built-in 'click-select' behavior is not
   * registered. Omit (`undefined`) for uncontrolled views (side rail, local
   * slice), which keep the G6 default.
   */
  selectedNodeId?: string | null;
  /** F3: id of the selected edge (real relation OR synthetic contrast arc). */
  selectedEdgeId?: string | null;
  /**
   * F2: node whose expansion fetch is in flight — emphasized ('active' state)
   * without fading the rest, as a lightweight loading pulse.
   */
  pulseNodeId?: string | null;
  /**
   * Walk-mode sequencer ("Segui il ragionamento sul grafo"): edges to emphasize
   * ('active' state), e.g. the current step's edge. Mirrors `highlightNodeIds`
   * but for edges — does not fade unrelated elements on its own (combine with
   * `highlightNodeIds` for the endpoint emphasis). `null`/empty clears it.
   */
  highlightEdgeIds?: ReadonlySet<string> | null;
  /** F3: click on the EMPTY canvas background (never fired for nodes/edges). */
  onCanvasClick?: () => void;
  onNodeClick?: (nodeId: string) => void;
  onNodeDblClick?: (nodeId: string) => void;
  /**
   * Slice 4 P2a: a click on an edge (real relation OR synthetic contrast arc)
   * — the page resolves the id to a GraphEdgeSelection and opens the Nodo tab.
   */
  onEdgeClick?: (edgeId: string) => void;
}

function layoutConfig(
  name: GraphLayoutName,
  opts?: { quickSettle?: boolean; focusNodeId?: string }
): LayoutOptions {
  switch (name) {
    case 'dagre':
      return { type: 'antv-dagre', rankdir: 'TB', nodesep: 28, ranksep: 60 };
    case 'breadthfirst':
      return { type: 'antv-dagre', rankdir: 'LR', nodesep: 22, ranksep: 65 };
    case 'concentric':
      return { type: 'concentric', nodeSize: 34 };
    case 'circle':
      return { type: 'circular' };
    case 'radial':
      // G6 v5 / @antv/layout 2.x radial: rings by graph distance from
      // `focusNode`, i.e. the walk's seed — exactly "rings by reasoning round"
      // for this walk shape (distance from seed == round). `unitRadius` /
      // `linkDistance` widened well past the defaults (50) so a dense fan of
      // leaf concepts spreads instead of collapsing into an unreadable strip;
      // `preventOverlap` needs a `nodeSize` (walk nodes range ~20-54px, see
      // graphStyles.walkNodeSize — 50 is a representative collision radius).
      return {
        type: 'radial',
        focusNode: opts?.focusNodeId ?? null,
        unitRadius: 160,
        linkDistance: 160,
        preventOverlap: true,
        nodeSize: 62,
        nodeSpacing: 30,
      };
    case 'cose-bilkent':
    default:
      return {
        type: 'd3-force',
        link: { distance: 130, strength: 0.4 },
        collide: { radius: 44, strength: 0.9 },
        manyBody: { strength: -320 },
        center: {},
        // F1: when positions carry over, start the simulation cooler and decay
        // faster so surviving nodes barely drift (short settle, mental map kept).
        ...(opts?.quickSettle ? { alpha: 0.3, alphaDecay: 0.08 } : { alphaDecay: 0.028 }),
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
  // F3: controlled edge selection (mirrors NODE_STATE.selected).
  selected: { stroke: '#0f172a', strokeOpacity: 1, lineWidth: 3, labelOpacity: 1 },
};

function dataSignature(nodes: NodeData[], edges: EdgeData[]): string {
  return `${nodes.map((n) => n.id).join(',')}|${edges.map((e) => e.id).join(',')}`;
}

/** Id sets of the current data — the additive-update detector's memory (F2). */
function idSets(nodes: NodeData[], edges: EdgeData[]): { nodes: Set<string>; edges: Set<string> } {
  return {
    nodes: new Set(nodes.filter((n) => n.id != null).map((n) => String(n.id))),
    edges: new Set(edges.filter((e) => e.id != null).map((e) => String(e.id))),
  };
}

function isSuperset(sup: ReadonlySet<string>, sub: ReadonlySet<string>): boolean {
  if (sup.size < sub.size) return false;
  for (const v of sub) if (!sup.has(v)) return false;
  return true;
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
    // P1.9: synthetic deliberation elements (canon stars, contrast arcs, anchor
    // tethers) are commentary ON the debate — never faded by the sources/legend
    // emphasis. They keep their base style.
    if (!active || isDeliberationElementId(id)) {
      map[id] = [];
      continue;
    }
    const isActive = byIds ? ids!.has(id) : n.data?.type === type;
    map[id] = isActive ? ['active'] : ['inactive'];
  }
  for (const e of edges) {
    if (e.id == null) continue;
    const id = String(e.id);
    map[id] = active && !isDeliberationElementId(id) ? ['inactive'] : [];
  }
  return map;
}

interface ElementStateInputs {
  highlightType?: string | null;
  highlightIds?: ReadonlySet<string> | null;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  pulseNodeId?: string | null;
  /** Walk-mode sequencer: edges to emphasize (see GraphTraversalPlayer). */
  highlightEdgeIds?: ReadonlySet<string> | null;
}

/**
 * F3/F2: the FULL element-state map sent to G6 in one call — the legend/sources
 * fade (buildHighlightState) with the controlled selection and the expand pulse
 * promoted on top. A selected/pulsing element is never left 'inactive', and ids
 * absent from the current data are skipped (a vanished node cannot hold state).
 * Single writer: selection can't be clobbered by a later highlight pass.
 */
function buildElementStates(
  nodes: NodeData[],
  edges: EdgeData[],
  inputs: ElementStateInputs
): Record<string, string[]> {
  const map = buildHighlightState(nodes, edges, inputs.highlightType, inputs.highlightIds);
  const promote = (id: string | null | undefined, state: string): void => {
    if (!id || !(id in map)) return;
    const states = map[id].filter((s) => s !== 'inactive');
    if (!states.includes(state)) states.push(state);
    map[id] = states;
  };
  promote(inputs.selectedNodeId, 'selected');
  promote(inputs.selectedEdgeId, 'selected');
  promote(inputs.pulseNodeId, 'active');
  if (inputs.highlightEdgeIds) {
    for (const id of inputs.highlightEdgeIds) promote(id, 'active');
  }
  // Audit item 1: reveal the relation labels of every edge touching the
  // selected node — scoped to just that node's edges, the rest stay quiet.
  for (const id of incidentEdgeIds(edges, inputs.selectedNodeId)) promote(id, 'active');
  return map;
}

interface Point {
  x: number;
  y: number;
}

/** Read the CURRENT laid-out positions off the live graph (G6 v5 writes layout results back into the node data). */
function readNodePositions(g: Graph): Map<string, Point> {
  const map = new Map<string, Point>();
  let data: NodeData[] = [];
  try {
    data = g.getNodeData();
  } catch {
    return map; // destroyed / not yet rendered — nothing to carry over
  }
  for (const n of data) {
    if (n.id == null) continue;
    const x = n.style?.x;
    const y = n.style?.y;
    if (typeof x === 'number' && typeof y === 'number') map.set(String(n.id), { x, y });
  }
  return map;
}

// Golden-angle spread: deterministic, collision-avoiding offsets for spawns.
const GOLDEN_ANGLE = 2.399963229728653;
const SPAWN_RADIUS = 60;

function spawnOffset(index: number, origin: Point): Point {
  const angle = index * GOLDEN_ANGLE;
  return {
    x: origin.x + Math.cos(angle) * SPAWN_RADIUS,
    y: origin.y + Math.sin(angle) * SPAWN_RADIUS,
  };
}

/**
 * F1 position carry-over: inject the previous x/y into surviving nodes and
 * compute spawn positions for new ones (near their first positioned neighbour,
 * else at the survivors' centroid). Returns the nodes untouched when nothing
 * survives — a disjoint graph lays out from scratch.
 */
function carryOverPositions(
  nodes: NodeData[],
  edges: EdgeData[],
  prev: Map<string, Point>
): { nodes: NodeData[]; survivors: number } {
  const placed = new Map<string, Point>();
  for (const n of nodes) {
    if (n.id == null) continue;
    const p = prev.get(String(n.id));
    if (p) placed.set(String(n.id), p);
  }
  const survivors = placed.size;
  if (survivors === 0) return { nodes, survivors };

  // Centroid of the survivors — fallback origin for isolated new nodes.
  let cx = 0;
  let cy = 0;
  for (const p of placed.values()) {
    cx += p.x;
    cy += p.y;
  }
  const centroid: Point = { x: cx / survivors, y: cy / survivors };

  // Undirected adjacency over the NEW edge set.
  const neighbors = new Map<string, string[]>();
  const link = (a: string, b: string): void => {
    const list = neighbors.get(a);
    if (list) list.push(b);
    else neighbors.set(a, [b]);
  };
  for (const e of edges) {
    if (e.source == null || e.target == null) continue;
    link(String(e.source), String(e.target));
    link(String(e.target), String(e.source));
  }

  // Two passes so chains of new nodes can hang off freshly spawned neighbours.
  for (let pass = 0; pass < 2; pass += 1) {
    nodes.forEach((n, i) => {
      if (n.id == null) return;
      const id = String(n.id);
      if (placed.has(id)) return;
      const anchor = (neighbors.get(id) ?? []).find((other) => placed.has(other));
      if (!anchor) return;
      placed.set(id, spawnOffset(i, placed.get(anchor)!));
    });
  }

  return {
    nodes: nodes.map((n, i) => {
      if (n.id == null) return n;
      const pos = placed.get(String(n.id)) ?? spawnOffset(i, centroid);
      return { ...n, style: { ...n.style, x: pos.x, y: pos.y } };
    }),
    survivors,
  };
}

/**
 * Audit item 5 — pin the canon corona (the deliberation overlay's `canon:*`
 * nodes) to a deterministic ring around the center, right after the force
 * layout has settled. `g.render()` only resolves once the d3-force simulation
 * hits its 'end' event (@antv/layout's D3ForceLayout resolves `layout()` from
 * `simulation.on('end', ...)`), so nothing will drift these positions again
 * until the NEXT data change re-runs the layout — a one-shot post-layout pass
 * is enough, no per-node "pin" API is needed (G6 v5 exposes no public per-node
 * fixed-position hook on `Graph`; the internal d3-force `setFixedPosition` is
 * reached only through the layout's private context, not worth the coupling).
 * `translateElementTo` is a pure canvas-position move (`updateNodeData` under
 * the hood) — it does not re-trigger layout, so it cannot re-scatter siblings.
 * No-op when there is no center to anchor the ring on (canons keep floating,
 * same as before this change) or when the data carries no canon nodes.
 */
function repositionCanonNodes(g: Graph, nodes: NodeData[], centerId: string | null): void {
  const canonNodes = nodes.filter(
    (n) => n.id != null && (n.data as { kind?: string } | undefined)?.kind === 'canon'
  );
  if (canonNodes.length === 0 || !centerId) return;
  let centerPos: Point | undefined;
  try {
    centerPos = g.getElementPosition(centerId);
  } catch {
    return; // center not (yet) on canvas — leave the force layout in charge
  }
  if (!centerPos) return;
  const [cx, cy] = centerPos;
  const positions: Record<string, Point> = {};
  canonNodes.forEach((n, i) => {
    const canonKey = (n.data as { canon?: string } | undefined)?.canon ?? String(n.id);
    const pos = canonRingPosition(canonKey, { x: cx, y: cy }, i);
    positions[String(n.id)] = [pos.x, pos.y];
  });
  void g.translateElementTo(positions, false).catch(() => {});
}

export default function GraphCanvas({
  ref,
  nodes,
  edges,
  layout = 'cose-bilkent',
  height = 300,
  layoutFocusNodeId,
  centerNodeId,
  hiddenNodeTypes,
  hiddenEdgeTypes,
  highlightNodeType,
  highlightNodeIds,
  selectedNodeId,
  selectedEdgeId,
  pulseNodeId,
  highlightEdgeIds,
  onCanvasClick,
  onNodeClick,
  onNodeDblClick,
  onEdgeClick,
}: GraphCanvasProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const dataSigRef = useRef<string>('');
  // F2: id sets of the CURRENT data — detects pure-addition updates (addData).
  const prevIdsRef = useRef<{ nodes: Set<string>; edges: Set<string> } | null>(null);
  // F1 fit discipline: the center the camera last committed to.
  const centerRef = useRef<string | null>(null);
  // F3: captured at MOUNT — a canvas that provides selectedNodeId/selectedEdgeId
  // (even null) is CONTROLLED and must not register G6's own 'click-select'.
  const controlledSelectionRef = useRef(selectedNodeId !== undefined || selectedEdgeId !== undefined);
  // Latest render() promise — all imperative ops (visibility/state) chain on it
  // so they never run before the in-flight render resolves (G6 requirement).
  const renderRef = useRef<Promise<unknown>>(Promise.resolve());

  // Keep handlers in refs so the once-attached listeners never go stale.
  const clickRef = useRef(onNodeClick);
  const dblRef = useRef(onNodeDblClick);
  const edgeClickRef = useRef(onEdgeClick);
  const canvasClickRef = useRef(onCanvasClick);
  useEffect(() => {
    clickRef.current = onNodeClick;
    dblRef.current = onNodeDblClick;
    edgeClickRef.current = onEdgeClick;
    canvasClickRef.current = onCanvasClick;
  }, [onNodeClick, onNodeDblClick, onEdgeClick, onCanvasClick]);

  // Create the graph once. Data/filter/layout changes are applied by the
  // sibling effects below (G6 is an external system synced imperatively).
  // F1: NO `autoFit` option — G6 would re-fit on EVERY render(), destroying the
  // user's zoom/pan on each data update. Fit runs explicitly: once after the
  // first render, on center change (fallback), and via the `fit()` handle.
  useEffect(() => {
    if (!containerRef.current) return;
    const graph = new Graph({
      container: containerRef.current,
      autoResize: true,
      padding: 24,
      // P1.7: clamp wheel-zoom so the graph can neither vanish into a dot nor
      // blow past legibility (G6 default is [0.01, 10]).
      zoomRange: [0.15, 4],
      data: { nodes, edges },
      node: { style: nodeStyleMapper, state: NODE_STATE },
      edge: { type: 'quadratic', style: edgeStyleMapper, state: EDGE_STATE },
      layout: layoutConfig(layout, { focusNodeId: layoutFocusNodeId }),
      behaviors: [
        'zoom-canvas',
        'drag-canvas',
        'drag-element',
        // F3: on a CONTROLLED canvas React owns the 'selected' state exclusively
        // — registering click-select too would let G6 and React diverge.
        ...(controlledSelectionRef.current ? [] : ['click-select']),
        // Hover emphasizes the node + its 1-degree neighbourhood (and reveals
        // their relation labels). It does NOT fade the rest — an aggressive
        // `inactiveState` left elements stuck transparent after a click. The
        // dim-others focus is reserved for the explicit legend hover.
        { type: 'hover-activate', degree: 1, state: 'active' },
      ],
    });
    graphRef.current = graph;
    dataSigRef.current = dataSignature(nodes, edges);
    prevIdsRef.current = idSets(nodes, edges);
    centerRef.current = centerNodeId ?? null;

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
    // F3: G6 fires canvas:click only for the EMPTY background (nodes/edges get
    // their own namespaced events) — the "click outside to deselect" gesture.
    graph.on('canvas:click', () => {
      canvasClickRef.current?.();
    });

    // render() rejects with "The graph instance has been destroyed" if the
    // component unmounts (or StrictMode double-mounts) before it settles.
    // Swallow that rejection so it never surfaces as an unhandled error.
    // First render of this canvas instance → the only automatic full fit.
    renderRef.current = graph.render().then(() => {
      if (graphRef.current === graph) return graph.fitView();
    });
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
    const nextCenter = centerNodeId ?? null;
    if (sig !== dataSigRef.current) {
      dataSigRef.current = sig;

      // F1.3: carry the current positions into the new data so the layout
      // resumes from the picture on screen instead of re-scrambling it.
      const prevPositions = readNodePositions(g);
      const { nodes: positionedNodes, survivors } = carryOverPositions(nodes, edges, prevPositions);

      // F2: PURE-ADDITION update (expand-merge, overlay arrival) → incremental
      // addData: every pre-existing element (and its G6 states) is untouched;
      // only the new nodes/edges enter, pre-positioned near their neighbours.
      const prevIds = prevIdsRef.current;
      const nextIds = idSets(nodes, edges);
      const additive =
        prevIds !== null &&
        prevIds.nodes.size > 0 &&
        survivors > 0 &&
        edges.every((e) => e.id != null) &&
        (nextIds.nodes.size > prevIds.nodes.size || nextIds.edges.size > prevIds.edges.size) &&
        isSuperset(nextIds.nodes, prevIds.nodes) &&
        isSuperset(nextIds.edges, prevIds.edges);
      prevIdsRef.current = nextIds;

      // Quick-settle the force layout when positions carried over (no-op for
      // the deterministic layouts, which ignore initial positions anyway).
      g.setLayout(layoutConfig(layout, { quickSettle: survivors > 0, focusNodeId: layoutFocusNodeId }));
      if (additive && prevIds) {
        g.addData({
          nodes: positionedNodes.filter((n) => n.id != null && !prevIds.nodes.has(String(n.id))),
          edges: edges.filter((e) => e.id != null && !prevIds.edges.has(String(e.id))),
        });
      } else {
        g.setData({ nodes: positionedNodes, edges });
      }

      // F1.4 fit discipline (autoFit is off — the camera only moves here):
      //  - center changed & survived → animate the camera to it (no hard fit);
      //  - center changed & brand new / disjoint replacement → full fit;
      //  - same center (overlay arrival, revalidation, expand-merge) → nothing.
      const prevCenter = centerRef.current;
      centerRef.current = nextCenter;
      const centerChanged = nextCenter !== prevCenter;

      renderRef.current = g.render().then(() => {
        if (graphRef.current !== g) return undefined;
        // Audit item 5: pin any canon corona to its deterministic ring — must run
        // AFTER render() so the force layout has fully settled (see the function
        // doc for why this is the correct, non-racy place for the pass).
        repositionCanonNodes(g, positionedNodes, nextCenter);
        if (centerChanged) {
          if (nextCenter && prevPositions.has(nextCenter)) {
            return g.focusElement(nextCenter, { duration: 400 });
          }
          return g.fitView();
        }
        if (survivors === 0) return g.fitView();
        return undefined;
      });
      renderRef.current.catch(() => {});
    } else {
      // No data change — keep the committed center in sync so the NEXT data
      // update doesn't misread a long-settled center switch as "changed".
      centerRef.current = nextCenter;
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
  }, [nodes, edges, hiddenNodeTypes, hiddenEdgeTypes, centerNodeId, layout, layoutFocusNodeId]);

  // Legend hover (type) OR deliberation sources (id-set) → emphasize the match,
  // fade the rest (no relayout). The id-set wins when both are set. F3/F2: the
  // controlled selection and the expand pulse are folded into the SAME state
  // map (single writer) so they can never clobber one another.
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    void renderRef.current
      .then(() => {
        if (graphRef.current === g) {
          g.setElementState(
            buildElementStates(nodes, edges, {
              highlightType: highlightNodeType,
              highlightIds: highlightNodeIds,
              selectedNodeId,
              selectedEdgeId,
              pulseNodeId,
              highlightEdgeIds,
            })
          );
        }
      })
      .catch(() => {});
  }, [highlightNodeType, highlightNodeIds, selectedNodeId, selectedEdgeId, pulseNodeId, highlightEdgeIds, nodes, edges]);

  // Re-run layout when the layout NAME or its focus node changes (no data
  // refetch). Skipped on mount — the constructor already laid out with this
  // config, and an extra layout() pass would discard the initial fit for nothing.
  const layoutMountedRef = useRef(false);
  useEffect(() => {
    if (!layoutMountedRef.current) {
      layoutMountedRef.current = true;
      return;
    }
    const g = graphRef.current;
    if (!g) return;
    g.setLayout(layoutConfig(layout, { focusNodeId: layoutFocusNodeId }));
    // layout() also rejects if the instance is destroyed mid-flight.
    void g.layout().catch(() => {});
  }, [layout, layoutFocusNodeId]);

  // P1.7 "Adatta alla vista": fit chained on the latest render so it never runs
  // against a graph that hasn't laid out yet; guarded against a destroyed instance.
  useImperativeHandle(
    ref,
    () => ({
      fit: (): void => {
        const g = graphRef.current;
        if (!g) return;
        void renderRef.current
          .then(() => {
            if (graphRef.current === g) return g.fitView();
          })
          .catch(() => {});
      },
      // F3: animated camera move to an on-canvas node (chips "Centra il grafo
      // su X" for nodes already in the subgraph — selection instead of a nav).
      focusNode: (id: string, opts?: { select?: boolean }): void => {
        const g = graphRef.current;
        if (!g) return;
        void renderRef.current
          .then(() => {
            if (graphRef.current !== g) return;
            // Immediate convergence; the controlled selection effect re-applies
            // the full state map on the same commit (page updates the prop too).
            if (opts?.select) g.setElementState({ [id]: ['selected'] });
            return g.focusElement(id, { duration: 400 });
          })
          .catch(() => {});
      },
    }),
    [],
  );

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
