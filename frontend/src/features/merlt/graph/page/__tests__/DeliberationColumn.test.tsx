import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeliberationColumn } from '../DeliberationColumn';
import type { QaHistoryItem, QaTurnModel } from '../../../qa/types';
import type { GraphEdge, GraphNode } from '../../shared/types';

// QaHistoryPanel (rendered by the Dibattito "Cronologia" affordance) fetches the
// server history on mount — mock the network so the panel is deterministic.
const fetchHistoryMock = vi.fn();
vi.mock('../../../qa/qaApi', () => ({
  fetchHistory: (...a: unknown[]) => fetchHistoryMock(...a),
}));

const noop = vi.fn();

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
          { urn: 'urn:x~art2043', provenance: 'seed', trust: 0.9, node_id: 'node-2043' },
          { urn: 'urn:x~art2059', provenance: 'live_unconfirmed', trust: 0.4, node_id: null },
        ],
        experts_used: ['literal'],
        confidence: 0.8,
        execution_time_ms: 100,
      },
    },
  };
}

const node: GraphNode = {
  id: 'node-2043',
  urn: 'urn:x~art2043',
  type: 'Norma',
  label: 'Art. 2043 c.c.',
  properties: { rubrica: 'Risarcimento per fatto illecito' },
};

function baseProps() {
  return {
    activeTab: 'dibattito' as const,
    onTabChange: vi.fn(),
    turns: [] as QaTurnModel[],
    onAsk: vi.fn(),
    onRetry: vi.fn(),
    onCancel: vi.fn(),
    onSourceCenter: vi.fn(),
    canContribute: false,
    qaAskable: true,
  };
}

beforeEach(() => {
  noop.mockReset();
  fetchHistoryMock.mockReset();
  fetchHistoryMock.mockResolvedValue([]);
});

function historyItem(): QaHistoryItem {
  return {
    trace_id: 'trace-past-1',
    query: 'Domanda passata sull’art. 1453?',
    synthesis: 'Sintesi passata.',
    mode: 'convergent',
    confidence: 0.7,
    experts_used: ['literal'],
    sources: [],
    created_at: '2026-06-01T10:00:00Z',
  };
}

describe('DeliberationColumn tabs', () => {
  it('calls onTabChange when the Nodo tab is clicked', () => {
    const props = baseProps();
    render(<DeliberationColumn {...props} />);
    fireEvent.click(screen.getByRole('tab', { name: /nodo/i }));
    expect(props.onTabChange).toHaveBeenCalledWith('nodo');
  });

  it('marks the active tab with aria-selected', () => {
    render(<DeliberationColumn {...baseProps()} activeTab="dibattito" />);
    expect(screen.getByRole('tab', { name: /dibattito/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /nodo/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('shows the empty deliberation hint with no turns', () => {
    render(<DeliberationColumn {...baseProps()} />);
    expect(screen.getByText(/nessuna deliberazione/i)).toBeInTheDocument();
  });
});

describe('DeliberationColumn dibattito tab', () => {
  it('renders the synthesis and source chips of a completed turn', () => {
    render(<DeliberationColumn {...baseProps()} turns={[successTurn()]} />);
    expect(screen.getByText(/neminem laedere/i)).toBeInTheDocument();
    expect(screen.getByText('Fonti consultate (2)')).toBeInTheDocument();
  });

  it('re-centers the canvas on the node_id when a source chip is clicked (prefers node_id)', () => {
    const props = baseProps();
    render(<DeliberationColumn {...props} turns={[successTurn()]} />);
    // The chip button's accessible name is its text content (label + provenance).
    fireEvent.click(screen.getByRole('button', { name: /art\. 2043.*fondativa/i }));
    expect(props.onSourceCenter).toHaveBeenCalledWith('node-2043');
  });

  it('falls back to the urn when a source has no node_id', () => {
    const props = baseProps();
    render(<DeliberationColumn {...props} turns={[successTurn()]} />);
    fireEvent.click(screen.getByRole('button', { name: /art\. 2059.*provvisoria/i }));
    expect(props.onSourceCenter).toHaveBeenCalledWith('urn:x~art2059');
  });

  it('wires onRetry on a failed turn', () => {
    const props = baseProps();
    const errorTurn: QaTurnModel = {
      id: 'turn-err',
      question: 'domanda?',
      confirmed: {},
      state: { status: 'error', error: 'Motore non raggiungibile.' },
    };
    render(<DeliberationColumn {...props} turns={[errorTurn]} />);
    fireEvent.click(screen.getByRole('button', { name: /riprova/i }));
    expect(props.onRetry).toHaveBeenCalledWith('turn-err');
  });

  it('disables the compose field when asking is not unlocked', () => {
    render(<DeliberationColumn {...baseProps()} qaAskable={false} />);
    expect(screen.getByText(/serve il consenso base/i)).toBeInTheDocument();
  });

  it('forwards a composed question via onAsk', () => {
    const props = baseProps();
    render(<DeliberationColumn {...props} qaAskable />);
    const input = screen.getByRole('textbox', { name: /chiedi al grafo/i });
    fireEvent.change(input, { target: { value: 'nuova domanda' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onAsk).toHaveBeenCalledWith('nuova domanda', 'convergent');
  });
});

describe('DeliberationColumn history (Decision A — server chat history in the column)', () => {
  it('exposes the Cronologia affordance in the Dibattito tab when onLoadHistoryTurn is provided', () => {
    render(<DeliberationColumn {...baseProps()} onLoadHistoryTurn={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^cronologia$/i })).toBeInTheDocument();
  });

  it('hides the Cronologia affordance when onLoadHistoryTurn is absent', () => {
    render(<DeliberationColumn {...baseProps()} />);
    expect(screen.queryByRole('button', { name: /^cronologia$/i })).not.toBeInTheDocument();
  });

  it('opening Cronologia renders the server history panel (fetchHistory)', async () => {
    fetchHistoryMock.mockResolvedValue([historyItem()]);
    render(<DeliberationColumn {...baseProps()} onLoadHistoryTurn={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^cronologia$/i }));
    expect(fetchHistoryMock).toHaveBeenCalled();
    expect(await screen.findByText(/domanda passata/i)).toBeInTheDocument();
  });

  it('selecting a past deliberation calls onLoadHistoryTurn and closes the panel', async () => {
    const onLoadHistoryTurn = vi.fn();
    fetchHistoryMock.mockResolvedValue([historyItem()]);
    render(<DeliberationColumn {...baseProps()} onLoadHistoryTurn={onLoadHistoryTurn} />);

    fireEvent.click(screen.getByRole('button', { name: /^cronologia$/i }));
    const pastItem = await screen.findByText(/domanda passata/i);
    fireEvent.click(pastItem);

    expect(onLoadHistoryTurn).toHaveBeenCalledTimes(1);
    expect(onLoadHistoryTurn).toHaveBeenCalledWith(expect.objectContaining({ trace_id: 'trace-past-1' }));
    // Panel closes after a selection → the toggle returns to "Cronologia".
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^cronologia$/i })).toBeInTheDocument()
    );
  });
});

describe('DeliberationColumn nodo tab', () => {
  it('renders NodeDetailsDrawer for the selected node', () => {
    render(
      <DeliberationColumn
        {...baseProps()}
        activeTab="nodo"
        selectedNode={node}
        nodesById={new Map([[node.id, node]])}
        edges={[]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Art. 2043 c.c.' })).toBeInTheDocument();
    expect(screen.getByText('Risarcimento per fatto illecito')).toBeInTheDocument();
  });

  it('renders EdgeDetailsDrawer for the selected edge', () => {
    const edge: GraphEdge = {
      id: 'e1',
      source: 'node-2043',
      target: 'node-2059',
      type: 'RIGUARDA',
      properties: {},
    };
    render(
      <DeliberationColumn
        {...baseProps()}
        activeTab="nodo"
        selectedEdge={edge}
        nodesById={new Map([[node.id, node]])}
        edges={[edge]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Relazione' })).toBeInTheDocument();
  });

  it('shows the empty inspection hint when nothing is selected', () => {
    render(<DeliberationColumn {...baseProps()} activeTab="nodo" />);
    expect(screen.getByText(/seleziona un nodo o una relazione/i)).toBeInTheDocument();
  });
});
