import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { BatchDetail } from '../types';

const rejectBatchMock = vi.fn();
vi.mock('../opsIngestionApi', () => ({
  rejectBatch: (...args: unknown[]) => rejectBatchMock(...args),
}));

import { RejectBatchDialog } from '../RejectBatchDialog';

function makeBatch(overrides: Partial<BatchDetail> = {}): BatchDetail {
  return {
    id: 'b1',
    source: 'visualex_tree',
    scope_label: 'Libro IV',
    status: 'pending_review',
    stats: null,
    created_at: '2026-07-01T00:00:00Z',
    created_by: 'admin',
    reviewed_by: null,
    promoted_at: null,
    rejected_at: null,
    expires_at: null,
    error: null,
    conflict_report: null,
    nodes_sample: [],
    edges_sample: [],
    nodes_total: 0,
    edges_total: 0,
    ...overrides,
  };
}

beforeEach(() => {
  rejectBatchMock.mockReset();
});

describe('RejectBatchDialog', () => {
  it('disables confirm while the reason is empty or whitespace-only', () => {
    render(<RejectBatchDialog batch={makeBatch()} onClose={() => {}} onRejected={() => {}} />);
    const confirmBtn = screen.getByRole('button', { name: /sì, rifiuta/i });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/motivazione/i), { target: { value: '   ' } });
    expect(confirmBtn).toBeDisabled();
  });

  it('submits the trimmed reason and calls onRejected on success', async () => {
    rejectBatchMock.mockResolvedValue({ batch_id: 'b1', status: 'rejected' });
    const onRejected = vi.fn();
    render(<RejectBatchDialog batch={makeBatch()} onClose={() => {}} onRejected={onRejected} />);

    fireEvent.change(screen.getByLabelText(/motivazione/i), { target: { value: '  duplicate scope  ' } });
    const confirmBtn = screen.getByRole('button', { name: /sì, rifiuta/i });
    expect(confirmBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(rejectBatchMock).toHaveBeenCalledWith('b1', { reason: 'duplicate scope' });
    expect(onRejected).toHaveBeenCalledTimes(1);
  });

  it('shows an error message and does not call onRejected when the call fails', async () => {
    rejectBatchMock.mockRejectedValue({ status: 503, data: {} });
    const onRejected = vi.fn();
    render(<RejectBatchDialog batch={makeBatch()} onClose={() => {}} onRejected={onRejected} />);

    fireEvent.change(screen.getByLabelText(/motivazione/i), { target: { value: 'reason' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sì, rifiuta/i }));
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/rifiuto non riuscito/i)
    );
    expect(onRejected).not.toHaveBeenCalled();
  });
});
