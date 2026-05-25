import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GraphExplorerPage } from '../GraphExplorerPage';
import type { ArticleGraphState } from '../../shared/useArticleGraph';

const useArticleGraphMock = vi.fn();
const isEnabledMock = vi.fn();

vi.mock('../../shared/useArticleGraph', () => ({
  useArticleGraph: (...a: unknown[]) => useArticleGraphMock(...a),
}));
vi.mock('../../shared/CytoscapeView', () => ({
  default: () => <div data-testid="cytoscape" />,
}));
vi.mock('../../featureFlag', () => ({
  isMerltGraphEnabled: () => isEnabledMock(),
}));

function setGraph(state: ArticleGraphState): void {
  useArticleGraphMock.mockReturnValue({ ...state, refetch: vi.fn() });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GraphExplorerPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useArticleGraphMock.mockReset();
  isEnabledMock.mockReset();
  isEnabledMock.mockReturnValue(true);
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

  it('renders the graph canvas on success', async () => {
    setGraph({
      status: 'success',
      data: { nodes: [{ id: 'a', type: 'Norma', label: 'A' }], edges: [] },
      elements: { nodes: [{ data: { id: 'a' } }], edges: [] },
    });
    renderAt('/grafo?urn=urn:test');
    expect(await screen.findByTestId('cytoscape')).toBeInTheDocument();
  });
});
