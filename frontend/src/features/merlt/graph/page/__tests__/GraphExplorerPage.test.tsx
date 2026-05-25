import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

const triggerIngestionMock = vi.fn();
const useIngestionJobMock = vi.fn();
vi.mock('../../shared/graphApi', () => ({
  triggerIngestion: (...a: unknown[]) => triggerIngestionMock(...a),
}));
vi.mock('../../shared/useIngestionJob', () => ({
  useIngestionJob: (...a: unknown[]) => useIngestionJobMock(...a),
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
      elements: { nodes: [{ data: { id: 'a' } }], edges: [] },
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
      elements: { nodes: [{ data: { id: 'a' } }], edges: [] },
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
    renderAt('/grafo?urn=urn%3Anew');

    await waitFor(() => expect(triggerIngestionMock).toHaveBeenCalledWith('urn:new'));
    expect(screen.getByText(/indicizzazione in corso/i)).toBeInTheDocument();
  });

  it('shows "non indicizzabile" with retry when ingestion finished but graph is still empty', () => {
    useIngestionJobMock.mockReturnValue({ status: 'completed', error: null, nodesCreated: 0 });
    setGraph({ status: 'success', data: { nodes: [], edges: [] }, elements: { nodes: [], edges: [] } });
    renderAt('/grafo?urn=urn%3Anew');
    expect(screen.getByText(/non indicizzabile/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /riprova/i })).toBeInTheDocument();
  });

  it('seeds the breadcrumb on a direct deeplink (no prior interaction)', () => {
    setGraph({
      status: 'success',
      data: { nodes: [{ id: 'a', type: 'Norma', label: 'A', urn: 'urn:test' }], edges: [] },
      elements: { nodes: [{ data: { id: 'a' } }], edges: [] },
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
    renderAt('/grafo?urn=urn%3Anew');

    triggerIngestionMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /riprova/i }));
    expect(refetch).toHaveBeenCalled();
    expect(triggerIngestionMock).not.toHaveBeenCalled();
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
