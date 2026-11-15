import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const getHistory = vi.fn();
vi.mock('../../../services/historyService', () => ({
  getHistory: (...a: unknown[]) => getHistory(...a),
  deleteHistoryItem: vi.fn(),
  clearHistory: vi.fn(),
}));
vi.mock('./NormaChangesSection', () => ({ NormaChangesSection: () => null }));
const fetchDecisionCached = vi.fn();
vi.mock('../../../utils/decisionFetchCache', () => ({ fetchDecisionCached: (...a: unknown[]) => fetchDecisionCached(...a) }));
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
  fetchDecisionCached.mockReset();
  fetchDecisionCached.mockResolvedValue({ esito: 'non_trovata', motivo: 'inesistente' });
  appStore.setState({ practices: [], activePracticeId: null, phoneReader: null });
});

describe('HistoryView — decisions', () => {
  it('lists a decision by its short citation, previews it, and reopens it in a practice from the preview', async () => {
    getHistory.mockResolvedValue([decision]);
    mount();
    const buttons = await screen.findAllByRole('button', { name: /Cass\. civ\., n\. 99999\/2024/ });
    expect(buttons[0]).toHaveAttribute('aria-haspopup', 'dialog');
    await act(async () => { fireEvent.click(buttons[0]); });
    expect(fetchDecisionCached).toHaveBeenCalledWith({ corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 });
    expect(appStore.getState().practices).toEqual([]);
    expect(screen.getByTestId('where').textContent).toBe('/history');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Apri la sentenza' }));
    expect(appStore.getState().practices.flatMap((p) => p.decisions.map((d) => d.reference))).toEqual([
      { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 },
    ]);
    expect(screen.getByTestId('where').textContent).toBe('/');
  });

  it('names the page with one h1 in the sections\' frame, with one search field (W2)', async () => {
    getHistory.mockResolvedValue([norm]);
    mount();
    await screen.findAllByText(/Art\. 3/);
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent?.trim())).toEqual(['Cronologia']);
    expect(screen.getAllByRole('textbox', { name: 'Cerca nella cronologia' })).toHaveLength(1);
    // At least 16 px on a phone, or Safari on an iPhone zooms the page into it (`FIELD_TEXT`).
    expect(screen.getByRole('textbox', { name: 'Cerca nella cronologia' })).toHaveClass('text-[length:max(1rem,16px)]', 'md:text-sm');
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

  it('opens a norm from the keyboard: its title is a button, Tab reaches it, Enter opens it; the menu sits beside it (A6)', async () => {
    getHistory.mockResolvedValue([norm]);
    mount();
    const titles = await screen.findAllByRole('button', { name: (n) => n.includes('legge') && n.includes('Art. 3') });
    // One per layout (phone and desktop); none of them holds another control.
    expect(titles).toHaveLength(2);
    titles.forEach((title) => expect(title.querySelector('button')).toBeNull());
    expect(titles[1].parentElement?.querySelector('button[title="Altre azioni"]')).not.toBeNull();
    titles[1].focus();
    expect(titles[1]).toHaveFocus();
    // A native button: Enter is its click.
    fireEvent.click(titles[1]);
    expect(screen.getByTestId('where').textContent).toBe('/');
  });

  it('writes the time of a visit at 4.5:1 or more, in light and dark (Pietra\'s secondary text)', async () => {
    getHistory.mockResolvedValue([norm]);
    mount();
    const times = await screen.findAllByTitle(new Date(at).toLocaleString('it-IT'));
    times.forEach((time) => {
      expect(time).not.toHaveClass('text-slate-400');
      expect(time).not.toHaveClass('dark:text-slate-500');
    });
  });
});
