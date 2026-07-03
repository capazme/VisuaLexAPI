import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeliberationColumn } from '../DeliberationColumn';
import type { ExpertContribution, QaHistoryItem, QaTurnModel } from '../../../qa/types';
import type { GraphEdge, GraphEdgeSelection, GraphNode } from '../../shared/types';

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

/** A turn whose answer carries per-canon FULL theses (one canon errored). */
function turnWithContributions(): QaTurnModel {
  const contributions: ExpertContribution[] = [
    {
      expert: 'literal',
      thesis: 'Il tenore letterale dell’art. 2043 richiede un fatto doloso o colposo.',
      confidence: 0.82,
      weight: 0.4,
    },
    {
      expert: 'principles',
      thesis: 'La ratio è il principio del neminem laedere di rango costituzionale.',
      confidence: 0.71,
      weight: 0.35,
    },
    {
      // Errored canon: MERL-T base.py emits this string with confidence 0.
      expert: 'precedent',
      thesis: 'Errore durante l’analisi: timeout del servizio.',
      confidence: 0,
      weight: 0.1,
    },
  ];
  return {
    id: 'turn-canon',
    question: 'Qual è la ratio dell’art. 2043?',
    confirmed: {},
    state: {
      status: 'success',
      answer: {
        trace_id: 'trace-canon',
        synthesis: 'La ratio è il neminem laedere.',
        mode: 'convergent',
        alternatives: null,
        sources: [],
        retrieved_sources: [],
        experts_used: ['literal', 'principles', 'precedent'],
        confidence: 0.8,
        execution_time_ms: 100,
        expert_contributions: contributions,
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

  it('renders EdgeDetailsDrawer for a selected RELATION edge (kind: relation)', () => {
    const edge: GraphEdge = {
      id: 'e1',
      source: 'node-2043',
      target: 'node-2059',
      type: 'RIGUARDA',
      properties: {},
    };
    const selection: GraphEdgeSelection = { kind: 'relation', edge };
    render(
      <DeliberationColumn
        {...baseProps()}
        activeTab="nodo"
        selectedEdge={selection}
        nodesById={new Map([[node.id, node]])}
        edges={[edge]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Relazione' })).toBeInTheDocument();
  });

  it('renders the contrast conflict view for a selected CONTRAST arc (kind: contrast)', () => {
    const selection: GraphEdgeSelection = {
      kind: 'contrast',
      conflict: {
        expert_a: 'literal',
        expert_b: 'principles',
        conflict_score: 0.68,
        contention_point: 'La lettera esclude ciò che la ratio impone.',
        excerpt_a: 'Il testo è tassativo.',
        excerpt_b: 'Il principio prevale sul dato letterale.',
      },
      expertALabel: 'Letterale',
      expertBLabel: 'Principî',
      isDevilsAdvocate: true,
    };
    render(
      <DeliberationColumn {...baseProps()} activeTab="nodo" selectedEdge={selection} />,
    );
    expect(screen.getByRole('heading', { name: /contrasto tra canoni/i })).toBeInTheDocument();
    // Devil's-advocate flag surfaces as a deliberate-challenge badge.
    expect(screen.getByText(/sfida deliberata/i)).toBeInTheDocument();
    // Reason + both excerpts are shown.
    expect(screen.getByText(/la lettera esclude/i)).toBeInTheDocument();
    expect(screen.getByText(/il testo è tassativo/i)).toBeInTheDocument();
    expect(screen.getByText(/il principio prevale/i)).toBeInTheDocument();
  });

  it('shows the empty inspection hint when nothing is selected', () => {
    render(<DeliberationColumn {...baseProps()} activeTab="nodo" />);
    expect(screen.getByText(/seleziona un nodo o una relazione/i)).toBeInTheDocument();
  });
});

describe('DeliberationColumn per-canon theses (Slice 4 P2a — il dibattito visibile)', () => {
  it('renders each canon FULL thesis from expert_contributions, canon-labelled', () => {
    render(<DeliberationColumn {...baseProps()} turns={[turnWithContributions()]} />);
    expect(screen.getByText(/le tesi dei canoni/i)).toBeInTheDocument();
    // The two arguing canons render their labels and FULL theses.
    expect(screen.getByText('Letterale')).toBeInTheDocument();
    expect(screen.getByText('Principî')).toBeInTheDocument();
    expect(screen.getByText(/tenore letterale dell’art\. 2043 richiede un fatto doloso/i)).toBeInTheDocument();
    expect(screen.getByText(/principio del neminem laedere di rango costituzionale/i)).toBeInTheDocument();
  });

  it('shows the per-canon weight and confidence meta', () => {
    render(<DeliberationColumn {...baseProps()} turns={[turnWithContributions()]} />);
    // Literal: weight 0.40 → "peso 40%"; confidence 0.82 → "alta".
    expect(screen.getByText(/peso 40%/i)).toBeInTheDocument();
    expect(screen.getAllByText(/confidenza alta/i).length).toBeGreaterThan(0);
  });

  it('renders an errored canon as a subdued "non ha argomentato" state, not the error string', () => {
    render(<DeliberationColumn {...baseProps()} turns={[turnWithContributions()]} />);
    // Precedente errored (thesis starts with "Errore durante…", confidence 0).
    expect(screen.getByText('Precedente')).toBeInTheDocument();
    expect(screen.getByText(/non ha argomentato/i)).toBeInTheDocument();
    // The raw error string is NEVER surfaced to the reader.
    expect(screen.queryByText(/errore durante l’analisi/i)).not.toBeInTheDocument();
  });

  it('falls back to the expertContributions prop when the turn answer omits them (current deliberation)', () => {
    // successTurn() carries no expert_contributions → the latest turn uses the prop.
    const contributions: ExpertContribution[] = [
      { expert: 'systemic', thesis: 'Lettura sistematica dell’istituto.', confidence: 0.6, weight: 0.5 },
    ];
    render(
      <DeliberationColumn {...baseProps()} turns={[successTurn()]} expertContributions={contributions} />,
    );
    expect(screen.getByText(/le tesi dei canoni/i)).toBeInTheDocument();
    expect(screen.getByText('Sistematico')).toBeInTheDocument();
    expect(screen.getByText(/lettura sistematica dell’istituto/i)).toBeInTheDocument();
  });
});

describe('DeliberationColumn per-canon steer (Slice 4 P2b — insegna i pesi, L2)', () => {
  it('calls onPreferCanon with the turn trace_id and the canon expert when full consent', () => {
    const onPreferCanon = vi.fn();
    render(
      <DeliberationColumn
        {...baseProps()}
        turns={[turnWithContributions()]}
        canContribute
        onPreferCanon={onPreferCanon}
      />,
    );
    // Two arguing canons (Letterale, Principî) each carry a steer button; the
    // errored Precedente canon has none (see its own test below).
    const steerButtons = screen.getAllByRole('button', { name: /pesa di più questo canone/i });
    expect(steerButtons).toHaveLength(2);
    // The FIRST arguing canon in art. 12 order is `literal` (Letterale).
    fireEvent.click(steerButtons[0]);
    expect(onPreferCanon).toHaveBeenCalledTimes(1);
    expect(onPreferCanon).toHaveBeenCalledWith('trace-canon', 'literal');
  });

  it('steering a different canon carries THAT canon identity + the same trace_id', () => {
    const onPreferCanon = vi.fn();
    render(
      <DeliberationColumn
        {...baseProps()}
        turns={[turnWithContributions()]}
        canContribute
        onPreferCanon={onPreferCanon}
      />,
    );
    // The SECOND arguing canon in art. 12 order is `principles` (Principî).
    const steerButtons = screen.getAllByRole('button', { name: /pesa di più questo canone/i });
    fireEvent.click(steerButtons[1]);
    expect(onPreferCanon).toHaveBeenCalledWith('trace-canon', 'principles');
  });

  it('shows an optimistic confirmation and hides the steer button after a click', () => {
    render(
      <DeliberationColumn
        {...baseProps()}
        turns={[turnWithContributions()]}
        canContribute
        onPreferCanon={vi.fn()}
      />,
    );
    const steerButtons = screen.getAllByRole('button', { name: /pesa di più questo canone/i });
    fireEvent.click(steerButtons[0]);
    expect(screen.getByText(/terrò conto della tua preferenza/i)).toBeInTheDocument();
    // The clicked canon's steer button is replaced by the confirmation (one fewer).
    expect(screen.getAllByRole('button', { name: /pesa di più questo canone/i })).toHaveLength(1);
  });

  it('renders the compact upsell (not a dead button) when the user lacks full consent', () => {
    render(
      <DeliberationColumn
        {...baseProps()}
        turns={[turnWithContributions()]}
        canContribute={false}
        onPreferCanon={vi.fn()}
        onOpenConsent={vi.fn()}
      />,
    );
    // No steer button at all when !canContribute…
    expect(screen.queryByRole('button', { name: /pesa di più questo canone/i })).not.toBeInTheDocument();
    // …instead the upsell copy + an "Attiva" affordance (one per arguing canon).
    expect(screen.getAllByText(/serve il consenso completo/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^attiva$/i }).length).toBeGreaterThan(0);
  });

  it('opens the consent dialog from the upsell "Attiva" affordance', () => {
    const onOpenConsent = vi.fn();
    render(
      <DeliberationColumn
        {...baseProps()}
        turns={[turnWithContributions()]}
        canContribute={false}
        onPreferCanon={vi.fn()}
        onOpenConsent={onOpenConsent}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: /^attiva$/i })[0]);
    expect(onOpenConsent).toHaveBeenCalledTimes(1);
  });

  it('does NOT render a steer control for an errored canon (nothing to weigh)', () => {
    render(
      <DeliberationColumn
        {...baseProps()}
        turns={[turnWithContributions()]}
        canContribute
        onPreferCanon={vi.fn()}
      />,
    );
    // Precedente errored → "non ha argomentato", and carries no steer button:
    // only the two arguing canons expose the affordance.
    expect(screen.getByText(/non ha argomentato/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /pesa di più questo canone/i })).toHaveLength(2);
  });

  it('renders no steer control when onPreferCanon is not wired (P2a-only pages)', () => {
    render(
      <DeliberationColumn {...baseProps()} turns={[turnWithContributions()]} canContribute />,
    );
    // The per-canon theses still render, but with no preference channel there is
    // neither a steer button nor an upsell.
    expect(screen.getByText(/le tesi dei canoni/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pesa di più questo canone/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/serve il consenso completo/i)).not.toBeInTheDocument();
  });
});
