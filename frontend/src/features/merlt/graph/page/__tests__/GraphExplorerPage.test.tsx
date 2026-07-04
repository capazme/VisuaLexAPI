import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GraphExplorerPage } from '../GraphExplorerPage';
import type { ArticleGraphState } from '../../shared/useArticleGraph';
import type { MerltFeatures } from '../../../useMerltFeatures';
import type { QaTurnModel } from '../../../qa/types';

const useArticleGraphMock = vi.fn();
const isEnabledMock = vi.fn();

vi.mock('../../shared/useArticleGraph', () => ({
  useArticleGraph: (...a: unknown[]) => useArticleGraphMock(...a),
}));
// GraphCanvas is code-split; capture the props each render so tests can assert
// the effective hidden-types set + the sources-as-nodes highlight ids. The page's
// imperative fit handle (React 19 ref-as-prop) is stubbed with canvasFitMock.
let lastCanvasProps: Record<string, unknown> = {};
const canvasFitMock = vi.fn();
vi.mock('../../shared/GraphCanvas', () => ({
  default: (props: Record<string, unknown>) => {
    lastCanvasProps = props;
    const ref = props.ref as { current: unknown } | undefined;
    if (ref && typeof ref === 'object') ref.current = { fit: canvasFitMock };
    return <div data-testid="cytoscape" />;
  },
}));
vi.mock('../../featureFlag', () => ({
  isMerltGraphEnabled: () => isEnabledMock(),
}));

// Slice 4 P1: the page now derives ask/teach gating from useMerltFeatures and
// owns useQaThread. Both are mocked so the page renders without the consent/auth
// providers and without hitting the QA API — the wiring is asserted via spies.
const featuresMock = vi.fn<() => MerltFeatures>();
vi.mock('../../../useMerltFeatures', () => ({
  useMerltFeatures: () => featuresMock(),
}));

const qaAskMock = vi.fn();
const loadHistoryTurnMock = vi.fn();
const qaThreadState: { turns: QaTurnModel[] } = { turns: [] };
vi.mock('../../../qa/useQaThread', () => ({
  useQaThread: () => ({
    turns: qaThreadState.turns,
    ask: (...a: unknown[]) => {
      qaAskMock(...a);
      return Promise.resolve();
    },
    refine: vi.fn(),
    retry: vi.fn(),
    cancel: vi.fn(),
    rate: vi.fn(),
    rateSrc: vi.fn(),
    prefer: vi.fn(),
    detailed: vi.fn(),
    confirm: vi.fn(),
    clear: vi.fn(),
    loadHistoryTurn: (...a: unknown[]) => loadHistoryTurnMock(...a),
  }),
}));

// The deliberation column's "Cronologia" affordance mounts QaHistoryPanel, which
// hits GET /experts/history — mock the network so the page test is deterministic.
// Slice 4 L3: the page also imports sendRelationFeedback (the relation steer
// channel) from the same module — spied so the trace_id binding is assertable.
const fetchHistoryMock = vi.fn();
const sendRelationFeedbackMock = vi.fn();
vi.mock('../../../qa/qaApi', () => ({
  fetchHistory: (...a: unknown[]) => fetchHistoryMock(...a),
  sendRelationFeedback: (...a: unknown[]) => sendRelationFeedbackMock(...a),
}));

const triggerIngestionMock = vi.fn();
const useIngestionJobMock = vi.fn();
vi.mock('../../shared/graphApi', async (importOriginal) => {
  // Keep the real classifyIngestionTriggerError so the 403-vs-5xx mapping is
  // exercised end-to-end; only the network call is mocked.
  const actual = await importOriginal<typeof import('../../shared/graphApi')>();
  return {
    ...actual,
    triggerIngestion: (...a: unknown[]) => triggerIngestionMock(...a),
  };
});
vi.mock('../../shared/useIngestionJob', () => ({
  useIngestionJob: (...a: unknown[]) => useIngestionJobMock(...a),
}));

function features(overrides: Partial<MerltFeatures> = {}): MerltFeatures {
  return {
    merltEnabled: true,
    graphEnabled: true,
    consentLevel: 'full',
    status: 'ready',
    canTrack: true,
    qaAskable: true,
    canContribute: true,
    canValidate: true,
    graphReadable: true,
    opsVisible: false,
    ...overrides,
  };
}

function setGraph(state: ArticleGraphState): void {
  useArticleGraphMock.mockReturnValue({ ...state, refetch: vi.fn() });
}

function pageAt(path: string, state?: unknown) {
  return (
    <MemoryRouter initialEntries={[{ pathname: path.split('?')[0], search: path.includes('?') ? `?${path.split('?')[1]}` : '', state }]}>
      <GraphExplorerPage />
    </MemoryRouter>
  );
}

function renderAt(path: string, state?: unknown) {
  return render(pageAt(path, state));
}

beforeEach(() => {
  useArticleGraphMock.mockReset();
  isEnabledMock.mockReset();
  isEnabledMock.mockReturnValue(true);
  featuresMock.mockReset();
  featuresMock.mockReturnValue(features());
  qaAskMock.mockReset();
  loadHistoryTurnMock.mockReset();
  fetchHistoryMock.mockReset();
  fetchHistoryMock.mockResolvedValue([]);
  sendRelationFeedbackMock.mockReset();
  sendRelationFeedbackMock.mockResolvedValue(undefined);
  qaThreadState.turns = [];
  lastCanvasProps = {};
  canvasFitMock.mockReset();
  triggerIngestionMock.mockReset();
  triggerIngestionMock.mockResolvedValue({ jobId: 'job-1', status: 'pending' });
  useIngestionJobMock.mockReset();
  useIngestionJobMock.mockReturnValue({ status: null, error: null, nodesCreated: null });
  sessionStorage.clear(); // breadcrumb history is sessionStorage-backed
  setGraph({ status: 'idle' });
});

describe('GraphExplorerPage', () => {
  it('renders a not-available state when the feature flag is off', () => {
    isEnabledMock.mockReturnValue(false);
    renderAt('/grafo');
    expect(screen.getByText(/non disponibile/i)).toBeInTheDocument();
  });

  it('shows the empty-state tagline when there is no urn in the query', () => {
    renderAt('/grafo');
    expect(screen.getByText(/per iniziare/i)).toBeInTheDocument();
    expect(useArticleGraphMock).toHaveBeenCalledWith(null, expect.any(Number));
  });

  it('reads urn + depth from the query and fetches the graph', () => {
    setGraph({ status: 'loading' });
    renderAt('/grafo?urn=urn%3Atest&depth=3');
    expect(useArticleGraphMock).toHaveBeenCalledWith('urn:test', 3);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the depth selector with the URL depth active and refetches on change', () => {
    setGraph({
      status: 'success',
      data: { nodes: [{ id: 'a', type: 'Norma', label: 'A', urn: 'urn:test' }], edges: [] },
      elements: { nodes: [{ id: 'a' }], edges: [] },
    });
    renderAt('/grafo?urn=urn%3Atest&depth=1');

    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '3' }));
    // URL depth → 3 → useArticleGraph re-invoked with the new depth (refetch).
    expect(useArticleGraphMock).toHaveBeenCalledWith('urn:test', 3);
  });

  it('changing layout does not change the urn/depth passed to useArticleGraph (no refetch)', () => {
    setGraph({
      status: 'success',
      data: { nodes: [{ id: 'a', type: 'Norma', label: 'A', urn: 'urn:test' }], edges: [] },
      elements: { nodes: [{ id: 'a' }], edges: [] },
    });
    renderAt('/grafo?urn=urn%3Atest&depth=2');

    fireEvent.change(screen.getByRole('combobox', { name: /layout/i }), {
      target: { value: 'dagre' },
    });
    // Every call keeps depth=2 — layout never reaches the fetch hook.
    for (const call of useArticleGraphMock.mock.calls) {
      expect(call).toEqual(['urn:test', 2]);
    }
  });

  it('triggers ingestion and shows a building banner when the subgraph is empty', async () => {
    setGraph({ status: 'success', data: { nodes: [], edges: [] }, elements: { nodes: [], edges: [] } });
    renderAt('/grafo?urn=urn%3Anew&type=Norma');

    await waitFor(() => expect(triggerIngestionMock).toHaveBeenCalledWith('urn:new'));
    expect(screen.getByText(/indicizzazione in corso/i)).toBeInTheDocument();
  });

  it('shows "non indicizzabile" with retry when ingestion finished but graph is still empty', () => {
    useIngestionJobMock.mockReturnValue({ status: 'completed', error: null, nodesCreated: 0 });
    setGraph({ status: 'success', data: { nodes: [], edges: [] }, elements: { nodes: [], edges: [] } });
    renderAt('/grafo?urn=urn%3Anew&type=Norma');
    expect(screen.getByText(/non indicizzabile/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /riprova/i })).toBeInTheDocument();
  });

  it('seeds the breadcrumb on a direct deeplink (no prior interaction)', () => {
    setGraph({
      status: 'success',
      data: { nodes: [{ id: 'a', type: 'Norma', label: 'A', urn: 'urn:test' }], edges: [] },
      elements: { nodes: [{ id: 'a' }], edges: [] },
    });
    renderAt('/grafo?urn=urn%3Atest');
    // Breadcrumb nav present with the deeplinked urn as the (only) crumb.
    expect(screen.getByRole('navigation', { name: /cronologia grafo/i })).toBeInTheDocument();
  });

  it('clicking "Riprova" refetches but does NOT re-trigger ingestion', () => {
    const refetch = vi.fn();
    useArticleGraphMock.mockReturnValue({
      status: 'success',
      data: { nodes: [], edges: [] },
      elements: { nodes: [], edges: [] },
      refetch,
    });
    useIngestionJobMock.mockReturnValue({ status: 'completed', error: null, nodesCreated: 0 });
    renderAt('/grafo?urn=urn%3Anew&type=Norma');

    triggerIngestionMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /riprova/i }));
    expect(refetch).toHaveBeenCalled();
    expect(triggerIngestionMock).not.toHaveBeenCalled();
  });

  it('renders the graph canvas on success', async () => {
    setGraph({
      status: 'success',
      data: { nodes: [{ id: 'a', type: 'Norma', label: 'A' }], edges: [] },
      elements: { nodes: [{ id: 'a' }], edges: [] },
    });
    renderAt('/grafo?urn=urn:test');
    expect(await screen.findByTestId('cytoscape')).toBeInTheDocument();
  });

  describe('ingestion failure states (design §3.4)', () => {
    beforeEach(() => {
      setGraph({ status: 'success', data: { nodes: [], edges: [] }, elements: { nodes: [], edges: [] } });
    });

    it('shows the consent hint when the trigger is rejected with 403', async () => {
      triggerIngestionMock.mockRejectedValue({ status: 403, message: "consent_required" });
      renderAt('/grafo?urn=urn%3Anew&type=Norma');

      expect(await screen.findByText(/serve il consenso/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /riprova/i })).toBeInTheDocument();
      expect(screen.queryByText(/indicizzazione in corso/i)).not.toBeInTheDocument();
    });

    it('shows the unreachable message when the trigger fails with a 5xx', async () => {
      triggerIngestionMock.mockRejectedValue({ response: { status: 503 } });
      renderAt('/grafo?urn=urn%3Anew&type=Norma');

      expect(await screen.findByText(/non raggiungibile/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /riprova/i })).toBeInTheDocument();
    });

    it('shows the unreachable message when the polling budget is exhausted (job timeout)', async () => {
      // Job state follows the component's jobId: timeout while polling, idle after reset.
      useIngestionJobMock.mockImplementation((jobId: string | null) =>
        jobId
          ? { status: 'timeout', error: 'poll_budget_exhausted', nodesCreated: null }
          : { status: null, error: null, nodesCreated: null }
      );
      renderAt('/grafo?urn=urn%3Anew&type=Norma');

      expect(await screen.findByText(/non raggiungibile/i)).toBeInTheDocument();
      expect(screen.queryByText(/indicizzazione in corso/i)).not.toBeInTheDocument();
    });

    it('Riprova on timeout resets the machine (refetch + job cleared)', async () => {
      const refetch = vi.fn();
      useArticleGraphMock.mockReturnValue({
        status: 'success',
        data: { nodes: [], edges: [] },
        elements: { nodes: [], edges: [] },
        refetch,
      });
      useIngestionJobMock.mockImplementation((jobId: string | null) =>
        jobId
          ? { status: 'timeout', error: 'poll_budget_exhausted', nodesCreated: null }
          : { status: null, error: null, nodesCreated: null }
      );
      renderAt('/grafo?urn=urn%3Anew&type=Norma');
      expect(await screen.findByText(/non raggiungibile/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /riprova/i }));
      expect(refetch).toHaveBeenCalled();
      // jobId reset → the job hook is back to idle → no stale timeout banner.
      expect(screen.queryByText(/non raggiungibile/i)).not.toBeInTheDocument();
    });
  });

  describe('concept center (C2/C3 — no lazy ingestion)', () => {
    beforeEach(() => {
      setGraph({ status: 'success', data: { nodes: [], edges: [] }, elements: { nodes: [], edges: [] } });
    });

    it('does NOT trigger ingestion when the center is a concept', async () => {
      renderAt('/grafo?urn=concetto%3Acolpa&type=ConcettoGiuridico');
      // Give the debounce/effects a tick; ingestion must never fire for a concept.
      await waitFor(() =>
        expect(screen.getByText(/concetto non collegato/i)).toBeInTheDocument()
      );
      expect(triggerIngestionMock).not.toHaveBeenCalled();
    });

    it('shows the concept empty-state copy (no spinner, no "non indicizzabile")', () => {
      renderAt('/grafo?urn=concetto%3Acolpa&type=ConcettoGiuridico');
      expect(screen.getByText(/concetto non collegato/i)).toBeInTheDocument();
      expect(screen.queryByText(/indicizzazione in corso/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/non indicizzabile/i)).not.toBeInTheDocument();
    });

    it('classifies an article by the ~art urn marker even without a type param', async () => {
      // Deeplink with only the urn: the ~art marker must still route to the
      // article ingestion path (not the concept empty state).
      renderAt('/grafo?urn=' + encodeURIComponent('urn:nir:stato:codice.civile~art2043'));
      await waitFor(() =>
        expect(triggerIngestionMock).toHaveBeenCalledWith('urn:nir:stato:codice.civile~art2043')
      );
      expect(screen.queryByText(/concetto non collegato/i)).not.toBeInTheDocument();
    });
  });

  describe('Slice 4 P1 — il dibattito sul grafo', () => {
    // A populated subgraph with two nodes (one matches a deliberation source by
    // node_id, one by urn) so the sources-as-nodes join can be asserted.
    function setPopulatedGraph(): void {
      setGraph({
        status: 'success',
        data: {
          nodes: [
            { id: 'node-2043', type: 'Norma', label: 'Art. 2043', urn: 'urn:x~art2043' },
            { id: 'node-2059', type: 'Norma', label: 'Art. 2059', urn: 'urn:x~art2059' },
            { id: 'sent-1', type: 'AttoGiudiziario', label: 'Cass. 123/2020', urn: 'urn:sent1' },
          ],
          edges: [],
        },
        elements: {
          nodes: [{ id: 'node-2043' }, { id: 'node-2059' }, { id: 'sent-1' }],
          edges: [],
        },
      });
    }

    function successTurn(): QaTurnModel {
      return {
        id: 'turn-1',
        question: 'Qual è la ratio dell’art. 2043?',
        confirmed: {},
        state: {
          status: 'success',
          answer: {
            trace_id: 'trace-1',
            synthesis: 'La ratio è il neminem laedere.',
            mode: 'convergent',
            alternatives: null,
            sources: [],
            retrieved_sources: [
              // Matches node-2043 by node_id, node-2059 by urn, third is absent.
              { urn: 'urn:x~art2043', provenance: 'seed', trust: 0.9, node_id: 'node-2043' },
              { urn: 'urn:x~art2059', provenance: 'seed', trust: 0.8, node_id: null },
              { urn: 'urn:absent', provenance: 'live_unconfirmed', trust: 0.3, node_id: null },
            ],
            experts_used: ['literal'],
            confidence: 0.8,
            execution_time_ms: 100,
          },
        },
      };
    }

    it('mounts the header "Chiedi al grafo" field and forwards asks to useQaThread', () => {
      setPopulatedGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');

      // Two ask inputs share the label (header + column composer) — the header is
      // first in DOM order.
      const field = screen.getAllByLabelText('Chiedi al grafo', { selector: 'input' })[0];
      fireEvent.change(field, { target: { value: 'Perché neminem laedere?' } });
      fireEvent.keyDown(field, { key: 'Enter' });

      expect(qaAskMock).toHaveBeenCalledWith('Perché neminem laedere?', 'convergent');
    });

    it('disables asking when consent is below basic (qaAskable=false)', () => {
      featuresMock.mockReturnValue(features({ qaAskable: false, canContribute: false }));
      setPopulatedGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');
      // The AskGraphField renders its inert consent hint instead of the input.
      expect(screen.getAllByText(/serve il consenso base/i).length).toBeGreaterThan(0);
    });

    it('consumes the QA-PREFILL location.state once and fires an ask', async () => {
      setPopulatedGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043', {
        prefillQuery: 'Spiega la responsabilità aquiliana',
        articleUrn: 'urn:x~art2043',
        articleHeading: 'Art. 2043',
      });
      await waitFor(() =>
        expect(qaAskMock).toHaveBeenCalledWith('Spiega la responsabilità aquiliana', 'convergent')
      );
      // Consumed exactly once — no duplicate ask on re-render.
      expect(qaAskMock).toHaveBeenCalledTimes(1);
    });

    it('does NOT consume the QA-PREFILL when asking is locked (no silent drop)', async () => {
      featuresMock.mockReturnValue(features({ qaAskable: false, canContribute: false }));
      setPopulatedGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043', {
        prefillQuery: 'Spiega la responsabilità aquiliana',
        articleUrn: 'urn:x~art2043',
        articleHeading: 'Art. 2043',
      });
      // The ask must NOT fire while locked — the prefill stays intact (F4: no
      // silent loss). The disabled AskGraphField surfaces the consent hint instead.
      await waitFor(() =>
        expect(screen.getAllByText(/serve il consenso base/i).length).toBeGreaterThan(0)
      );
      expect(qaAskMock).not.toHaveBeenCalled();
    });

    it('highlights source nodes present in the subgraph and lists absent ones as chips', () => {
      qaThreadState.turns = [successTurn()];
      setPopulatedGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');

      // node-2043 (by node_id) + node-2059 (by urn) light up; urn:absent does not.
      const ids = lastCanvasProps.highlightNodeIds as ReadonlySet<string>;
      expect(ids).toBeTruthy();
      expect(ids.has('node-2043')).toBe(true);
      expect(ids.has('node-2059')).toBe(true);
      expect(ids.has('sent-1')).toBe(false);
    });

    it('hides jurisprudence by default once a deliberation is active', () => {
      qaThreadState.turns = [successTurn()];
      setPopulatedGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');

      const hidden = lastCanvasProps.hiddenNodeTypes as ReadonlySet<string>;
      expect(hidden.has('AttoGiudiziario')).toBe(true);
      // The primary control reflects the pressed (hidden) state.
      expect(
        screen.getByRole('button', { name: /nascondi giurisprudenza/i })
      ).toHaveAttribute('aria-pressed', 'true');
    });

    it('does NOT hide jurisprudence when there is no deliberation (manual off default)', () => {
      setPopulatedGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');
      const hidden = lastCanvasProps.hiddenNodeTypes as ReadonlySet<string>;
      expect(hidden.has('AttoGiudiziario')).toBe(false);
      expect(
        screen.getByRole('button', { name: /nascondi giurisprudenza/i })
      ).toHaveAttribute('aria-pressed', 'false');
    });

    it('toggling the jurisprudence control overrides the derived default', () => {
      qaThreadState.turns = [successTurn()];
      setPopulatedGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');
      // Default-on with a deliberation → click turns it OFF.
      fireEvent.click(screen.getByRole('button', { name: /nascondi giurisprudenza/i }));
      const hidden = lastCanvasProps.hiddenNodeTypes as ReadonlySet<string>;
      expect(hidden.has('AttoGiudiziario')).toBe(false);
    });

    it('exposes the Cronologia affordance and loads a past deliberation via useQaThread', async () => {
      fetchHistoryMock.mockResolvedValue([
        {
          trace_id: 'trace-past-1',
          query: 'Domanda passata sull’art. 2043?',
          synthesis: 'Sintesi passata.',
          mode: 'convergent',
          confidence: 0.7,
          experts_used: ['literal'],
          sources: [],
          created_at: '2026-06-01T10:00:00Z',
        },
      ]);
      setPopulatedGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');

      // Open the server history from the docked deliberation column.
      fireEvent.click(screen.getByRole('button', { name: /^cronologia$/i }));
      const pastItem = await screen.findByText(/domanda passata/i);
      fireEvent.click(pastItem);

      // Selecting a past item loads it back into the thread (Decision A).
      expect(loadHistoryTurnMock).toHaveBeenCalledWith(
        expect.objectContaining({ trace_id: 'trace-past-1' }),
      );
    });

    it('a node click selects it and switches the column to the Nodo tab', () => {
      setPopulatedGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');
      // Drive the canvas onNodeClick prop directly (canvas is mocked); wrap in act
      // so the resulting setState (select + tab switch) flushes before asserting.
      act(() => {
        (lastCanvasProps.onNodeClick as (id: string) => void)('node-2059');
      });
      // The Nodo tab is now selected in the docked column.
      const nodoTab = screen.getByRole('tab', { name: /nodo/i });
      expect(nodoTab).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('Slice 4 P2a — il dibattito visibile (debate overlay on canvas)', () => {
    function setPopulatedGraph(): void {
      setGraph({
        status: 'success',
        data: {
          nodes: [{ id: 'node-2043', type: 'Norma', label: 'Art. 2043', urn: 'urn:x~art2043' }],
          edges: [],
        },
        elements: { nodes: [{ id: 'node-2043' }], edges: [] },
      });
    }

    // A successful turn carrying the widened deliberation fields (expert
    // contributions + one expert-pair conflict + devil's-advocate flag).
    function deliberationTurn(): QaTurnModel {
      const answer = {
        trace_id: 'trace-d',
        synthesis: 'Sintesi con dissenso.',
        mode: 'convergent',
        alternatives: null,
        sources: [],
        retrieved_sources: [],
        experts_used: ['literal', 'principles'],
        confidence: 0.7,
        execution_time_ms: 100,
        expert_contributions: [
          { expert: 'literal', thesis: 'Tesi letterale', confidence: 0.9, weight: 0.6 },
          { expert: 'principles', thesis: 'Tesi principî', confidence: 0.8, weight: 0.4 },
        ],
        disagreement_analysis: {
          has_disagreement: true,
          conflicts: [
            { expert_a: 'literal', expert_b: 'principles', conflict_score: 0.68, contention_point: 'testo/spirito' },
          ],
        },
        devils_advocate_flag: { active: true, expert: null },
      };
      // Cast: QaAnswer does not type the P2a fields yet; the BFF passes them
      // through and readDeliberation narrows them structurally at runtime.
      return {
        id: 'turn-d',
        question: 'C’è contrasto?',
        confirmed: {},
        state: { status: 'success', answer },
      } as unknown as QaTurnModel;
    }

    it('injects canon nodes + a contrast arc onto the canvas from a deliberation', () => {
      qaThreadState.turns = [deliberationTurn()];
      setPopulatedGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');

      const nodes = lastCanvasProps.nodes as Array<{ id: string }>;
      const edges = lastCanvasProps.edges as Array<{ id: string; source?: string }>;
      const ids = nodes.map((n) => n.id);
      expect(ids).toContain('canon:literal');
      expect(ids).toContain('canon:principles');
      // The contrast arc between the two canons is present.
      expect(edges.some((e) => e.id.startsWith('contrast:'))).toBe(true);
      // And an anchor tether ties a canon to the centered article node.
      expect(edges.some((e) => e.source === 'node-2043' && e.id.startsWith('canon:anchor:'))).toBe(true);
    });

    it('sizes canon nodes by routing weight (weight carried onto the item data)', () => {
      qaThreadState.turns = [deliberationTurn()];
      setPopulatedGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');
      const nodes = lastCanvasProps.nodes as Array<{ id: string; data?: { weight?: number } }>;
      const literal = nodes.find((n) => n.id === 'canon:literal');
      const principles = nodes.find((n) => n.id === 'canon:principles');
      expect(literal?.data?.weight).toBe(0.6);
      expect(principles?.data?.weight).toBe(0.4);
    });

    it('removes the overlay on a NEW ask (latest turn loading → no synthetic nodes)', () => {
      // Newest turn is a fresh (loading) ask AFTER a completed deliberation.
      qaThreadState.turns = [
        deliberationTurn(),
        { id: 'turn-new', question: 'Nuova domanda', confirmed: {}, state: { status: 'loading' } } as QaTurnModel,
      ];
      setPopulatedGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');

      const ids = (lastCanvasProps.nodes as Array<{ id: string }>).map((n) => n.id);
      // Only the real subgraph node remains — no lingering canon overlay.
      expect(ids).toEqual(['node-2043']);
    });

    it('does not overlay canons when the answer carries no deliberation fields', () => {
      qaThreadState.turns = [
        {
          id: 'turn-plain',
          question: 'Domanda semplice',
          confirmed: {},
          state: {
            status: 'success',
            answer: {
              trace_id: 't',
              synthesis: 's',
              mode: 'convergent',
              alternatives: null,
              sources: [],
              retrieved_sources: [],
              experts_used: ['literal'],
              confidence: 0.8,
              execution_time_ms: 10,
            },
          },
        } as QaTurnModel,
      ];
      setPopulatedGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');
      const ids = (lastCanvasProps.nodes as Array<{ id: string }>).map((n) => n.id);
      expect(ids).toEqual(['node-2043']);
    });

    it('an edge:click on a contrast arc selects it and switches the column to Nodo', () => {
      qaThreadState.turns = [deliberationTurn()];
      setPopulatedGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');

      // The contrast-arc id emitted by the canvas for this canon pair.
      const edges = lastCanvasProps.edges as Array<{ id: string }>;
      const contrastId = edges.find((e) => e.id.startsWith('contrast:'))!.id;

      act(() => {
        (lastCanvasProps.onEdgeClick as (id: string) => void)(contrastId);
      });
      expect(screen.getByRole('tab', { name: /nodo/i })).toHaveAttribute('aria-selected', 'true');
    });

    it('ignores an edge:click on a canon-anchor tether (structural, not inspectable)', () => {
      qaThreadState.turns = [deliberationTurn()];
      setPopulatedGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');
      const edges = lastCanvasProps.edges as Array<{ id: string }>;
      const anchorId = edges.find((e) => e.id.startsWith('canon:anchor:'))!.id;
      act(() => {
        (lastCanvasProps.onEdgeClick as (id: string) => void)(anchorId);
      });
      // Stays on the Dibattito tab — an anchor is not a selectable relation.
      expect(screen.getByRole('tab', { name: /dibattito/i })).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('Slice 4 L3 — relation steer (privilegia questa relazione)', () => {
    /** Real subgraph with one DISCIPLINA relation between two Norma nodes. */
    function setRelationGraph(): void {
      setGraph({
        status: 'success',
        data: {
          nodes: [
            { id: 'node-2043', type: 'Norma', label: 'Art. 2043', urn: 'urn:x~art2043' },
            { id: 'node-2059', type: 'Norma', label: 'Art. 2059', urn: 'urn:x~art2059' },
          ],
          edges: [
            { id: 'e1', source: 'node-2043', target: 'node-2059', type: 'DISCIPLINA', properties: {} },
          ],
        },
        elements: {
          nodes: [{ id: 'node-2043' }, { id: 'node-2059' }],
          edges: [{ id: 'e1', source: 'node-2043', target: 'node-2059' }],
        },
      });
    }

    /** A settled turn: only trace_id matters — the steer keys the feedback on it. */
    function settledTurn(traceId: string): QaTurnModel {
      return {
        id: `turn-${traceId}`,
        question: 'Domanda deliberata',
        confirmed: {},
        state: {
          status: 'success',
          answer: {
            trace_id: traceId,
            synthesis: 'Sintesi.',
            mode: 'convergent',
            alternatives: null,
            sources: [],
            retrieved_sources: [],
            experts_used: ['literal'],
            confidence: 0.8,
            execution_time_ms: 10,
          },
        },
      } as QaTurnModel;
    }

    function selectRelationEdge(): void {
      act(() => {
        (lastCanvasProps.onEdgeClick as (id: string) => void)('e1');
      });
    }

    it('shows the steer on a selected relation and POSTs the latest trace_id + the edge relation type', () => {
      qaThreadState.turns = [settledTurn('trace-r')];
      setRelationGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');

      selectRelationEdge();
      const steer = screen.getByRole('button', { name: /privilegia questa relazione/i });
      fireEvent.click(steer);

      expect(sendRelationFeedbackMock).toHaveBeenCalledTimes(1);
      expect(sendRelationFeedbackMock).toHaveBeenCalledWith('trace-r', 'DISCIPLINA');
      // Optimistic Italian confirmation quoting the relation.
      expect(screen.getByText(/terrò conto: privilegerò «DISCIPLINA»/i)).toBeInTheDocument();
    });

    it('hides the steer when there is no deliberation yet (no trace to attach to)', () => {
      qaThreadState.turns = [];
      setRelationGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');

      selectRelationEdge();
      // The edge details open, but no steer and no upsell.
      expect(screen.getByRole('heading', { name: 'Relazione' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /privilegia questa relazione/i })).not.toBeInTheDocument();
      expect(sendRelationFeedbackMock).not.toHaveBeenCalled();
    });

    it('hides the steer while the newest turn is still deliberating (same lifecycle as the overlay)', () => {
      qaThreadState.turns = [
        settledTurn('trace-old'),
        { id: 'turn-live', question: 'Nuova domanda', confirmed: {}, state: { status: 'loading' } } as QaTurnModel,
      ];
      setRelationGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');

      selectRelationEdge();
      expect(screen.queryByRole('button', { name: /privilegia questa relazione/i })).not.toBeInTheDocument();
    });

    it('renders the consent upsell instead of the steer when the user lacks full consent', () => {
      featuresMock.mockReturnValue(features({ canContribute: false, canValidate: false, consentLevel: 'basic' }));
      qaThreadState.turns = [settledTurn('trace-r')];
      setRelationGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');

      selectRelationEdge();
      expect(screen.queryByRole('button', { name: /privilegia questa relazione/i })).not.toBeInTheDocument();
      expect(screen.getByText(/serve il consenso completo/i)).toBeInTheDocument();
      expect(sendRelationFeedbackMock).not.toHaveBeenCalled();
    });
  });

  describe('Wave 1 — /grafo interaction overhaul (P1)', () => {
    /** Two Norma nodes with distinct urns so recentering changes the center. */
    function setTwoNodeGraph(): void {
      setGraph({
        status: 'success',
        data: {
          nodes: [
            { id: 'node-2043', type: 'Norma', label: 'Art. 2043', urn: 'urn:x~art2043' },
            { id: 'node-2059', type: 'Norma', label: 'Art. 2059', urn: 'urn:x~art2059' },
          ],
          edges: [],
        },
        elements: { nodes: [{ id: 'node-2043' }, { id: 'node-2059' }], edges: [] },
      });
    }

    /** A settled turn with per-canon contributions AND joinable sources. */
    function richTurn(): QaTurnModel {
      const answer = {
        trace_id: 'trace-w1',
        synthesis: 'Sintesi.',
        mode: 'convergent',
        alternatives: null,
        sources: [],
        retrieved_sources: [
          { urn: 'urn:x~art2043', provenance: 'seed', trust: 0.9, node_id: 'node-2043' },
        ],
        experts_used: ['literal', 'principles'],
        confidence: 0.8,
        execution_time_ms: 100,
        expert_contributions: [
          { expert: 'literal', thesis: 'Tesi letterale', confidence: 0.9, weight: 0.6 },
          { expert: 'principles', thesis: 'Tesi principî', confidence: 0.8, weight: 0.4 },
        ],
      };
      return {
        id: 'turn-w1',
        question: 'Domanda?',
        confirmed: {},
        state: { status: 'success', answer },
      } as unknown as QaTurnModel;
    }

    function loadingTurn(): QaTurnModel {
      return {
        id: 'turn-live',
        question: 'In corso…',
        confirmed: {},
        state: { status: 'loading', startedAt: 1 },
      } as QaTurnModel;
    }

    const canvasNodeIds = (): string[] =>
      (lastCanvasProps.nodes as Array<{ id: string }>).map((n) => n.id);

    it('a canon star click opens the Dibattito tab and expands that canon thesis (defect #5)', () => {
      qaThreadState.turns = [richTurn()];
      setTwoNodeGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');

      act(() => {
        (lastCanvasProps.onNodeClick as (id: string) => void)('canon:literal');
      });

      // NOT the empty Nodo drawer: the debate tab stays/becomes active…
      expect(screen.getByRole('tab', { name: /dibattito/i })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: /nodo/i })).toHaveAttribute('aria-selected', 'false');
      // …and the clicked canon's thesis is expanded.
      const details = document.querySelector('details[data-canon="literal"]') as HTMLDetailsElement;
      expect(details).toBeTruthy();
      expect(details.open).toBe(true);
    });

    it('Esc deselects the node and returns to the Dibattito tab (P1.7)', () => {
      setTwoNodeGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');
      act(() => {
        (lastCanvasProps.onNodeClick as (id: string) => void)('node-2059');
      });
      expect(screen.getByRole('tab', { name: /nodo/i })).toHaveAttribute('aria-selected', 'true');

      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(screen.getByRole('tab', { name: /dibattito/i })).toHaveAttribute('aria-selected', 'true');
    });

    it('pulses the Dibattito tab when a turn settles while on Nodo, cleared on open (defect #4)', () => {
      qaThreadState.turns = [loadingTurn()];
      setTwoNodeGraph();
      const view = renderAt('/grafo?urn=urn%3Ax~art2043');
      act(() => {
        (lastCanvasProps.onNodeClick as (id: string) => void)('node-2059');
      });
      expect(screen.queryByText('nuova risposta')).not.toBeInTheDocument();

      // The turn settles while the user inspects the node.
      qaThreadState.turns = [richTurn()];
      view.rerender(pageAt('/grafo?urn=urn%3Ax~art2043'));
      expect(screen.getByText('nuova risposta')).toBeInTheDocument();

      // Opening the Dibattito tab clears the pulse.
      fireEvent.click(screen.getByRole('tab', { name: /dibattito/i }));
      expect(screen.queryByText('nuova risposta')).not.toBeInTheDocument();
    });

    it('scopes the deliberation to its ask-time center: recenter hides the overlay, "Torna" restores it (defect #10)', () => {
      qaThreadState.turns = [richTurn()];
      setTwoNodeGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');

      // Ask from the header → records the scope on art2043.
      const field = screen.getAllByLabelText('Chiedi al grafo', { selector: 'input' })[0];
      fireEvent.change(field, { target: { value: 'Domanda scoped' } });
      fireEvent.keyDown(field, { key: 'Enter' });
      expect(canvasNodeIds().some((id) => id.startsWith('canon:'))).toBe(true);
      expect(screen.queryByText(/dibattito attivo su/i)).not.toBeInTheDocument();

      // Recenter on ANOTHER node (double-click) → different center.
      act(() => {
        (lastCanvasProps.onNodeDblClick as (id: string) => void)('node-2059');
      });
      // Overlay + source emphasis are gone; the scope chip appears instead.
      expect(canvasNodeIds().some((id) => id.startsWith('canon:'))).toBe(false);
      expect(lastCanvasProps.highlightNodeIds ?? null).toBeNull();
      expect(screen.getByText(/dibattito attivo su/i)).toBeInTheDocument();

      // "Torna" recenters on the deliberation's own center → overlay returns.
      fireEvent.click(screen.getByRole('button', { name: /torna/i }));
      expect(canvasNodeIds().some((id) => id.startsWith('canon:'))).toBe(true);
      expect(screen.queryByText(/dibattito attivo su/i)).not.toBeInTheDocument();
    });

    it('"× evidenza fonti" dismisses the sources emphasis (P1.9)', () => {
      qaThreadState.turns = [richTurn()];
      setTwoNodeGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');

      expect(lastCanvasProps.highlightNodeIds).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /rimuovi evidenza fonti/i }));
      expect(lastCanvasProps.highlightNodeIds).toBeNull();
      // The chip disappears with the emphasis.
      expect(screen.queryByRole('button', { name: /rimuovi evidenza fonti/i })).not.toBeInTheDocument();
    });

    it('"Adatta alla vista" calls the canvas fit handle (P1.7)', async () => {
      setTwoNodeGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');
      await screen.findByTestId('cytoscape');
      fireEvent.click(screen.getByRole('button', { name: /adatta alla vista/i }));
      expect(canvasFitMock).toHaveBeenCalledTimes(1);
    });

    it('the load ErrorState offers "Riprova" wired to refetch (P1.11)', () => {
      const refetch = vi.fn();
      useArticleGraphMock.mockReturnValue({ status: 'error', error: new Error('boom'), refetch });
      renderAt('/grafo?urn=urn%3Atest');
      expect(screen.getByText(/errore nel caricamento del grafo/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /riprova/i }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('blocks new asks while a turn is in flight (P1.10)', () => {
      qaThreadState.turns = [loadingTurn()];
      setTwoNodeGraph();
      renderAt('/grafo?urn=urn%3Ax~art2043');

      const field = screen.getAllByLabelText('Chiedi al grafo', { selector: 'input' })[0];
      fireEvent.change(field, { target: { value: 'Altra domanda' } });
      fireEvent.keyDown(field, { key: 'Enter' });
      expect(qaAskMock).not.toHaveBeenCalled();
      // Both submit buttons (header + column composer) are disabled together.
      for (const btn of screen.getAllByRole('button', { name: 'Chiedi al grafo' })) {
        expect(btn).toBeDisabled();
      }
    });
  });
});
