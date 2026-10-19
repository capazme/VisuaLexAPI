import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { BatchSummary, IngestionBatchStatus } from '../types';

const listBatchesMock = vi.fn();
vi.mock('../opsIngestionApi', () => ({
  listBatches: (...args: unknown[]) => listBatchesMock(...args),
}));

vi.mock('../BatchDetailPanel', () => ({
  BatchDetailPanel: ({ batchId }: { batchId: string }) => (
    <div data-testid="batch-detail-panel">{batchId}</div>
  ),
}));

vi.mock('../IngestionRunForm', () => ({
  IngestionRunForm: ({ onStarted }: { onStarted: (res: { batch_id: string; job_id: string }) => void }) => (
    <button onClick={() => onStarted({ batch_id: 'new-batch', job_id: 'job-1' })}>start-batch</button>
  ),
}));

import { IngestionAdminPanel } from '../IngestionAdminPanel';

function batch(id: string, status: IngestionBatchStatus): BatchSummary {
  return {
    id,
    source: 'visualex_tree',
    scope_label: `Batch ${id}`,
    status,
    stats: null,
    created_at: '2026-07-01T00:00:00Z',
    created_by: 'admin',
    reviewed_by: null,
    promoted_at: null,
    rejected_at: null,
    expires_at: null,
    error: null,
  };
}

beforeEach(() => {
  listBatchesMock.mockReset();
});

describe('IngestionAdminPanel', () => {
  it('splits every batch status into the correct section (in_progress / pending_review / history)', async () => {
    listBatchesMock.mockResolvedValue({
      batches: [
        batch('p1', 'parsing'),
        batch('p2', 'promoting'),
        batch('r1', 'pending_review'),
        batch('h1', 'promoted'),
        batch('h2', 'rejected'),
        batch('h3', 'failed'),
      ],
    });

    render(<IngestionAdminPanel />);

    await waitFor(() => expect(screen.getByText('In elaborazione (2)')).toBeInTheDocument());
    expect(screen.getByText('Batch p1')).toBeInTheDocument();
    expect(screen.getByText('Batch p2')).toBeInTheDocument();

    expect(screen.getByText('Da revisionare (1)')).toBeInTheDocument();
    expect(screen.getByText('Batch r1')).toBeInTheDocument();

    expect(screen.getByText('Storico (3)')).toBeInTheDocument();
    expect(screen.getByText('Batch h1')).toBeInTheDocument();
    expect(screen.getByText('Batch h2')).toBeInTheDocument();
    expect(screen.getByText('Batch h3')).toBeInTheDocument();
  });

  it('shows an error message and logs when the batch list fails to load', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    listBatchesMock.mockRejectedValue(new Error('network down'));

    render(<IngestionAdminPanel />);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/elenco batch non disponibile al momento/i)
    );
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('selects and mounts BatchDetailPanel for a newly started batch via IngestionRunForm', async () => {
    listBatchesMock.mockResolvedValue({ batches: [] });
    render(<IngestionAdminPanel />);

    await waitFor(() => expect(screen.getByText('Da revisionare (0)')).toBeInTheDocument());
    expect(screen.queryByTestId('batch-detail-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('start-batch'));

    await waitFor(() => expect(screen.getByTestId('batch-detail-panel')).toHaveTextContent('new-batch'));
  });
});
