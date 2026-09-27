import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { extractUrnConflictsError } from '../opsIngestionApi';
import type { BatchDetail } from '../types';

const promoteBatchMock = vi.fn();
vi.mock('../opsIngestionApi', async () => {
  const actual = await vi.importActual<typeof import('../opsIngestionApi')>('../opsIngestionApi');
  return {
    ...actual,
    promoteBatch: (...args: unknown[]) => promoteBatchMock(...args),
  };
});

import { PromoteBatchDialog } from '../PromoteBatchDialog';

function makeBatch(overrides: Partial<BatchDetail> = {}): BatchDetail {
  return {
    id: 'b1',
    source: 'visualex_tree',
    scope_label: 'Libro IV',
    status: 'pending_review',
    stats: { nodes_new: 3, nodes_update: 1 },
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
  promoteBatchMock.mockReset();
});

describe('PromoteBatchDialog', () => {
  it('promotes a batch without conflicts on confirm', async () => {
    promoteBatchMock.mockResolvedValue({ batch_id: 'b1', job_id: 'j1', status: 'promoting' });
    const onPromoted = vi.fn();
    render(<PromoteBatchDialog batch={makeBatch()} onClose={() => {}} onPromoted={onPromoted} />);

    const confirmBtn = screen.getByRole('button', { name: /sì, promuovi/i });
    expect(confirmBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(promoteBatchMock).toHaveBeenCalledWith('b1', { force: false, reason: undefined });
    expect(onPromoted).toHaveBeenCalledTimes(1);
  });

  it('shows URN conflicts on 409, blocks confirm until "force" is checked, then retries with force:true', async () => {
    promoteBatchMock.mockRejectedValueOnce({
      status: 409,
      data: {
        detail: {
          error: 'urn_conflicts_block_promotion',
          urn_conflicts: [{ urn: 'urn:x', batch: {}, graph: {} }],
        },
      },
    });
    promoteBatchMock.mockResolvedValueOnce({ batch_id: 'b1', job_id: 'j1', status: 'promoting' });
    const onPromoted = vi.fn();
    render(<PromoteBatchDialog batch={makeBatch()} onClose={() => {}} onPromoted={onPromoted} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sì, promuovi/i }));
    });

    expect(screen.getByText('urn:x')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/conflitti urn non risolti/i);
    expect(onPromoted).not.toHaveBeenCalled();

    const confirmBtn = screen.getByRole('button', { name: /sì, promuovi/i });
    expect(confirmBtn).toBeDisabled();

    const forceCheckbox = screen.getByRole('checkbox', { name: /forza promozione/i });
    fireEvent.click(forceCheckbox);
    expect(confirmBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(promoteBatchMock).toHaveBeenCalledTimes(2);
    expect(promoteBatchMock).toHaveBeenNthCalledWith(2, 'b1', { force: true, reason: undefined });
    expect(onPromoted).toHaveBeenCalledTimes(1);
  });

  it('shows a "state changed/expired" message on a plain-string 409 detail', async () => {
    promoteBatchMock.mockRejectedValueOnce({
      status: 409,
      data: { detail: 'batch_status_changed_concurrently' },
    });
    const onPromoted = vi.fn();
    render(<PromoteBatchDialog batch={makeBatch()} onClose={() => {}} onPromoted={onPromoted} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sì, promuovi/i }));
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/il batch non è più promuovibile/i)
    );
    expect(onPromoted).not.toHaveBeenCalled();
  });

  it('falls back to the generic unreachable message on a network/503 error', async () => {
    promoteBatchMock.mockRejectedValueOnce({ status: 503, data: {} });
    const onPromoted = vi.fn();
    render(<PromoteBatchDialog batch={makeBatch()} onClose={() => {}} onPromoted={onPromoted} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sì, promuovi/i }));
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/merl-t potrebbe non essere raggiungibile/i)
    );
    expect(onPromoted).not.toHaveBeenCalled();
  });

  it('sanity check: extractUrnConflictsError is the real (unmocked) implementation', () => {
    const conflicts = extractUrnConflictsError({
      data: { detail: { error: 'urn_conflicts_block_promotion', urn_conflicts: [{ urn: 'a', batch: {}, graph: {} }] } },
    });
    expect(conflicts).toEqual([{ urn: 'a', batch: {}, graph: {} }]);
  });
});
