import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('./useActDetails', () => ({ useActDetails: () => ({ title: null, rubricaOf: () => null }) }));
vi.mock('./DossierItemReader', () => ({ DossierItemReader: () => null }));
vi.mock('../../../services/dossierService', () => ({
  dossierService: {
    getSnapshots: vi.fn(async () => []),
    // A fresh id per call, as the server gives.
    addItem: vi.fn(async () => ({ id: `srv-${Math.random().toString(36).slice(2)}`, item_type: 'norm', title: '', content: {}, position: 0, status: 'unread', created_at: '' })),
    deleteItem: vi.fn(async () => {}),
    updateItem: vi.fn(async () => ({})),
    reorderItems: vi.fn(async () => {}),
  },
}));

import { appStore } from '../../../store/useAppStore';
import { registerUndoToastListener, type UndoToast } from '../../../hooks/useUndoableAction';
import { DossierDetailView } from './DossierDetailView';
import type { Dossier } from '../../../types';

const L247 = 'l. 31 dicembre 2012, n. 247';
const L49 = 'l. 21 aprile 2023, n. 49';
const dossier: Dossier = {
  id: 'd1', title: 'Ricorso Rossi', createdAt: '2026-10-04T08:00:00Z', tags: [],
  items: [
    { id: 'a3', type: 'norma', addedAt: '', actCitation: L247, citation: `art. 3, ${L247}`, data: { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', numero_articolo: '3' } },
    { id: 'b1', type: 'norma', addedAt: '', actCitation: L49, data: { tipo_atto: 'legge', numero_atto: '49', data: '2023-04-21', numero_articolo: '1' } },
    { id: 'a1', type: 'norma', addedAt: '', actCitation: L247, data: { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', numero_articolo: '1' } },
    { id: 'n1', type: 'note', addedAt: '2026-10-04T09:00:00Z', data: 'Verificare la decorrenza' },
  ],
};

let toast: UndoToast | null = null;
let unregister: () => void = () => {};

function renderView() {
  appStore.setState({ dossiers: [structuredClone(dossier)], pendingDossierItemIds: {}, pendingDossierOrders: {} });
  const current = () => appStore.getState().dossiers[0];
  const view = render(
    <MemoryRouter>
      <DossierDetailView dossier={current()} onBack={() => {}} showToast={() => {}} />
    </MemoryRouter>,
  );
  // The page reads its dossier from props, as DossierPage passes it: re-render on store changes.
  const rerender = () => view.rerender(
    <MemoryRouter>
      <DossierDetailView dossier={current()} onBack={() => {}} showToast={() => {}} />
    </MemoryRouter>,
  );
  return { rerender };
}

beforeEach(() => {
  toast = null;
  unregister = registerUndoToastListener((t) => { toast = t; });
});
afterEach(() => unregister());

describe('DossierDetailView — the page by act', () => {
  it('names each act once, in the order the acts entered, with its articles by number', () => {
    renderView();
    expect(screen.getAllByRole('heading', { name: `${L247} 2 articoli` })).toHaveLength(1);
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent ?? '');
    expect(headings.filter((h) => h.startsWith('l. '))).toEqual([`${L247}2 articoli`, `${L49}1 articolo`]);
    const block = screen.getByRole('region', { name: L247 });
    expect(within(block).getAllByText(/^art\. \d+$/).map((el) => el.textContent)).toEqual(['art. 1', 'art. 3']);
  });

  it('puts the notes above the acts', () => {
    renderView();
    const notes = screen.getByRole('region', { name: /Note \(1\)/ });
    expect(within(notes).getByText('Verificare la decorrenza')).toBeInTheDocument();
    const firstAct = screen.getByRole('region', { name: L247 });
    expect(notes.compareDocumentPosition(firstAct) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('counts acts, articles and notes', () => {
    renderView();
    expect(screen.getByText(/2 atti · 3 articoli · 1 nota/)).toBeInTheDocument();
  });

  it('has three actions and a menu in its header, and no selection bar until asked', () => {
    renderView();
    expect(screen.getByRole('button', { name: 'Apri tutto su Dashboard' })).toBeInTheDocument();
    for (const name of ['Aggiungi', 'Esporta', 'Altre azioni']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-haspopup', 'menu');
    }
    expect(screen.queryByText('Seleziona tutti')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Altre azioni' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Seleziona elementi' }));
    expect(screen.getByText('Seleziona tutti')).toBeInTheDocument();
  });

  it('lists what each menu does', () => {
    renderView();
    const items = (menu: string) => {
      fireEvent.click(screen.getByRole('button', { name: menu }));
      const names = screen.getAllByRole('menuitem').map((el) => el.textContent);
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      return names;
    };
    expect(items('Aggiungi')).toEqual(['Articoli da una norma', 'Nota', 'Cerca un articolo']);
    expect(items('Esporta')).toEqual(['PDF', 'Copia link di condivisione', 'JSON', 'Salva snapshot']);
    expect(items('Altre azioni')).toEqual(['Modifica', 'Aggiungi ai preferiti', 'Seleziona elementi', 'Elimina dossier']);
  });

  it("removes a whole act behind one undo toast, and puts it back", async () => {
    const { rerender } = renderView();
    fireEvent.click(screen.getByRole('button', { name: `Azioni su ${L247}` }));
    fireEvent.click(screen.getByRole('menuitem', { name: "Rimuovi l'atto dal dossier" }));
    await waitFor(() => expect(toast?.message).toBe('2 articoli rimossi'));
    expect(appStore.getState().dossiers[0].items.map((i) => i.id)).toEqual(['b1', 'n1']);
    rerender();
    expect(screen.queryByRole('region', { name: L247 })).toBeNull();
    await act(async () => { await toast?.onUndo(); });
    // Back where they were, with the ids the server gives a restored item.
    const items = appStore.getState().dossiers[0].items;
    expect(items).toHaveLength(4);
    expect(items.filter((i) => i.type === 'norma').map((i) => (i.data as { numero_articolo: string }).numero_articolo).sort()).toEqual(['1', '1', '3']);
  });

  it('filters by the act, and turns dragging off while filtering', () => {
    renderView();
    expect(screen.getByRole('button', { name: `Sposta ${L247}` })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Cerca negli elementi del dossier' }), { target: { value: '21 aprile' } });
    expect(screen.queryByRole('region', { name: L247 })).toBeNull();
    expect(screen.getByRole('region', { name: L49 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Sposta ${L49}` })).toBeNull();
  });
});
