import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const getHistory = vi.fn();
vi.mock('../../../services/historyService', () => ({
  getHistory: (...a: unknown[]) => getHistory(...a),
  deleteHistoryItem: vi.fn(),
  clearHistory: vi.fn(),
}));
vi.mock('./NormaChangesSection', () => ({ NormaChangesSection: () => null }));
vi.mock('../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn() }) }));

import { appStore } from '../../../store/useAppStore';
import { HistoryView } from './HistoryView';

const at = '2026-10-10T10:00:00.000Z';
const norm = { id: 'n1', act_type: 'legge', decision_key: null, act_number: '241', article: '3', date: '1990', created_at: at };
const decision = { id: 'd1', act_type: null, decision_key: 'cassazione:civile:99999:2024', created_at: at };
const broken = { id: 'd2', act_type: null, decision_key: 'cassazione:civile:zero:2024', created_at: at };

function Where() { return <span data-testid="where">{useLocation().pathname}</span>; }
function mount() {
  return render(<MemoryRouter initialEntries={['/history']}><HistoryView /><Where /></MemoryRouter>);
}

beforeEach(() => {
  getHistory.mockReset();
  appStore.setState({ practices: [], activePracticeId: null, phoneReader: null });
});

describe('HistoryView — decisions', () => {
  it('lists a decision by its short citation and reopens it in a practice', async () => {
    getHistory.mockResolvedValue([decision]);
    mount();
    const buttons = await screen.findAllByRole('button', { name: /Cass\. civ\., n\. 99999\/2024/ });
    fireEvent.click(buttons[0]);
    expect(appStore.getState().practices.flatMap((p) => p.decisions.map((d) => d.reference))).toEqual([
      { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 },
    ]);
    expect(screen.getByTestId('where').textContent).toBe('/');
  });

  it('leaves a norm row as it was', async () => {
    getHistory.mockResolvedValue([norm, decision]);
    mount();
    await screen.findAllByText(/Cass\. civ\., n\. 99999\/2024/);
    expect(screen.getAllByText(/Art\. 3/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('legge').length).toBeGreaterThan(0);
  });

  it('shows an unreadable key as «Sentenza», not clickable, and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    getHistory.mockResolvedValue([broken]);
    mount();
    expect((await screen.findAllByText('Sentenza')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Sentenza' })).toBeNull();
    await waitFor(() => expect(error).toHaveBeenCalledWith('history: unreadable decision key', expect.objectContaining({ id: 'd2' })));
    expect(error.mock.calls.filter((c) => c[0] === 'history: unreadable decision key')).toHaveLength(1);
    error.mockRestore();
  });
});
