import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GraphTruncationChip } from '../GraphTruncationChip';
import type { SubgraphResponse } from '../../shared/types';

const onLoadMore = vi.fn();

beforeEach(() => {
  onLoadMore.mockReset();
});

function subgraph(overrides: Partial<SubgraphResponse> = {}, centerDegree?: number): SubgraphResponse {
  return {
    nodes: [
      {
        id: 'root',
        type: 'Norma',
        label: 'Art. 1453',
        urn: 'urn:x~art1453',
        metadata: centerDegree !== undefined ? { degree: centerDegree } : {},
      },
      { id: 'n1', type: 'ConcettoGiuridico', label: 'Risoluzione' },
    ],
    edges: [
      { id: 'e1', source: 'root', target: 'n1', type: 'DISCIPLINA' },
      { id: 'e2', source: 'n1', target: 'root', type: 'RIFERIMENTO' },
      { id: 'e3', source: 'root', target: 'n1', type: 'COMMENTA' },
    ],
    metadata: { truncated: true },
    ...overrides,
  };
}

describe('GraphTruncationChip', () => {
  it('renders nothing when the subgraph is not truncated', () => {
    const { container } = render(
      <GraphTruncationChip
        data={subgraph({ metadata: { truncated: false } })}
        centerNodeId="root"
        limit={150}
        onLoadMore={onLoadMore}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing without data (loading/idle states)', () => {
    const { container } = render(
      <GraphTruncationChip data={undefined} centerNodeId={null} limit={150} onLoadMore={onLoadMore} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('reads the Wave-1 metadata: "Mostro N di M relazioni" with M = center degree', () => {
    render(
      <GraphTruncationChip
        data={subgraph({}, 42)}
        centerNodeId="root"
        limit={150}
        onLoadMore={onLoadMore}
      />
    );
    expect(screen.getByText('Mostro 3 di 42 relazioni')).toBeInTheDocument();
  });

  it('falls back to "molte" when the center degree is missing', () => {
    render(
      <GraphTruncationChip data={subgraph()} centerNodeId="root" limit={150} onLoadMore={onLoadMore} />
    );
    expect(screen.getByText('Mostro 3 di molte relazioni')).toBeInTheDocument();
  });

  it('falls back to "molte" when the center degree does not exceed the shown count (deep-hop cut)', () => {
    // degree 2 < 3 shown edges → the LIMIT cut hop-2+ rows, degree understates.
    render(
      <GraphTruncationChip
        data={subgraph({}, 2)}
        centerNodeId="root"
        limit={150}
        onLoadMore={onLoadMore}
      />
    );
    expect(screen.getByText('Mostro 3 di molte relazioni')).toBeInTheDocument();
  });

  it('"Carica di più" bumps to the next ladder step (150 → 200)', () => {
    render(
      <GraphTruncationChip data={subgraph({}, 42)} centerNodeId="root" limit={150} onLoadMore={onLoadMore} />
    );
    fireEvent.click(screen.getByRole('button', { name: /carica più relazioni/i }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(onLoadMore).toHaveBeenCalledWith(200);
  });

  it('walks the ladder from the bottom (25 → 50)', () => {
    render(
      <GraphTruncationChip data={subgraph()} centerNodeId="root" limit={25} onLoadMore={onLoadMore} />
    );
    fireEvent.click(screen.getByRole('button', { name: /carica più relazioni/i }));
    expect(onLoadMore).toHaveBeenCalledWith(50);
  });

  it('hides the CTA when the ladder is exhausted (limit ≥ 200) but keeps the honest count', () => {
    render(
      <GraphTruncationChip data={subgraph()} centerNodeId="root" limit={200} onLoadMore={onLoadMore} />
    );
    expect(screen.getByText('Mostro 3 di molte relazioni')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /carica più relazioni/i })).toBeNull();
  });

  it('disables the CTA while a bigger fetch is in flight', () => {
    render(
      <GraphTruncationChip data={subgraph()} centerNodeId="root" limit={150} loading onLoadMore={onLoadMore} />
    );
    expect(screen.getByRole('button', { name: /carica più relazioni/i })).toBeDisabled();
  });
});
