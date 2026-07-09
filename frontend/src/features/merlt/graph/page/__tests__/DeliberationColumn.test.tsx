import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeliberationColumn } from '../DeliberationColumn';
import type { ExpertContribution, QaHistoryItem, QaTurnModel } from '../../../qa/types';
import type { GraphEdge, GraphEdgeSelection, GraphNode } from '../../shared/types';

/** A turn carrying a divergent disagreement + reasoning-trace shapes (Wave C). */
function turnWithDissentAndTrace(): QaTurnModel {
  return {
    id: 'turn-dissent',
    question: 'Qual è la ratio dell’art. 2043?',
    confirmed: {},
    state: {
      status: 'success',
      answer: {
        trace_id: 'trace-dissent',
        synthesis: 'Il collegio non converge su un’unica lettura.',
        mode: 'divergent',
        alternatives: null,
        sources: [],
        retrieved_sources: [],
        experts_used: ['literal', 'principles'],
        confidence: 0.55,
        execution_time_ms: 4200,
        disagreement_analysis: {
          has_disagreement: true,
          disagreement_type: 'interpretativo',
          disagreement_level: 'alto',
          intensity: 0.72,
          resolvability: 0.3,
          confidence: 0.6,
          conflicts: [],
        },
        disagreement_explanation: 'Il canone letterale e quello sistematico divergono sul criterio ex art. 12 preleggi.',
        pipeline_trace: {
          stage_times_ms: { ner: 12, routing: 5, synthesis: 340 },
          ner_result: { entities: [{ text: 'art. 2043', type: 'RIFERIMENTO' }] },
          routing: { method: 'hybrid' },
          experts_skipped: [{ expert: 'precedent', reason: 'timeout' }],
          react_steps: [],
        },
        pipeline_metrics: { total_tokens: 1234 },
      },
    },
  };
}

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
    // The page owns the context basket and reads it at ask time — onAsk carries
    // only (question, mode).
    expect(props.onAsk).toHaveBeenCalledWith('nuova domanda', 'convergent');
  });
});

describe('DeliberationColumn source ↔ graph link (audit item 3)', () => {
  it('hovering a source chip pulses the graph WITHOUT re-centering or switching tabs', () => {
    const props = { ...baseProps(), onSourceHover: vi.fn() };
    render(<DeliberationColumn {...props} turns={[successTurn()]} />);
    const chip = screen.getByRole('button', { name: /art\. 2043.*fondativa/i }).closest('li')!;
    fireEvent.mouseEnter(chip);
    expect(props.onSourceHover).toHaveBeenCalledWith('node-2043');
    expect(props.onSourceCenter).not.toHaveBeenCalled();
    expect(props.onTabChange).not.toHaveBeenCalled();
  });

  it('leaving a source chip clears the hover pulse (null)', () => {
    const props = { ...baseProps(), onSourceHover: vi.fn() };
    render(<DeliberationColumn {...props} turns={[successTurn()]} />);
    const chip = screen.getByRole('button', { name: /art\. 2059.*provvisoria/i }).closest('li')!;
    fireEvent.mouseEnter(chip);
    fireEvent.mouseLeave(chip);
    expect(props.onSourceHover).toHaveBeenLastCalledWith(null);
  });

  it('is inert (no crash) when onSourceHover is not wired', () => {
    render(<DeliberationColumn {...baseProps()} turns={[successTurn()]} />);
    const chip = screen.getByRole('button', { name: /art\. 2043.*fondativa/i }).closest('li')!;
    expect(() => fireEvent.mouseEnter(chip)).not.toThrow();
  });

  it('marks the source chip matching the CURRENT canvas selection (aria-current)', () => {
    render(<DeliberationColumn {...baseProps()} turns={[successTurn()]} selectedNode={node} />);
    const selectedChip = screen.getByRole('button', { name: /art\. 2043.*fondativa/i }).closest('li')!;
    const otherChip = screen.getByRole('button', { name: /art\. 2059.*provvisoria/i }).closest('li')!;
    expect(selectedChip).toHaveAttribute('aria-current', 'true');
    expect(otherChip).not.toHaveAttribute('aria-current');
  });

  it('is resilient (no chip marked) when the selection does not match any consulted source', () => {
    const unrelated: GraphNode = { id: 'node-9999', urn: 'urn:unrelated', type: 'Norma', label: 'Unrelated' };
    render(<DeliberationColumn {...baseProps()} turns={[successTurn()]} selectedNode={unrelated} />);
    for (const el of screen.getAllByRole('listitem')) {
      expect(el).not.toHaveAttribute('aria-current');
    }
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

describe('DeliberationColumn wave-1 interactions (P1)', () => {
  it('keeps BOTH tabs mounted and toggles via CSS (no drawer flash on switch)', () => {
    render(
      <DeliberationColumn
        {...baseProps()}
        activeTab="dibattito"
        selectedNode={node}
        nodesById={new Map([[node.id, node]])}
        edges={[]}
      />,
    );
    // The node drawer content is MOUNTED although the Dibattito tab is active…
    expect(screen.getByText('Risarcimento per fatto illecito')).toBeInTheDocument();
    // …but its tabpanel carries the display-hidden class.
    expect(screen.getByRole('tabpanel', { name: 'Nodo' }).className).toContain('hidden');
    expect(screen.getByRole('tabpanel', { name: 'Dibattito' }).className).not.toContain('hidden');
  });

  it('pulses the Dibattito tab when dibattitoBadge is set (turn settled on Nodo)', () => {
    render(<DeliberationColumn {...baseProps()} activeTab="nodo" dibattitoBadge />);
    expect(screen.getByText('nuova risposta')).toBeInTheDocument();
  });

  it('renders no pulse without the badge', () => {
    render(<DeliberationColumn {...baseProps()} activeTab="nodo" />);
    expect(screen.queryByText('nuova risposta')).not.toBeInTheDocument();
  });

  it('renders the scope chip and fires onReturn from "Torna" (defect #10)', () => {
    const onReturn = vi.fn();
    render(
      <DeliberationColumn {...baseProps()} scopeChip={{ label: 'Art. 2043 c.c.', onReturn }} />,
    );
    expect(screen.getByText(/dibattito attivo su art\. 2043/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /torna/i }));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('expands ONLY the focused canon thesis on canonFocus (defect #5)', () => {
    render(
      <DeliberationColumn
        {...baseProps()}
        turns={[turnWithContributions()]}
        canonFocus={{ key: 'principles', nonce: 1 }}
      />,
    );
    const focused = document.querySelector('details[data-canon="principles"]') as HTMLDetailsElement;
    const other = document.querySelector('details[data-canon="literal"]') as HTMLDetailsElement;
    expect(focused).toBeTruthy();
    expect(focused.open).toBe(true);
    expect(other.open).toBe(false);
  });

  it('disables the composer submission while a deliberation is in flight (askBusy)', () => {
    const props = baseProps();
    render(<DeliberationColumn {...props} askBusy />);
    const input = screen.getByRole('textbox', { name: /chiedi al grafo/i });
    fireEvent.change(input, { target: { value: 'domanda' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onAsk).not.toHaveBeenCalled();
  });
});

describe('DeliberationColumn relation steer (Slice 4 L3 — privilegia questa relazione)', () => {
  const relationEdge: GraphEdge = {
    id: 'e1',
    source: 'node-2043',
    target: 'node-2059',
    type: 'DISCIPLINA',
    properties: {},
  };
  const relationSelection: GraphEdgeSelection = { kind: 'relation', edge: relationEdge };

  it('renders the steer on a selected relation with a trace + full consent, firing with the edge relation type', () => {
    const onPreferRelation = vi.fn();
    render(
      <DeliberationColumn
        {...baseProps()}
        activeTab="nodo"
        selectedEdge={relationSelection}
        canContribute
        onPreferRelation={onPreferRelation}
      />,
    );
    const steer = screen.getByRole('button', { name: /privilegia questa relazione/i });
    fireEvent.click(steer);
    expect(onPreferRelation).toHaveBeenCalledTimes(1);
    expect(onPreferRelation).toHaveBeenCalledWith('DISCIPLINA');
    // Optimistic confirmation quoting the relation type; the button is replaced.
    expect(screen.getByText(/terrò conto: privilegerò «DISCIPLINA»/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /privilegia questa relazione/i })).not.toBeInTheDocument();
  });

  it('hides the control entirely when there is no deliberation trace (onPreferRelation absent)', () => {
    render(
      <DeliberationColumn {...baseProps()} activeTab="nodo" selectedEdge={relationSelection} canContribute />,
    );
    // The edge details still render — only the steer (and its upsell) are hidden.
    expect(screen.getByRole('heading', { name: 'Relazione' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /privilegia questa relazione/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/serve il consenso completo/i)).not.toBeInTheDocument();
  });

  it('renders the compact upsell (not a dead button) when the user lacks full consent', () => {
    const onOpenConsent = vi.fn();
    render(
      <DeliberationColumn
        {...baseProps()}
        activeTab="nodo"
        selectedEdge={relationSelection}
        canContribute={false}
        onPreferRelation={vi.fn()}
        onOpenConsent={onOpenConsent}
      />,
    );
    expect(screen.queryByRole('button', { name: /privilegia questa relazione/i })).not.toBeInTheDocument();
    expect(screen.getByText(/serve il consenso completo/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^attiva$/i }));
    expect(onOpenConsent).toHaveBeenCalledTimes(1);
  });

  it('does NOT render the steer on a contrast arc (synthetic, not a traversable relation)', () => {
    const contrast: GraphEdgeSelection = {
      kind: 'contrast',
      conflict: { expert_a: 'literal', expert_b: 'principles', conflict_score: 0.5 },
      expertALabel: 'Letterale',
      expertBLabel: 'Principî',
      isDevilsAdvocate: false,
    };
    render(
      <DeliberationColumn
        {...baseProps()}
        activeTab="nodo"
        selectedEdge={contrast}
        canContribute
        onPreferRelation={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: /contrasto tra canoni/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /privilegia questa relazione/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Wave 2 — mobile bottom-sheet presentation (review "mobile dead-end")
// ---------------------------------------------------------------------------

/** jsdom defaults to 1024px; force a width and notify the resize subscribers. */
function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

describe('DeliberationColumn mobile bottom-sheet (Wave 2)', () => {
  beforeEach(() => setViewportWidth(375));
  afterEach(() => setViewportWidth(1024));

  it('below md renders the "Dibattito" trigger pill (portal) instead of the docked column', () => {
    render(<DeliberationColumn {...baseProps()} />);
    expect(screen.getByRole('button', { name: /dibattito/i })).toBeInTheDocument();
    // The docked tablist is NOT rendered while the sheet is closed.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('the pill carries the Wave-1 pulse badge when dibattitoBadge is set', () => {
    render(<DeliberationColumn {...baseProps()} dibattitoBadge />);
    expect(screen.getByText('nuova risposta')).toBeInTheDocument();
  });

  it('opening the pill shows the sheet with the full column content; scrim tap dismisses', () => {
    render(<DeliberationColumn {...baseProps()} turns={[successTurn()]} />);
    fireEvent.click(screen.getByRole('button', { name: /dibattito/i }));
    // Sheet dialog with both tabs + the turn content.
    expect(screen.getByRole('dialog', { name: /dibattito sul grafo/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /dibattito/i })).toBeInTheDocument();
    expect(screen.getByText(/neminem laedere/i)).toBeInTheDocument();
    // Scrim tap closes the sheet and brings the pill back.
    fireEvent.click(screen.getByRole('button', { name: /chiudi dibattito/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dibattito/i })).toBeInTheDocument();
  });

  it('desktop width keeps the docked column (no pill, no dialog)', () => {
    setViewportWidth(1024);
    render(<DeliberationColumn {...baseProps()} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Wave 2 — history-turn hydration note (review P2.6)
// ---------------------------------------------------------------------------

describe('DeliberationColumn history-detail note (Wave 2 P2.6)', () => {
  it('shows the "dettagli non più disponibili" note on an unavailable history turn', () => {
    const turn = { ...successTurn(), historyDetail: 'unavailable' as const };
    render(<DeliberationColumn {...baseProps()} turns={[turn]} />);
    expect(screen.getByText(/dettagli non più disponibili/i)).toBeInTheDocument();
  });

  it('shows a subtle loading row while the trace hydration is in flight', () => {
    const turn = { ...successTurn(), historyDetail: 'loading' as const };
    render(<DeliberationColumn {...baseProps()} turns={[turn]} />);
    expect(screen.getByText(/recupero i dettagli/i)).toBeInTheDocument();
  });

  it('renders neither note on a live turn (no historyDetail)', () => {
    render(<DeliberationColumn {...baseProps()} turns={[successTurn()]} />);
    expect(screen.queryByText(/dettagli non più disponibili/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/recupero i dettagli/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Wave 2 — steer idempotency: lifted column-level state (review P2.7)
// ---------------------------------------------------------------------------

describe('DeliberationColumn lifted steer state (Wave 2 P2.7)', () => {
  it('canon steer confirmation survives a tab switch (rerender with activeTab nodo → dibattito)', () => {
    const props = { ...baseProps(), turns: [turnWithContributions()], canContribute: true, onPreferCanon: vi.fn() };
    const { rerender } = render(<DeliberationColumn {...props} />);
    fireEvent.click(screen.getAllByRole('button', { name: /pesa di più questo canone/i })[0]);
    expect(screen.getByText(/terrò conto della tua preferenza/i)).toBeInTheDocument();

    rerender(<DeliberationColumn {...props} activeTab="nodo" />);
    rerender(<DeliberationColumn {...props} activeTab="dibattito" />);
    // Still steered: the button did not re-arm.
    expect(screen.getByText(/terrò conto della tua preferenza/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /pesa di più questo canone/i })).toHaveLength(1);
  });

  it('canon steer confirmation survives the Cronologia toggle (which unmounts the turn list)', async () => {
    fetchHistoryMock.mockResolvedValue([historyItem()]);
    render(
      <DeliberationColumn
        {...baseProps()}
        turns={[turnWithContributions()]}
        canContribute
        onPreferCanon={vi.fn()}
        onLoadHistoryTurn={vi.fn()}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: /pesa di più questo canone/i })[0]);
    expect(screen.getByText(/terrò conto della tua preferenza/i)).toBeInTheDocument();

    // Open the server history (replaces the turn list → unmounts the steer)…
    fireEvent.click(screen.getByRole('button', { name: /^cronologia$/i }));
    await screen.findByText(/domanda passata/i);
    // …and close it again.
    fireEvent.click(screen.getByRole('button', { name: /chiudi cronologia/i }));

    // The steer did NOT re-arm: state lives on the column, not the button.
    expect(screen.getByText(/terrò conto della tua preferenza/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /pesa di più questo canone/i })).toHaveLength(1);
  });

  it('relation steer confirmation survives deselecting and re-selecting the same edge', () => {
    const edge: GraphEdge = {
      id: 'e1',
      source: 'node-2043',
      target: 'node-2059',
      type: 'DISCIPLINA',
      properties: {},
    };
    const selection: GraphEdgeSelection = { kind: 'relation', edge };
    const props = {
      ...baseProps(),
      activeTab: 'nodo' as const,
      canContribute: true,
      onPreferRelation: vi.fn(),
    };
    const { rerender } = render(<DeliberationColumn {...props} selectedEdge={selection} />);
    fireEvent.click(screen.getByRole('button', { name: /privilegia questa relazione/i }));
    expect(screen.getByText(/terrò conto: privilegerò «DISCIPLINA»/i)).toBeInTheDocument();

    // Deselect, then re-select the SAME edge: previously the per-edge remount
    // re-armed the button; the lifted (traceId, relationType) key keeps it.
    rerender(<DeliberationColumn {...props} selectedEdge={null} />);
    rerender(<DeliberationColumn {...props} selectedEdge={selection} />);
    expect(screen.getByText(/terrò conto: privilegerò «DISCIPLINA»/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /privilegia questa relazione/i })).not.toBeInTheDocument();
  });

  it('a NEW deliberation (different trace) re-arms the canon steer', () => {
    const first = turnWithContributions();
    const props = { ...baseProps(), canContribute: true, onPreferCanon: vi.fn() };
    const { rerender } = render(<DeliberationColumn {...props} turns={[first]} />);
    fireEvent.click(screen.getAllByRole('button', { name: /pesa di più questo canone/i })[0]);
    expect(screen.getAllByRole('button', { name: /pesa di più questo canone/i })).toHaveLength(1);

    // A second turn with a different trace_id: its canons are steerable afresh.
    const second = turnWithContributions();
    second.id = 'turn-canon-2';
    if (second.state.status === 'success') second.state.answer.trace_id = 'trace-canon-2';
    rerender(<DeliberationColumn {...props} turns={[first, second]} />);
    // 1 remaining on the first turn + 2 fresh on the second.
    expect(screen.getAllByRole('button', { name: /pesa di più questo canone/i })).toHaveLength(3);
  });
});

describe('DeliberationColumn collapse (Wave 2 UX — collapsible desktop column)', () => {
  it('shows the collapse button in the tab header when onToggleCollapse is provided', () => {
    render(<DeliberationColumn {...baseProps()} onToggleCollapse={vi.fn()} />);
    expect(screen.getByRole('button', { name: /comprimi il pannello/i })).toBeInTheDocument();
  });

  it('omits the collapse button when onToggleCollapse is absent (not collapsible)', () => {
    render(<DeliberationColumn {...baseProps()} />);
    expect(screen.queryByRole('button', { name: /comprimi il pannello/i })).not.toBeInTheDocument();
  });

  it('clicking the collapse button calls onToggleCollapse', () => {
    const onToggleCollapse = vi.fn();
    render(<DeliberationColumn {...baseProps()} onToggleCollapse={onToggleCollapse} />);
    fireEvent.click(screen.getByRole('button', { name: /comprimi il pannello/i }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it('when collapsed, renders the expand rail instead of the tabs and composer', () => {
    render(<DeliberationColumn {...baseProps()} collapsed onToggleCollapse={vi.fn()} />);
    // The rail is the only affordance: an "Espandi" button — no tablist, no
    // in-column composer (that role belongs to the header field while collapsed).
    expect(screen.getByRole('button', { name: /espandi il pannello/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /dibattito/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /chiedi al grafo/i })).not.toBeInTheDocument();
  });

  it('clicking the expand rail calls onToggleCollapse', () => {
    const onToggleCollapse = vi.fn();
    render(<DeliberationColumn {...baseProps()} collapsed onToggleCollapse={onToggleCollapse} />);
    fireEvent.click(screen.getByRole('button', { name: /espandi il pannello/i }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Wave C — surfacing deliberation signals already computed but never shown
// ---------------------------------------------------------------------------

describe('DeliberationColumn inline feedback (Wave C gap C1 — rate/detailed)', () => {
  it('calls onRate with (turnId, traceId, rating) when 👍/👎 is clicked, gated on qaAskable', () => {
    const onRate = vi.fn();
    render(
      <DeliberationColumn {...baseProps()} turns={[successTurn()]} qaAskable onRate={onRate} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /risposta utile/i }));
    expect(onRate).toHaveBeenCalledWith('turn-1', 'trace-1', 5);
    fireEvent.click(screen.getByRole('button', { name: /risposta non utile/i }));
    expect(onRate).toHaveBeenCalledWith('turn-1', 'trace-1', 1);
  });

  it('reflects turn.rating optimistically on the pressed button', () => {
    const turn = { ...successTurn(), rating: 5 as const };
    render(<DeliberationColumn {...baseProps()} turns={[turn]} qaAskable onRate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /risposta utile/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /risposta non utile/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('hides the rate control when onRate is absent', () => {
    render(<DeliberationColumn {...baseProps()} turns={[successTurn()]} qaAskable />);
    expect(screen.queryByRole('button', { name: /risposta utile/i })).not.toBeInTheDocument();
  });

  it('hides the rate control when asking is not unlocked (qaAskable false)', () => {
    render(<DeliberationColumn {...baseProps()} turns={[successTurn()]} qaAskable={false} onRate={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /risposta utile/i })).not.toBeInTheDocument();
  });

  it('submits the detailed 3-dimension assessment via onDetailed(traceId, scores)', () => {
    const onDetailed = vi.fn();
    render(
      <DeliberationColumn {...baseProps()} turns={[successTurn()]} qaAskable onDetailed={onDetailed} />,
    );
    fireEvent.click(screen.getByText(/valutazione dettagliata/i));
    // Three dimensions, each with 3 grade buttons — grade all "adeguato" (0.6).
    fireEvent.click(screen.getAllByRole('button', { name: /^adeguato$/i })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: /^adeguato$/i })[1]);
    fireEvent.click(screen.getAllByRole('button', { name: /^adeguato$/i })[2]);
    fireEvent.click(screen.getByRole('button', { name: /invia valutazione/i }));
    expect(onDetailed).toHaveBeenCalledWith('trace-1', {
      retrievalScore: 0.6,
      reasoningScore: 0.6,
      synthesisScore: 0.6,
    });
    expect(screen.getByText(/grazie, valutazione registrata/i)).toBeInTheDocument();
  });

  it('disables the "Invia valutazione" button until all three dimensions are graded', () => {
    render(<DeliberationColumn {...baseProps()} turns={[successTurn()]} qaAskable onDetailed={vi.fn()} />);
    fireEvent.click(screen.getByText(/valutazione dettagliata/i));
    expect(screen.getByRole('button', { name: /invia valutazione/i })).toBeDisabled();
  });

  it('hides the entire feedback row when neither onRate nor onDetailed is wired', () => {
    render(<DeliberationColumn {...baseProps()} turns={[successTurn()]} qaAskable />);
    expect(screen.queryByRole('button', { name: /risposta utile/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/valutazione dettagliata/i)).not.toBeInTheDocument();
  });
});

describe('DeliberationColumn confirm-source (Wave C gap C1 — ricorda nel grafo)', () => {
  it('shows "Ricorda nel grafo" only for live_unconfirmed sources with a node_id', () => {
    render(
      <DeliberationColumn {...baseProps()} turns={[successTurn()]} onConfirmSource={vi.fn()} />,
    );
    // successTurn() has one `seed` source (node-2043, no confirm) and one
    // `live_unconfirmed` source with node_id null (also no confirm — no node_id).
    expect(screen.queryByRole('button', { name: /ricorda nel grafo/i })).not.toBeInTheDocument();
  });

  it('calls onConfirmSource(turnId, source) for a live_unconfirmed source WITH a node_id', () => {
    const onConfirmSource = vi.fn();
    const turn = successTurn();
    if (turn.state.status === 'success') {
      turn.state.answer.retrieved_sources = [
        { urn: 'live:abc123', provenance: 'live_unconfirmed', trust: 0.4, node_id: 'live-node-1' },
      ];
    }
    render(<DeliberationColumn {...baseProps()} turns={[turn]} onConfirmSource={onConfirmSource} />);
    const btn = screen.getByRole('button', { name: /ricorda nel grafo/i });
    fireEvent.click(btn);
    expect(onConfirmSource).toHaveBeenCalledTimes(1);
    expect(onConfirmSource).toHaveBeenCalledWith(
      turn.id,
      expect.objectContaining({ node_id: 'live-node-1' }),
    );
  });

  it('reflects confirmState on the confirm button (pending/done)', () => {
    const turn = successTurn();
    if (turn.state.status === 'success') {
      turn.state.answer.retrieved_sources = [
        { urn: 'live:abc123', provenance: 'live_unconfirmed', trust: 0.4, node_id: 'live-node-1' },
      ];
    }
    turn.confirmed = { 'live-node-1': 'done' };
    render(<DeliberationColumn {...baseProps()} turns={[turn]} onConfirmSource={vi.fn()} />);
    expect(screen.getByText(/ricordata/i)).toBeInTheDocument();
  });

  it('does not show the confirm-source action when onConfirmSource is absent', () => {
    const turn = successTurn();
    if (turn.state.status === 'success') {
      turn.state.answer.retrieved_sources = [
        { urn: 'live:abc123', provenance: 'live_unconfirmed', trust: 0.4, node_id: 'live-node-1' },
      ];
    }
    render(<DeliberationColumn {...baseProps()} turns={[turn]} />);
    expect(screen.queryByRole('button', { name: /ricorda nel grafo/i })).not.toBeInTheDocument();
  });

  it('calls onRateSource(traceId, urn, relevant) from the per-source rating buttons', () => {
    const onRateSource = vi.fn();
    render(<DeliberationColumn {...baseProps()} turns={[successTurn()]} onRateSource={onRateSource} />);
    fireEvent.click(screen.getAllByRole('button', { name: /segna .* come pertinente/i })[0]);
    expect(onRateSource).toHaveBeenCalledWith('trace-1', 'urn:x~art2043', true);
  });
});

describe('DeliberationColumn reasoning-trace disclosure (Wave C gap C2 — come ha ragionato)', () => {
  it('is closed by default', () => {
    render(<DeliberationColumn {...baseProps()} turns={[turnWithDissentAndTrace()]} />);
    const details = screen.getByText(/come ha ragionato/i).closest('details');
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
  });

  it('shows routing method, stage timings, NER entities, skipped experts and total tokens', () => {
    render(<DeliberationColumn {...baseProps()} turns={[turnWithDissentAndTrace()]} />);
    fireEvent.click(screen.getByText(/come ha ragionato/i));
    expect(screen.getByText(/hybrid/i)).toBeInTheDocument();
    expect(screen.getAllByText(/art\. 2043/).length).toBeGreaterThan(0);
    expect(screen.getByText('1234')).toBeInTheDocument();
    expect(screen.getByText('Precedente')).toBeInTheDocument();
    expect(screen.getByText('timeout')).toBeInTheDocument();
  });

  it('shows the degraded-engine note when react_steps is empty', () => {
    render(<DeliberationColumn {...baseProps()} turns={[turnWithDissentAndTrace()]} />);
    fireEvent.click(screen.getByText(/come ha ragionato/i));
    expect(screen.getByText(/ragionamento a passo singolo \(react non attivo\)/i)).toBeInTheDocument();
  });

  it('renders REAL per-canon ReAct iterations and never the "non attivo" note when they are populated (bug fix: react_steps lives under expert_executions, not at the trace top level)', () => {
    const turn = turnWithDissentAndTrace();
    if (turn.state.status !== 'success') throw new Error('fixture must be success');
    turn.state.answer.reactSteps = [
      { expert: 'literal', iteration: 0, thought: 'Verifico il tenore letterale dell’art. 2043.', action: 'definitions_lookup', success: true, resultsFound: 3 },
      { expert: 'literal', iteration: 1, thought: 'Confronto con la massima citata.', action: 'case_law_search', success: false, resultsFound: null },
      { expert: 'systemic', iteration: 0, thought: 'Esploro il grafo per relazioni sistematiche.', action: 'graph_search', success: true, resultsFound: 5 },
    ];
    render(<DeliberationColumn {...baseProps()} turns={[turn]} />);
    fireEvent.click(screen.getByText(/come ha ragionato/i));

    // Per-canon grouping with an "N iterazioni" count.
    expect(screen.getByText(/2 iterazioni/i)).toBeInTheDocument();
    expect(screen.getByText(/1 iterazione\b/i)).toBeInTheDocument();
    // Each iteration's action tool + thought text is visible.
    expect(screen.getByText('definitions_lookup')).toBeInTheDocument();
    expect(screen.getByText('case_law_search')).toBeInTheDocument();
    expect(screen.getByText('graph_search')).toBeInTheDocument();
    expect(screen.getByText(/tenore letterale dell.art\. 2043/i)).toBeInTheDocument();
    // The false "ReAct non attivo" note must be ABSENT — this is the bug's regression guard.
    expect(screen.queryByText(/ragionamento a passo singolo/i)).not.toBeInTheDocument();
  });

  it('renders no disclosure when the answer carries neither pipeline_trace nor pipeline_metrics', () => {
    render(<DeliberationColumn {...baseProps()} turns={[successTurn()]} />);
    expect(screen.queryByText(/come ha ragionato/i)).not.toBeInTheDocument();
  });
});

describe('DeliberationColumn "Segui il ragionamento sul grafo" (MARQUEE — moved to the main canvas)', () => {
  function turnWithWalk(): QaTurnModel {
    return {
      id: 'turn-walk',
      question: 'Qual è la ratio dell’art. 2043?',
      confirmed: {},
      state: {
        status: 'success',
        answer: {
          trace_id: 'trace-walk',
          synthesis: 'La ratio è il neminem laedere.',
          mode: 'convergent',
          alternatives: null,
          sources: [],
          retrieved_sources: [],
          experts_used: ['systemic'],
          confidence: 0.8,
          execution_time_ms: 100,
          graphTraversal: [
            { iteration: 0, source_urn: 'urn:x~art2043', relation_type: 'IMPONE', target_urn: 'modalita:x', target_type: 'ModalitaGiuridica' },
          ],
        },
      },
    };
  }

  it('is disabled with an explanatory tooltip when the turn carries no walk', () => {
    render(<DeliberationColumn {...baseProps()} turns={[successTurn()]} />);
    const btn = screen.getByRole('button', { name: /segui il ragionamento sul grafo/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Nessuna traversata sul grafo per questa risposta');
  });

  it('calls onFollowReasoning with the turn edges instead of rendering an inline player', () => {
    const onFollowReasoning = vi.fn();
    render(<DeliberationColumn {...baseProps()} turns={[turnWithWalk()]} onFollowReasoning={onFollowReasoning} />);
    const btn = screen.getByRole('button', { name: /segui il ragionamento sul grafo/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onFollowReasoning).toHaveBeenCalledWith([
      { iteration: 0, source_urn: 'urn:x~art2043', relation_type: 'IMPONE', target_urn: 'modalita:x', target_type: 'ModalitaGiuridica' },
    ]);
    // No inline player mounts in the column anymore — the replay lives on the
    // page's main canvas (GraphExplorerPage), not here.
    expect(screen.queryByLabelText(/chiudi il replay del ragionamento/i)).not.toBeInTheDocument();
  });

  it('is a harmless no-op when onFollowReasoning is not wired (default)', () => {
    render(<DeliberationColumn {...baseProps()} turns={[turnWithWalk()]} />);
    const btn = screen.getByRole('button', { name: /segui il ragionamento sul grafo/i });
    expect(() => fireEvent.click(btn)).not.toThrow();
  });
});

describe('DeliberationColumn dissent banner (Wave C gap C3 — il collegio ha dissentito)', () => {
  it('renders the banner with intensity/type/level/resolvability when has_disagreement is true', () => {
    render(<DeliberationColumn {...baseProps()} turns={[turnWithDissentAndTrace()]} />);
    expect(screen.getByText(/il collegio ha dissentito/i)).toBeInTheDocument();
    expect(screen.getByText(/intensità 0\.72/i)).toBeInTheDocument();
    expect(screen.getByText(/tipo interpretativo/i)).toBeInTheDocument();
    expect(screen.getByText(/livello alto/i)).toBeInTheDocument();
    expect(screen.getByText(/risolvibilità 0\.30/i)).toBeInTheDocument();
  });

  it('shows the NL explanation (art. 12 preleggi rationale) behind a disclosure', () => {
    render(<DeliberationColumn {...baseProps()} turns={[turnWithDissentAndTrace()]} />);
    fireEvent.click(screen.getByText(/perché il collegio dissente/i));
    expect(screen.getByText(/criterio ex art\. 12 preleggi/i)).toBeInTheDocument();
  });

  it('renders no banner when has_disagreement is false or the field is absent', () => {
    render(<DeliberationColumn {...baseProps()} turns={[successTurn()]} />);
    expect(screen.queryByText(/il collegio ha dissentito/i)).not.toBeInTheDocument();
  });

  it('caveats the numbers with "(stima)" when source is present and not model-trained', () => {
    const turn = turnWithDissentAndTrace();
    if (turn.state.status === 'success' && turn.state.answer.disagreement_analysis) {
      turn.state.answer.disagreement_analysis.source = 'heuristic';
    }
    render(<DeliberationColumn {...baseProps()} turns={[turn]} />);
    expect(screen.getByText(/intensità 0\.72 \(stima\)/i)).toBeInTheDocument();
  });

  it('does NOT caveat when source is model-trained', () => {
    const turn = turnWithDissentAndTrace();
    if (turn.state.status === 'success' && turn.state.answer.disagreement_analysis) {
      turn.state.answer.disagreement_analysis.source = 'model-trained';
    }
    render(<DeliberationColumn {...baseProps()} turns={[turn]} />);
    expect(screen.getByText(/intensità 0\.72$/i)).toBeInTheDocument();
  });

  it('does NOT caveat when source is absent (defensive default: treat as authoritative)', () => {
    render(<DeliberationColumn {...baseProps()} turns={[turnWithDissentAndTrace()]} />);
    expect(screen.getByText(/intensità 0\.72$/i)).toBeInTheDocument();
  });
});
