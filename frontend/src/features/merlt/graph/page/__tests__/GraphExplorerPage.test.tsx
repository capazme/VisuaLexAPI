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
vi.mock('../../shared/GraphCanvas', () => ({
  default: () => <div data-testid="cytoscape" />,
}));
vi.mock('../../featureFlag', () => ({
  isMerltGraphEnabled: () => isEnabledMock(),
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
});
