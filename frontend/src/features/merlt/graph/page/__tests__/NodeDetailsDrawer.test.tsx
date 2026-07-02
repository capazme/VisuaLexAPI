import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeDetailsDrawer } from '../NodeDetailsDrawer';
import type { GraphNode, GraphEdge } from '../../shared/types';

const NODE: GraphNode = {
  id: 'norma:2043',
  urn: 'urn:nir:stato:codice.civile:1942;2043',
  type: 'Norma',
  label: 'Art. 2043 c.c.',
  properties: { rubrica: 'Risarcimento per fatto illecito', fonte: 'Codice Civile' },
};

const NODES: GraphNode[] = [
  NODE,
  { id: 'concetto:colpa', type: 'ConcettoGiuridico', label: 'Colpa' },
  { id: 'principio:nl', type: 'PrincipioGiuridico', label: 'Neminem laedere' },
];
const NODES_BY_ID = new Map(NODES.map((n) => [n.id, n]));

const EDGES: GraphEdge[] = [
  { id: 'e1', source: 'norma:2043', target: 'concetto:colpa', type: 'APPLICA_A' },
  { id: 'e2', source: 'norma:2043', target: 'principio:nl', type: 'ESPRIME_PRINCIPIO' },
  { id: 'e3', source: 'concetto:colpa', target: 'norma:2043', type: 'interpreta' },
];

describe('NodeDetailsDrawer', () => {
  it('renders nothing when no node is selected', () => {
    const { container } = render(
      <NodeDetailsDrawer node={null} edges={[]} nodesById={NODES_BY_ID} onRecenter={vi.fn()} onClose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the node label, type, urn and properties', () => {
    render(
      <NodeDetailsDrawer node={NODE} edges={EDGES} nodesById={NODES_BY_ID} onRecenter={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText('Art. 2043 c.c.')).toBeInTheDocument();
    expect(screen.getByText('Norma')).toBeInTheDocument();
    expect(screen.getByText(NODE.urn!)).toBeInTheDocument();
    expect(screen.getByText(/Risarcimento per fatto illecito/)).toBeInTheDocument();
  });

  it('lists outgoing and incoming relations by connected node label', () => {
    render(
      <NodeDetailsDrawer node={NODE} edges={EDGES} nodesById={NODES_BY_ID} onRecenter={vi.fn()} onClose={vi.fn()} />
    );
    // Colpa is connected both ways (out APPLICA_A, in interpreta) → appears twice.
    expect(screen.getAllByText('Colpa').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Neminem laedere')).toBeInTheDocument();
    // relation type labels appear
    expect(screen.getByText(/APPLICA_A/)).toBeInTheDocument();
    expect(screen.getByText(/interpreta/)).toBeInTheDocument();
  });

  it('calls onRecenter when "Centra qui" is clicked', () => {
    const onRecenter = vi.fn();
    render(
      <NodeDetailsDrawer node={NODE} edges={EDGES} nodesById={NODES_BY_ID} onRecenter={onRecenter} onClose={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: /centra qui/i }));
    expect(onRecenter).toHaveBeenCalledWith(NODE);
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <NodeDetailsDrawer node={NODE} edges={EDGES} nodesById={NODES_BY_ID} onRecenter={vi.fn()} onClose={onClose} />
    );
    fireEvent.click(screen.getByRole('button', { name: /chiudi/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders `massima` as prominent body text, not in "Altre proprietà"', () => {
    const massimaNode: GraphNode = {
      id: 'sentenza:1',
      type: 'AttoGiudiziario',
      label: 'Cass. 12345/2020',
      properties: {
        massima: 'La responsabilità aquiliana presuppone un danno ingiusto.',
        organo_emittente: 'Cassazione',
      },
    };
    render(
      <NodeDetailsDrawer node={massimaNode} edges={[]} nodesById={new Map()} onRecenter={vi.fn()} onClose={vi.fn()} />
    );
    // The friendly "Massima" label appears (prominent Field), and the legacy
    // typo `massima_text` no longer buries it in the generic list.
    expect(screen.getByText('Massima')).toBeInTheDocument();
    expect(
      screen.getByText(/La responsabilità aquiliana presuppone un danno ingiusto\./)
    ).toBeInTheDocument();
    // "massima" must NOT surface under the raw "Altre proprietà" humanized key.
    expect(screen.queryByText('Massima text')).not.toBeInTheDocument();
  });

  it('shows a provenance chip for a live_unconfirmed node', () => {
    const liveNode: GraphNode = {
      id: 'live:1',
      type: 'AttoGiudiziario',
      label: 'Massima live',
      properties: { provenance: 'live_unconfirmed', trust: 0.6, massima: 'x' },
    };
    render(
      <NodeDetailsDrawer node={liveNode} edges={[]} nodesById={new Map()} onRecenter={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText('Non confermato')).toBeInTheDocument();
  });

  it('shows the community-validated provenance chip', () => {
    const validated: GraphNode = {
      id: 'v:1',
      type: 'ConcettoGiuridico',
      label: 'Colpa',
      properties: { community_validated: true },
    };
    render(
      <NodeDetailsDrawer node={validated} edges={[]} nodesById={new Map()} onRecenter={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText('Validato dalla comunità')).toBeInTheDocument();
  });
});
