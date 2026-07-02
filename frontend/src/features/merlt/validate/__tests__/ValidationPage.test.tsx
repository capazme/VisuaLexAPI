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
      { id: 'e1', nome: 'Buona fede', descrizione: 'principio', votes_count: 0 },
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
    expect(voteEntityMock).toHaveBeenCalledWith('e1', 'approve');
    await waitFor(() => expect(screen.queryByText('Buona fede')).not.toBeInTheDocument());
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
    expect(voteEntityMock).toHaveBeenLastCalledWith('e1', 'approve');
    await waitFor(() => expect(screen.queryByText('Buona fede')).not.toBeInTheDocument());
    consoleError.mockRestore();
  });
});
