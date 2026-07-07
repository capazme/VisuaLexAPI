import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRef } from 'react';
import { render as renderComponent, waitFor, act } from '@testing-library/react';
import type { NodeData, EdgeData } from '@antv/g6';
import GraphCanvas, { type GraphCanvasHandle } from '../GraphCanvas';

/**
 * F1 (Wave 2) — persistent canvas: position carry-over + fit discipline.
 * @antv/g6 is fully mocked; assertions run on the mock Graph's call counts.
 */

// Registry shared with the hoisted mock factory (vi.mock is hoisted above imports).
const g6 = vi.hoisted(() => ({ instances: [] as unknown[] }));

interface MockNode {
  id?: unknown;
  style?: { x?: number; y?: number } & Record<string, unknown>;
}

vi.mock('@antv/g6', () => {
  class Graph {
    options: Record<string, unknown>;
    nodes: MockNode[];
    render = vi.fn(() => Promise.resolve());
    setData = vi.fn((d: { nodes: MockNode[] }) => {
      this.nodes = d.nodes;
    });
    addData = vi.fn((d: { nodes?: MockNode[] }) => {
      this.nodes = [...this.nodes, ...(d.nodes ?? [])];
    });
    getNodeData = vi.fn(() => this.nodes);
    fitView = vi.fn(() => Promise.resolve());
    focusElement = vi.fn(() => Promise.resolve());
    setLayout = vi.fn();
    layout = vi.fn(() => Promise.resolve());
    setElementVisibility = vi.fn();
    setElementState = vi.fn();
    on = vi.fn();
    destroy = vi.fn();
    constructor(options: { data?: { nodes?: MockNode[] } } & Record<string, unknown>) {
      this.options = options;
      this.nodes = options.data?.nodes ?? [];
      g6.instances.push(this);
    }
  }
  return { Graph };
});

interface MockGraph {
  options: Record<string, unknown>;
  nodes: MockNode[];
  render: ReturnType<typeof vi.fn>;
  setData: ReturnType<typeof vi.fn>;
  addData: ReturnType<typeof vi.fn>;
  getNodeData: ReturnType<typeof vi.fn>;
  fitView: ReturnType<typeof vi.fn>;
  focusElement: ReturnType<typeof vi.fn>;
  setLayout: ReturnType<typeof vi.fn>;
  layout: ReturnType<typeof vi.fn>;
  setElementVisibility: ReturnType<typeof vi.fn>;
  setElementState: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

/** Retrieve the handler registered for a G6 event name on the mock graph. */
function eventHandler(g: MockGraph, event: string): ((e?: unknown) => void) | undefined {
  const call = g.on.mock.calls.find((c: unknown[]) => c[0] === event);
  return call?.[1] as ((e?: unknown) => void) | undefined;
}

/** Last full element-state map sent to setElementState. */
function lastStateMap(g: MockGraph): Record<string, string[]> {
  return g.setElementState.mock.calls.at(-1)?.[0] as Record<string, string[]>;
}

function lastGraph(): MockGraph {
  return g6.instances[g6.instances.length - 1] as MockGraph;
}

/** Flush the component's chained render/fit promises. */
const flush = (): Promise<void> => act(async () => {});

const nd = (id: string, type = 'Norma'): NodeData => ({ id, data: { label: id, type } });
const ed = (id: string, source: string, target: string): EdgeData => ({
  id,
  source,
  target,
  data: { label: 'REL', type: 'REL' },
});

/** Simulate the layout having written x/y back into the live node data. */
function layOut(g: MockGraph, at: (index: number) => { x: number; y: number }): void {
  g.nodes = g.nodes.map((n, i) => ({ ...n, style: { ...n.style, ...at(i) } }));
}

beforeEach(() => {
  g6.instances.length = 0;
});

describe('GraphCanvas (F1 — persistent canvas)', () => {
  it('creates the graph WITHOUT autoFit and fits exactly once after the first render', async () => {
    renderComponent(<GraphCanvas nodes={[nd('a')]} edges={[]} centerNodeId="a" />);
    const g = lastGraph();
    expect(g.options.autoFit).toBeUndefined();
    await waitFor(() => expect(g.fitView).toHaveBeenCalledTimes(1));
    await flush();
    expect(g.fitView).toHaveBeenCalledTimes(1);
  });

  it('applies a PURE ADDITION via addData with the new node spawned near its neighbour (F2)', async () => {
    const { rerender } = renderComponent(
      <GraphCanvas nodes={[nd('a'), nd('b')]} edges={[ed('e1', 'a', 'b')]} centerNodeId="a" />
    );
    const g = lastGraph();
    await waitFor(() => expect(g.fitView).toHaveBeenCalledTimes(1));
    layOut(g, (i) => ({ x: 100 + i * 50, y: 200 }));

    // Same center, one new node `c` connected to the surviving `a` (superset).
    rerender(
      <GraphCanvas
        nodes={[nd('a'), nd('b'), nd('c')]}
        edges={[ed('e1', 'a', 'b'), ed('e2', 'c', 'a')]}
        centerNodeId="a"
      />
    );
    await flush();

    // Incremental path: ONLY the delta enters; setData never called again.
    expect(g.setData).not.toHaveBeenCalled();
    expect(g.addData).toHaveBeenCalledTimes(1);
    const arg = g.addData.mock.calls[0][0] as { nodes: MockNode[]; edges: unknown[] };
    expect(arg.nodes.map((n) => String(n.id))).toEqual(['c']);
    expect((arg.edges as Array<{ id: string }>).map((e) => e.id)).toEqual(['e2']);
    // The new node spawns within the spawn radius of its neighbour `a`.
    const c = arg.nodes[0];
    const dist = Math.hypot((c.style?.x ?? 0) - 100, (c.style?.y ?? 0) - 200);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThanOrEqual(60.5);
    // Quick-settle force config when positions carried over.
    expect(g.setLayout).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'd3-force', alpha: 0.3, alphaDecay: 0.08 })
    );
    // No camera move on a same-center addition.
    expect(g.fitView).toHaveBeenCalledTimes(1);
    expect(g.focusElement).not.toHaveBeenCalled();
  });

  it('carries surviving positions into setData when the update also REMOVES nodes', async () => {
    const { rerender } = renderComponent(
      <GraphCanvas nodes={[nd('a'), nd('b')]} edges={[ed('e1', 'a', 'b')]} centerNodeId="a" />
    );
    const g = lastGraph();
    await waitFor(() => expect(g.fitView).toHaveBeenCalledTimes(1));
    layOut(g, (i) => ({ x: 100 + i * 50, y: 200 }));

    // `b` removed, new node `c` linked to the surviving `a` → NOT additive.
    rerender(
      <GraphCanvas nodes={[nd('a'), nd('c')]} edges={[ed('e2', 'c', 'a')]} centerNodeId="a" />
    );
    await flush();

    expect(g.addData).not.toHaveBeenCalled();
    expect(g.setData).toHaveBeenCalledTimes(1);
    const arg = g.setData.mock.calls[0][0] as { nodes: MockNode[] };
    const byId = new Map(arg.nodes.map((n) => [String(n.id), n]));
    // Survivor keeps its laid-out coordinates…
    expect(byId.get('a')?.style?.x).toBe(100);
    expect(byId.get('a')?.style?.y).toBe(200);
    // …and the new node spawns within the spawn radius of its neighbour `a`.
    const c = byId.get('c');
    const dist = Math.hypot((c?.style?.x ?? 0) - 100, (c?.style?.y ?? 0) - 200);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThanOrEqual(60.5);
  });

  it('does NOT auto-fit on a same-center data update (overlay arrival / revalidation)', async () => {
    const { rerender } = renderComponent(
      <GraphCanvas nodes={[nd('a'), nd('b')]} edges={[ed('e1', 'a', 'b')]} centerNodeId="a" />
    );
    const g = lastGraph();
    await waitFor(() => expect(g.fitView).toHaveBeenCalledTimes(1));
    layOut(g, (i) => ({ x: i * 10, y: 0 }));

    rerender(
      <GraphCanvas
        nodes={[nd('a'), nd('b'), nd('canon:literal')]}
        edges={[ed('e1', 'a', 'b'), ed('canon:anchor:literal', 'a', 'canon:literal')]}
        centerNodeId="a"
      />
    );
    await flush();

    // Overlay arrival is a pure addition → incremental addData, no camera move.
    expect(g.addData).toHaveBeenCalledTimes(1);
    expect(g.setData).not.toHaveBeenCalled();
    // Still only the first-render fit; the camera never moved.
    expect(g.fitView).toHaveBeenCalledTimes(1);
    expect(g.focusElement).not.toHaveBeenCalled();
  });

  it('animates the camera (focusElement) when the center changes to a node that survived', async () => {
    const { rerender } = renderComponent(
      <GraphCanvas nodes={[nd('a'), nd('b')]} edges={[ed('e1', 'a', 'b')]} centerNodeId="a" />
    );
    const g = lastGraph();
    await waitFor(() => expect(g.fitView).toHaveBeenCalledTimes(1));
    layOut(g, (i) => ({ x: i * 10, y: 0 }));

    // Recenter on `b` (double-click nav): b survives into the new subgraph.
    rerender(
      <GraphCanvas nodes={[nd('b'), nd('d')]} edges={[ed('e2', 'b', 'd')]} centerNodeId="b" />
    );
    await waitFor(() => expect(g.focusElement).toHaveBeenCalledWith('b', expect.anything()));
    // Camera animation, NOT a hard fit.
    expect(g.fitView).toHaveBeenCalledTimes(1);
  });

  it('falls back to a full fit when the new center was NOT in the old graph', async () => {
    const { rerender } = renderComponent(
      <GraphCanvas nodes={[nd('a'), nd('b')]} edges={[ed('e1', 'a', 'b')]} centerNodeId="a" />
    );
    const g = lastGraph();
    await waitFor(() => expect(g.fitView).toHaveBeenCalledTimes(1));
    layOut(g, (i) => ({ x: i * 10, y: 0 }));

    rerender(
      <GraphCanvas nodes={[nd('z'), nd('w')]} edges={[ed('e9', 'z', 'w')]} centerNodeId="z" />
    );
    await waitFor(() => expect(g.fitView).toHaveBeenCalledTimes(2));
    expect(g.focusElement).not.toHaveBeenCalled();
  });

  it('fits on a disjoint replacement when no center info is provided (side rail)', async () => {
    const { rerender } = renderComponent(<GraphCanvas nodes={[nd('a')]} edges={[]} />);
    const g = lastGraph();
    await waitFor(() => expect(g.fitView).toHaveBeenCalledTimes(1));

    rerender(<GraphCanvas nodes={[nd('x')]} edges={[]} />);
    await waitFor(() => expect(g.fitView).toHaveBeenCalledTimes(2));
  });

  it('the fit() handle fits on demand (explicit user action)', async () => {
    const ref = createRef<GraphCanvasHandle>();
    renderComponent(<GraphCanvas ref={ref} nodes={[nd('a')]} edges={[]} />);
    const g = lastGraph();
    await waitFor(() => expect(g.fitView).toHaveBeenCalledTimes(1));

    act(() => {
      ref.current?.fit();
    });
    await waitFor(() => expect(g.fitView).toHaveBeenCalledTimes(2));
  });
});

describe('GraphCanvas (F3 — unified selection + camera)', () => {
  it('omits the built-in click-select behavior when selection is CONTROLLED', () => {
    renderComponent(<GraphCanvas nodes={[nd('a')]} edges={[]} selectedNodeId={null} />);
    const behaviors = lastGraph().options.behaviors as unknown[];
    expect(behaviors).not.toContain('click-select');
  });

  it('keeps click-select for UNCONTROLLED canvases (side rail)', () => {
    renderComponent(<GraphCanvas nodes={[nd('a')]} edges={[]} />);
    const behaviors = lastGraph().options.behaviors as unknown[];
    expect(behaviors).toContain('click-select');
  });

  it('applies the controlled selectedNodeId as the G6 selected state', async () => {
    renderComponent(
      <GraphCanvas nodes={[nd('a'), nd('b')]} edges={[]} selectedNodeId="a" selectedEdgeId={null} />
    );
    const g = lastGraph();
    await flush();
    const map = lastStateMap(g);
    expect(map['a']).toContain('selected');
    expect(map['b']).not.toContain('selected');
  });

  it('moves the selected state when the prop changes (old id cleared)', async () => {
    const { rerender } = renderComponent(
      <GraphCanvas nodes={[nd('a'), nd('b')]} edges={[]} selectedNodeId="a" />
    );
    const g = lastGraph();
    await flush();

    rerender(<GraphCanvas nodes={[nd('a'), nd('b')]} edges={[]} selectedNodeId="b" />);
    await flush();
    const map = lastStateMap(g);
    expect(map['a']).toEqual([]);
    expect(map['b']).toContain('selected');
  });

  it('a selected node is never left inactive under a sources/legend fade', async () => {
    renderComponent(
      <GraphCanvas
        nodes={[nd('a'), nd('b')]}
        edges={[]}
        highlightNodeIds={new Set(['b'])}
        selectedNodeId="a"
      />
    );
    const g = lastGraph();
    await flush();
    const map = lastStateMap(g);
    expect(map['a']).toContain('selected');
    expect(map['a']).not.toContain('inactive');
    expect(map['b']).toEqual(['active']);
  });

  it('applies the controlled selectedEdgeId as the G6 selected state', async () => {
    renderComponent(
      <GraphCanvas
        nodes={[nd('a'), nd('b')]}
        edges={[ed('e1', 'a', 'b')]}
        selectedNodeId={null}
        selectedEdgeId="e1"
      />
    );
    const g = lastGraph();
    await flush();
    expect(lastStateMap(g)['e1']).toContain('selected');
  });

  it('canvas:click (empty background) invokes onCanvasClick', async () => {
    const onCanvasClick = vi.fn();
    renderComponent(
      <GraphCanvas nodes={[nd('a')]} edges={[]} selectedNodeId={null} onCanvasClick={onCanvasClick} />
    );
    const g = lastGraph();
    await flush();
    const handler = eventHandler(g, 'canvas:click');
    expect(handler).toBeTruthy();
    act(() => handler!());
    expect(onCanvasClick).toHaveBeenCalledTimes(1);
  });

  it('focusNode animates the camera to the node; select:true converges the G6 state', async () => {
    const ref = createRef<GraphCanvasHandle>();
    renderComponent(<GraphCanvas ref={ref} nodes={[nd('a'), nd('b')]} edges={[]} selectedNodeId={null} />);
    const g = lastGraph();
    await flush();

    act(() => {
      ref.current?.focusNode('b', { select: true });
    });
    await waitFor(() => expect(g.focusElement).toHaveBeenCalledWith('b', { duration: 400 }));
    // The immediate imperative convergence (the controlled prop confirms later).
    expect(g.setElementState).toHaveBeenCalledWith({ b: ['selected'] });
  });
});

describe('GraphCanvas (F2 — expand pulse)', () => {
  it('pulses the expanding node with the active state without fading the rest', async () => {
    renderComponent(
      <GraphCanvas nodes={[nd('a'), nd('b')]} edges={[]} selectedNodeId={null} pulseNodeId="a" />
    );
    const g = lastGraph();
    await flush();
    const map = lastStateMap(g);
    expect(map['a']).toContain('active');
    expect(map['b']).toEqual([]);
  });
});
