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
    await screen.findAllByText('art. 3 l. 241/1990');
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent?.trim())).toEqual(['Cronologia']);
    expect(screen.getAllByRole('textbox', { name: 'Cerca nella cronologia' })).toHaveLength(1);
    // At least 16 px on a phone, or Safari on an iPhone zooms the page into it (`FIELD_TEXT`).
    expect(screen.getByRole('textbox', { name: 'Cerca nella cronologia' })).toHaveClass('text-[length:max(1rem,16px)]', 'md:text-sm');
  });

  // LC21 (B8): a norm row is titled as the norm is cited, the act's heading under it; rows of a list, no cards or dots.
  it('titles a norm row as it is cited, with the act under it, beside a decision', async () => {
    getHistory.mockResolvedValue([norm, decision]);
    mount();
    await screen.findAllByText(/Cass\. civ\., n\. 99999\/2024/);
    expect(screen.getAllByText('art. 3 l. 241/1990').length).toBeGreaterThan(0);
    expect(screen.getAllByText('l. n. 241 del 1990').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Art\. 3$/)).toBeNull();
    // The desktop row (the second title): a ruled row, no bordered card, no timeline dot beside it.
    const title = screen.getAllByRole('button', { name: (n) => n.includes('art. 3 l. 241/1990') && !n.startsWith('Altre azioni') })[1];
    const card = title.parentElement!.parentElement!;
    expect(card).toHaveClass('border-b');
    expect(card).not.toHaveClass('border-2');
    expect(card.parentElement!.querySelector('.bg-primary-500')).toBeNull();
  });

  it('writes a list of articles as «artt.», comma by comma', async () => {
    getHistory.mockResolvedValue([{ ...norm, act_type: 'codice civile', act_number: null, date: null, article: '2056,2057' }]);
    mount();
    expect((await screen.findAllByText('artt. 2056, 2057 c.c.')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Codice civile').length).toBeGreaterThan(0);
  });

  it('heads each date group with a small uppercase h2, no calendar pill', async () => {
    getHistory.mockResolvedValue([norm]);
    mount();
    await screen.findAllByText('art. 3 l. 241/1990');
    const groups = screen.getAllByRole('heading', { level: 2 });
    expect(groups.length).toBeGreaterThan(0);
    for (const h of groups) expect(h).toHaveClass('uppercase', 'text-xs');
    expect(document.querySelector('.lucide-calendar')).toBeNull();
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
    const titles = await screen.findAllByRole('button', { name: (n) => n.includes('art. 3 l. 241/1990') && !n.startsWith('Altre azioni') });
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

  // LC103: the norm's «⋯» is a `MenuButton`, as every other menu, on the phone as on a computer.
  it('closes a norm\'s «⋯» on Escape and gives the focus back to its button', async () => {
    getHistory.mockResolvedValue([norm]);
    appStore.setState({ dossiers: [{ id: 'p1', title: 'Pratica Rossi' }] } as never);
    mount();
    const triggers = await screen.findAllByRole('button', { name: 'Altre azioni su art. 3 l. 241/1990' });
    // One per layout (phone and desktop).
    expect(triggers).toHaveLength(2);
    for (const trigger of triggers) {
      fireEvent.click(trigger);
      const menu = screen.getByRole('menu');
      expect(within(menu).getAllByRole('menuitem').map((i) => i.getAttribute('aria-label') ?? i.textContent)).toEqual([
        'Aggiungi a norme rapide', 'Aggiungi a Pratica Rossi', 'Aggiungi a una nuova pratica…', 'Rimuovi dalla cronologia',
      ]);
      expect(within(menu).getAllByRole('menuitem')[0]).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
      expect(within(menu).getByRole('menuitem', { name: 'Aggiungi a Pratica Rossi' })).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(trigger).toHaveFocus();
    }
  });

  // Papiniano on #634: a «⋯» open, then «/» and a search, and the menu stood under another norm and removed it.
  it('closes an open «⋯» on «/» and never leaves it under another norm when the filter changes', async () => {
    const other = { ...norm, id: 'n2', act_type: 'codice civile', act_number: null, date: null, article: '2043' };
    getHistory.mockResolvedValue([norm, other]);
    mount();
    const search = screen.getByRole('textbox', { name: 'Cerca nella cronologia' });
    const desktop = async () => (await screen.findAllByRole('button', { name: 'Altre azioni su art. 3 l. 241/1990' }))[1];

    // «/»: the menu closes, the search has the focus.
    fireEvent.click(await desktop());
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: '/' });
    expect(search).toHaveFocus();
    expect(screen.queryByRole('menu')).toBeNull();

    // The filter changing under an open menu: its row goes, and the menu with it; nothing moves under «art. 2043».
    fireEvent.click(await desktop());
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '2043' } });
    await waitFor(() => expect(screen.queryAllByText('art. 3 l. 241/1990')).toHaveLength(0));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('gives the phone\'s «⋯» a 44 px touch target, in the phone\'s list (it was only in the computer\'s, 0 wide at 390)', async () => {
    getHistory.mockResolvedValue([norm]);
    mount();
    const [phone] = await screen.findAllByRole('button', { name: 'Altre azioni su art. 3 l. 241/1990' });
    expect(phone.closest('.md\\:hidden')).not.toBeNull();
    expect(phone).toHaveClass('min-h-[44px]', 'min-w-[44px]');
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
