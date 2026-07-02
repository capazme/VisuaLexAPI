import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const useMerltFeaturesMock = vi.fn();
const fetchPending = vi.fn();
const voteEntityMock = vi.fn();
const voteRelationMock = vi.fn();

vi.mock('../../useMerltFeatures', () => ({ useMerltFeatures: () => useMerltFeaturesMock() }));
vi.mock('../validateApi', () => ({
  fetchPendingQueue: (...a: unknown[]) => fetchPending(...a),
  voteEntity: (...a: unknown[]) => voteEntityMock(...a),
  voteRelation: (...a: unknown[]) => voteRelationMock(...a),
}));

import { ValidationPage } from '../ValidationPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <ValidationPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useMerltFeaturesMock.mockReturnValue({ canValidate: true, merltEnabled: true });
  voteEntityMock.mockReset().mockResolvedValue(undefined);
  voteRelationMock.mockReset().mockResolvedValue(undefined);
  fetchPending.mockReset().mockResolvedValue({
    pending_entities: [
      {
        id: 'e1',
        nome: 'Buona fede',
        descrizione: 'principio',
        votes_count: 0,
        fonte: 'llm_extraction',
        contributed_by: 'user-42',
        created_at: '2026-06-30T10:00:00.000Z',
        articoli_correlati: ['urn:nir:stato:codice.civile:1942-03-16;262~art1375'],
      },
    ],
    pending_relations: [],
    total_entities: 1,
    total_relations: 0,
    user_can_vote: 1,
  });
});

describe('ValidationPage', () => {
  it('blocks validation without full consent', () => {
    useMerltFeaturesMock.mockReturnValue({ canValidate: false, merltEnabled: true });
    renderPage();
    expect(screen.getByText(/consenso/i)).toBeInTheDocument();
    expect(fetchPending).not.toHaveBeenCalled();
  });

  it('lists pending entities and votes (approve) removing the item', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Buona fede')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /approva buona fede/i }));
    });
    // approve carries no quick-reason (reason is reject-only)
    expect(voteEntityMock).toHaveBeenCalledWith('e1', 'approve', undefined);
    await waitFor(() => expect(screen.queryByText('Buona fede')).not.toBeInTheDocument());
  });

  it('renders provenance and a norm link for each proposal', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Buona fede')).toBeInTheDocument());
    expect(screen.getByTestId('provenance-fonte')).toHaveTextContent(/automatica/i);
    expect(screen.getByRole('button', { name: /apri la norma/i })).toBeInTheDocument();
  });

  it('skips a proposal locally without casting a vote', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Buona fede')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /salta buona fede/i }));
    });
    expect(voteEntityMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Buona fede')).not.toBeInTheDocument());
  });

  it('reject with a quick-reason forwards the reason to the api', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Buona fede')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /motivo del rifiuto/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /non pertinente/i }));
    });
    expect(voteEntityMock).toHaveBeenCalledWith('e1', 'reject', 'non pertinente');
  });

  it('shows a degraded message when the queue fetch fails', async () => {
    fetchPending.mockRejectedValue(new Error('down'));
    renderPage();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('reverts the optimistic removal and shows a retry toast when the vote fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    voteEntityMock.mockRejectedValue(new Error('500'));
    renderPage();
    await waitFor(() => expect(screen.getByText('Buona fede')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /approva buona fede/i }));
    });
    // reverted: the item is back in the queue
    await waitFor(() => expect(screen.getByText('Buona fede')).toBeInTheDocument());
    // Italian retry toast, no silent catch
    expect(screen.getByText(/invio del voto non riuscito/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('retries the vote from the toast and removes the item on success', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    voteEntityMock.mockRejectedValueOnce(new Error('500')).mockResolvedValueOnce(undefined);
    renderPage();
    await waitFor(() => expect(screen.getByText('Buona fede')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /approva buona fede/i }));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Riprova' })).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    });
    expect(voteEntityMock).toHaveBeenCalledTimes(2);
    expect(voteEntityMock).toHaveBeenLastCalledWith('e1', 'approve', undefined);
    await waitFor(() => expect(screen.queryByText('Buona fede')).not.toBeInTheDocument());
    consoleError.mockRestore();
  });
});
