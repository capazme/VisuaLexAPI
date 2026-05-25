import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ArticleGraphSideRail } from '../ArticleGraphSideRail';
import type { ArticleGraphState } from '../../shared/useArticleGraph';
import type { IngestionJobState } from '../../shared/useIngestionJob';

// ---- mocks ----
const useArticleGraphMock = vi.fn();
const useIngestionJobMock = vi.fn();
const triggerIngestionMock = vi.fn();
const navigateMock = vi.fn();
const refetchMock = vi.fn();

vi.mock('../../shared/useArticleGraph', () => ({
  useArticleGraph: (...a: unknown[]) => useArticleGraphMock(...a),
}));
vi.mock('../../shared/useIngestionJob', () => ({
  useIngestionJob: (...a: unknown[]) => useIngestionJobMock(...a),
}));
vi.mock('../../shared/graphApi', () => ({
  triggerIngestion: (...a: unknown[]) => triggerIngestionMock(...a),
}));
vi.mock('../../shared/CytoscapeView', () => ({
  default: () => <div data-testid="cytoscape" />,
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

function setGraph(state: ArticleGraphState): void {
  useArticleGraphMock.mockReturnValue({ ...state, refetch: refetchMock });
}
function setJob(state: IngestionJobState): void {
  useIngestionJobMock.mockReturnValue(state);
}

const URN = 'urn:nir:stato:codice.civile:1942;2043';

beforeEach(() => {
  useArticleGraphMock.mockReset();
  useIngestionJobMock.mockReset();
  triggerIngestionMock.mockReset();
  navigateMock.mockReset();
  refetchMock.mockReset();
  setGraph({ status: 'idle' });
  setJob({ status: null, error: null, nodesCreated: null });
});

describe('ArticleGraphSideRail', () => {
  it('renders nothing when there is no articleUrn', () => {
    const { container } = render(<ArticleGraphSideRail articleUrn={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is collapsed by default, exposing an expand toggle', () => {
    render(<ArticleGraphSideRail articleUrn={URN} />);
    expect(screen.getByRole('button', { name: /espandi/i })).toBeInTheDocument();
    expect(screen.queryByTestId('cytoscape')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton while fetching once expanded', () => {
    setGraph({ status: 'loading' });
    render(<ArticleGraphSideRail articleUrn={URN} defaultOpen />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the graph and an "explore" CTA on success with nodes', async () => {
    setGraph({
      status: 'success',
      data: { nodes: [{ id: 'a', type: 'Norma', label: 'A', urn: URN }], edges: [] },
      elements: { nodes: [{ data: { id: 'a' } }], edges: [] },
    });
    render(<ArticleGraphSideRail articleUrn={URN} defaultOpen />);
    expect(await screen.findByTestId('cytoscape')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /esplora nel grafo/i })).toBeInTheDocument();
  });

  it('triggers ingestion and shows a building state when the subgraph is empty', async () => {
    triggerIngestionMock.mockResolvedValue({ jobId: 'job-1', status: 'pending' });
    setGraph({ status: 'success', data: { nodes: [], edges: [] }, elements: { nodes: [], edges: [] } });

    render(<ArticleGraphSideRail articleUrn={URN} defaultOpen />);

    await waitFor(() => expect(triggerIngestionMock).toHaveBeenCalledWith(URN));
    expect(screen.getByText(/indicizz/i)).toBeInTheDocument();
  });

  it('re-triggers ingestion when the article changes (reset keyed on activeUrn)', async () => {
    triggerIngestionMock.mockResolvedValue({ jobId: 'job-x', status: 'pending' });
    setGraph({ status: 'success', data: { nodes: [], edges: [] }, elements: { nodes: [], edges: [] } });

    const { rerender } = render(<ArticleGraphSideRail articleUrn={URN} defaultOpen />);
    await waitFor(() => expect(triggerIngestionMock).toHaveBeenCalledWith(URN));

    const URN_B = 'urn:nir:stato:codice.penale:1930;575';
    rerender(<ArticleGraphSideRail articleUrn={URN_B} defaultOpen />);
    await waitFor(() => expect(triggerIngestionMock).toHaveBeenCalledWith(URN_B));
    expect(triggerIngestionMock).toHaveBeenCalledTimes(2);
  });

  it('shows "non indicizzabile" when ingestion completes but the graph stays empty', () => {
    triggerIngestionMock.mockResolvedValue({ jobId: 'job-done', status: 'pending' });
    setGraph({ status: 'success', data: { nodes: [], edges: [] }, elements: { nodes: [], edges: [] } });
    setJob({ status: 'completed', error: null, nodesCreated: 0 });
    render(<ArticleGraphSideRail articleUrn={URN} defaultOpen />);
    expect(screen.getByText(/non indicizzabile/i)).toBeInTheDocument();
  });

  it('shows an error state with a retry button on fetch error', () => {
    setGraph({ status: 'error', error: new Error('boom') });
    render(<ArticleGraphSideRail articleUrn={URN} defaultOpen />);
    const retry = screen.getByRole('button', { name: /riprova/i });
    fireEvent.click(retry);
    expect(refetchMock).toHaveBeenCalled();
  });

  it('navigates to the explorer when the CTA is clicked', () => {
    setGraph({
      status: 'success',
      data: { nodes: [{ id: 'a', type: 'Norma', label: 'A', urn: URN }], edges: [] },
      elements: { nodes: [{ data: { id: 'a' } }], edges: [] },
    });
    render(<ArticleGraphSideRail articleUrn={URN} defaultOpen />);
    fireEvent.click(screen.getByRole('button', { name: /esplora nel grafo/i }));
    expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining('/grafo?urn='));
  });
});
