import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// What each act block asks its title and rubriche for.
const actDetailsAskedFor = vi.hoisted(() => [] as { key: string; articles: unknown[] }[]);
vi.mock('./useActDetails', () => ({
  useActDetails: (block: { key: string; articles: unknown[] }) => {
    actDetailsAskedFor.push(block);
    return { title: null, rubricaOf: () => null };
  },
  resolveBlockUrn: async () => 'urn:act',
  lastActTitle: () => null,
}));
// The PDF's reads and its file: the dialog and the flow are what is tested here.
const pdf = vi.hoisted(() => ({
  save: vi.fn(),
  loadDossierTexts: vi.fn(),
  loadDossierDecisions: vi.fn(),
  loadPdfMarks: vi.fn(),
  built: [] as unknown[][],
  written: [] as unknown[][],
}));
vi.mock('./dossierPdf', async (importOriginal) => {
  const real = await importOriginal<typeof import('./dossierPdf')>();
  return {
    ...real,
    loadDossierTexts: pdf.loadDossierTexts,
    loadDossierDecisions: pdf.loadDossierDecisions,
    buildPdfBlocks: (...args: Parameters<typeof real.buildPdfBlocks>) => { pdf.built.push(args); return real.buildPdfBlocks(...args); },
    writeDossierPdf: (...args: unknown[]) => { pdf.written.push(args); return { save: pdf.save }; },
  };
});
vi.mock('./dossierPdfMarks', () => ({ loadPdfMarks: pdf.loadPdfMarks }));
vi.mock('../../../utils/actStructureCache', () => ({ fetchActRubriche: async () => ({ title: 'Titolo' }) }));
vi.mock('./DossierItemReader', () => ({ DossierItemReader: () => null }));
// The act's index, reduced to what it hands over: this many articles of a law.
const tree = vi.hoisted(() => ({ count: 0 }));
vi.mock('./TreeNavigatorModal', () => ({
  TreeNavigatorModal: ({ onImport, onClose }: { onImport: (a: { numero: string }[], act: { tipo_atto: string; data: string; numero_atto: string }) => void; onClose: () => void }) => (
    <button type="button" onClick={() => { onImport(Array.from({ length: tree.count }, (_, i) => ({ numero: String(i + 1) })), { tipo_atto: 'legge', data: '2012-12-31', numero_atto: '247' }); onClose(); }}>
      importa dall'indice
    </button>
  ),
}));
// The dossier's tasks panel reads its tasks from the server: an empty list here (its own tests: `planner/`).
vi.mock('../../../services/taskService', () => ({
  taskService: { list: async () => ({ today: '2026-10-20', tasks: [], truncated: false }) },
}));
vi.mock('../../../services/dossierService', () => ({
  dossierService: {
    getSnapshots: vi.fn(async () => []),
    // A fresh id per call, as the server gives.
    addItem: vi.fn(async () => ({ id: `srv-${Math.random().toString(36).slice(2)}`, item_type: 'norm', title: '', content: {}, position: 0, status: 'unread', created_at: '' })),
    trashItems: vi.fn(async (_d: string, ids: string[]) => ({ trashId: 't1', moved: ids, notFound: [] })),
    getById: vi.fn(),
    writesInFlight: vi.fn(() => 0),
    updateItem: vi.fn(async () => ({})),
    reorderItems: vi.fn(async () => {}),
    addNote: vi.fn(async (_d: string, body: { text: string; aboutItemId?: string }) => ({
      id: 'srv-note', item_type: 'note', title: 'Nota', content: body.text, position: 9, status: 'unread', created_at: '2026-10-04T12:00:00Z',
      about_item_id: body.aboutItemId ?? null, created_by: null,
    })),
  },
}));

vi.mock('../../../services/trashService', () => ({ trashService: { restore: vi.fn(async () => ({ dossierId: 'd1' })) } }));

import { appStore } from '../../../store/useAppStore';
import { trashService } from '../../../services/trashService';
import { dossierService } from '../../../services/dossierService';
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

function renderView(start: Dossier = dossier) {
  appStore.setState({ dossiers: [structuredClone(start)], pendingDossierItemIds: {}, pendingDossierOrders: {} });
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
  vi.clearAllMocks();
  appStore.setState({ lastSyncError: null });
  toast = null;
  unregister = registerUndoToastListener((t) => { toast = t; });
});
afterEach(() => {
  // A toast left open keeps ticking into the next test's listener.
  toast?.onDismiss();
  unregister();
});

describe('DossierDetailView — the page by act', () => {
  it('names each act once, in the order the acts entered, with its articles by number', () => {
    renderView();
    expect(screen.getAllByRole('heading', { name: `${L247} 2 articoli` })).toHaveLength(1);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '');
    expect(headings.filter((h) => h.startsWith('l. '))).toEqual([`${L247}2 articoli`, `${L49}1 articolo`]);
    const block = screen.getByRole('region', { name: L247 });
    expect(within(block).getAllByText(/^art\. \d+$/).map((el) => el.textContent)).toEqual(['art. 1', 'art. 3']);
  });

  it('takes the dossier\'s title as the page\'s h1', () => {
    renderView();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(dossier.title);
  });

  it('puts the notes above the acts', () => {
    renderView();
    const notes = screen.getByRole('region', { name: /Note \(1\)/ });
    expect(within(notes).getByText('Verificare la decorrenza')).toBeInTheDocument();
    const firstAct = screen.getByRole('region', { name: L247 });
    expect(notes.compareDocumentPosition(firstAct) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows its tags with a capital letter, as typed past the first (D1)', () => {
    renderView({ ...dossier, tags: ['accesso', 'GDPR'] });
    expect(screen.getByText('Accesso')).toBeInTheDocument();
    expect(screen.getByText('GDPR')).toBeInTheDocument();
    expect(appStore.getState().dossiers[0].tags).toEqual(['accesso', 'GDPR']);
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

  it("removes a whole act as one trash entry behind one undo toast, and «Annulla» restores it (question 181)", async () => {
    const { rerender } = renderView();
    fireEvent.click(screen.getByRole('button', { name: `Azioni su ${L247}` }));
    fireEvent.click(screen.getByRole('menuitem', { name: "Rimuovi l'atto dal dossier" }));
    await waitFor(() => expect(toast?.message).toBe('2 articoli rimossi'));
    // One call for the act's articles, none of the others.
    expect(dossierService.trashItems).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dossierService.trashItems).mock.calls[0][0]).toBe('d1');
    expect([...vi.mocked(dossierService.trashItems).mock.calls[0][1]].sort()).toEqual(['a1', 'a3']);
    expect(appStore.getState().dossiers[0].items.map((i) => i.id)).toEqual(['b1', 'n1']);
    rerender();
    expect(screen.queryByRole('region', { name: L247 })).toBeNull();
    // The server has them back, with their own ids: the page reads the dossier again.
    vi.mocked(dossierService.getById).mockResolvedValueOnce({
      id: 'd1', name: 'Ricorso Rossi', is_pinned: false, created_at: '', updated_at: '', tags: [],
      items: ['a1', 'a3', 'b1', 'n1'].map((id) => ({ id, item_type: 'note' as const, title: 'Nota', content: id, position: 0, status: 'unread' as const, created_at: '' })),
    });
    await act(async () => { await toast?.onUndo(); });
    expect(trashService.restore).toHaveBeenCalledWith('t1');
    expect(dossierService.getById).toHaveBeenCalledWith('d1');
    // Back where they were (the dossier's order before the removal), not where the server appended them.
    expect(appStore.getState().dossiers[0].items.map((i) => i.id)).toEqual(['a3', 'b1', 'a1', 'n1']);
  });

  it('removes a note in one call, and the page trash is read again after the move and after «Annulla»', async () => {
    const reload = vi.fn();
    appStore.setState({ dossiers: [structuredClone(dossier)], pendingDossierItemIds: {}, pendingDossierOrders: {} });
    const trash = { entries: [], error: null, reload, restore: vi.fn(), purge: vi.fn() };
    render(<MemoryRouter><DossierDetailView dossier={appStore.getState().dossiers[0]} onBack={() => {}} showToast={() => {}} trash={trash} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi nota' }));
    await waitFor(() => expect(toast?.message).toBe('Elemento rimosso'));
    expect(dossierService.trashItems).toHaveBeenCalledWith('d1', ['n1']);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.mocked(dossierService.getById).mockResolvedValueOnce({ id: 'd1', name: 'Ricorso Rossi', is_pinned: false, created_at: '', updated_at: '', tags: [], items: [] });
    await act(async () => { await toast?.onUndo(); });
    expect(trashService.restore).toHaveBeenCalledWith('t1');
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('a multiple selection is one call and one trash entry, with no confirmation: «Annulla» puts it back (K1a)', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Altre azioni' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Seleziona elementi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Seleziona tutti' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(toast?.message).toBe('3 elementi rimossi'));
    expect(dossierService.trashItems).toHaveBeenCalledTimes(1);
    expect([...vi.mocked(dossierService.trashItems).mock.calls[0][1]].sort()).toEqual(['a1', 'a3', 'b1']);
    expect(appStore.getState().dossiers[0].items.map((i) => i.id)).toEqual(['n1']);
  });

  it('refused by the server: everything is back, with an error and no toast', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(dossierService.trashItems).mockRejectedValueOnce(new Error('down'));
    renderView();
    fireEvent.click(screen.getByRole('button', { name: `Azioni su ${L247}` }));
    fireEvent.click(screen.getByRole('menuitem', { name: "Rimuovi l'atto dal dossier" }));
    await waitFor(() => expect(appStore.getState().lastSyncError?.message).toBe('Impossibile rimuovere dal dossier. Riprova.'));
    expect(appStore.getState().dossiers[0].items.map((i) => i.id)).toEqual(['a3', 'b1', 'a1', 'n1']);
    expect(toast).toBeNull();
    error.mockRestore();
  });

  it('filters by the act, and turns dragging off while filtering', () => {
    renderView();
    expect(screen.getByRole('button', { name: `Sposta ${L247}` })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Cerca negli elementi del dossier' }), { target: { value: '21 aprile' } });
    expect(screen.queryByRole('region', { name: L247 })).toBeNull();
    expect(screen.getByRole('region', { name: L49 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Sposta ${L49}` })).toBeNull();
  });

  it('reads the title of the whole act while the search shows part of it', () => {
    renderView();
    fireEvent.change(screen.getByRole('textbox', { name: 'Cerca negli elementi del dossier' }), { target: { value: 'art. 3' } });
    const block = screen.getByRole('region', { name: L247 });
    expect(within(block).getAllByText(/^art\. \d+$/).map((el) => el.textContent)).toEqual(['art. 3']);
    // The act's title and rubriche are asked for both its articles, so the search reads nothing again.
    const last = actDetailsAskedFor.filter((b) => b.key === 'legge|247|2012-12-31').at(-1);
    expect(last?.articles).toHaveLength(2);
  });
});

describe('DossierDetailView — decisions', () => {
  const CITATION = 'Corte cost., sent. 13 gennaio 2014, n. 1';
  // Stored with a label of an older style: the page shows the citation recomputed (source convention, Q9).
  const withDecision: Dossier = { ...dossier, items: [...dossier.items,
    { id: 's1', type: 'sentenza', addedAt: '', data: { corte: 'corte_costituzionale', numero: 1, anno: 2014, tipo: 'sentenza', data_deposito: '2014-01-13', etichetta: 'Corte cost. 1/2014' } }] };

  it('lists a decision under «Giurisprudenza», after the acts, never among the notes', () => {
    renderView(withDecision);
    const decisions = screen.getByRole('region', { name: 'Giurisprudenza (1)' });
    expect(within(decisions).getByRole('link', { name: CITATION })).toHaveAttribute('href', '/sentenze/corte-costituzionale/1/2014');
    expect(within(screen.getByRole('region', { name: /Note \(1\)/ })).queryByText(CITATION)).toBeNull();
    const lastAct = screen.getByRole('region', { name: L49 });
    expect(lastAct.compareDocumentPosition(decisions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Not a note: the header's count of decisions comes with the dossier-by-act round's PR 3.
    expect(screen.getByText(/2 atti · 3 articoli · 1 nota/)).toBeInTheDocument();
  });

  it('finds a decision by its citation', () => {
    renderView(withDecision);
    fireEvent.change(screen.getByRole('textbox', { name: 'Cerca negli elementi del dossier' }), { target: { value: '13 gennaio 2014' } });
    expect(screen.getByRole('region', { name: 'Giurisprudenza (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: L247 })).toBeNull();
  });

  it('removes a decision behind the undo toast; «Annulla» restores the trash entry, the decision with its own id', async () => {
    renderView(withDecision);
    fireEvent.click(screen.getByRole('button', { name: `Rimuovi ${CITATION} dal dossier` }));
    await waitFor(() => expect(toast?.message).toBe('Elemento rimosso'));
    expect(dossierService.trashItems).toHaveBeenCalledWith('d1', ['s1']);
    expect(appStore.getState().dossiers[0].items.map((i) => i.id)).not.toContain('s1');
    vi.mocked(dossierService.getById).mockResolvedValueOnce({
      id: 'd1', name: 'Ricorso Rossi', is_pinned: false, created_at: '', updated_at: '', tags: [],
      items: [{ id: 's1', item_type: 'sentenza', title: CITATION, content: withDecision.items[4].data as never, position: 0, status: 'unread', created_at: '' }],
    });
    await act(async () => { await toast?.onUndo(); });
    expect(trashService.restore).toHaveBeenCalledWith('t1');
    expect(dossierService.addItem).not.toHaveBeenCalled();
    expect(appStore.getState().dossiers[0].items.filter((i) => i.type === 'sentenza').map((i) => i.id)).toEqual(['s1']);
  });
});

describe('DossierDetailView — notes about an article', () => {
  it('shows a note about an article with it, not among the free notes', () => {
    const withNote = structuredClone(dossier);
    withNote.items.push({ id: 'n2', type: 'note', addedAt: '', data: 'Sul primo articolo.', aboutItemId: 'a1', createdBy: { clientName: 'Claude Code' } });
    appStore.setState({ dossiers: [withNote], pendingDossierItemIds: {}, pendingDossierOrders: {} });
    render(<MemoryRouter><DossierDetailView dossier={withNote} onBack={() => {}} showToast={() => {}} /></MemoryRouter>);
    const notes = screen.getByRole('region', { name: /Note \(1\)/ });
    expect(within(notes).queryByText('Sul primo articolo.')).toBeNull();
    expect(screen.getByTitle('1 nota')).toBeInTheDocument();
    expect(screen.getByText(/2 atti · 3 articoli · 2 note/)).toBeInTheDocument();
  });

  it('writes a note to the dossier through the notes route', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Nota' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Testo della nota' }), { target: { value: 'Nuova nota' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi al dossier' }));
    await waitFor(() => expect(dossierService.addNote).toHaveBeenCalledWith('d1', { text: 'Nuova nota' }));
    await waitFor(() => expect(appStore.getState().dossiers[0].items.some((i) => i.id === 'srv-note')).toBe(true));
  });
});

describe('DossierDetailView — search keeps an article and its notes together', () => {
  const withNote = (): Dossier => {
    const d = structuredClone(dossier);
    d.items.push({ id: 'n2', type: 'note', addedAt: '', data: 'Termine di decadenza.', aboutItemId: 'b1' });
    return d;
  };
  it('a note found keeps its article on screen, with the note under it', () => {
    const d = withNote();
    appStore.setState({ dossiers: [d], pendingDossierItemIds: {}, pendingDossierOrders: {} });
    render(<MemoryRouter><DossierDetailView dossier={d} onBack={() => {}} showToast={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Cerca negli elementi del dossier' }), { target: { value: 'decadenza' } });
    expect(screen.getByRole('region', { name: L49 })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Note \(/ })).toBeNull();
  });
  it('the closed row names its notes for a screen reader', () => {
    const d = withNote();
    appStore.setState({ dossiers: [d], pendingDossierItemIds: {}, pendingDossierOrders: {} });
    render(<MemoryRouter><DossierDetailView dossier={d} onBack={() => {}} showToast={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /^Espandi .*articolo 1, 1 nota$/ })).toBeInTheDocument();
  });
});

describe('DossierDetailView — what Claude removed from it', () => {
  it("shows only this dossier's entries, never another dossier's or study cards", () => {
    const at = { clientName: 'Claude Code', byApplication: true, deletedAt: '2026-10-04T10:00:00Z', expiresAt: '2026-11-03T10:00:00Z' };
    const trash = {
      entries: [
        { ...at, id: 'mine', kind: 'DOSSIER_ITEMS' as const, dossierId: 'd1', label: 'Ricorso Rossi', itemCount: 1, items: [{ itemType: 'note', citation: null, actCitation: null }] },
        { ...at, id: 'other', kind: 'DOSSIER_ITEMS' as const, dossierId: 'd2', label: 'Altro', itemCount: 1, items: [] },
        { ...at, id: 'cards', kind: 'LINGO_CARDS' as const, dossierId: null, label: 'Schede di studio', itemCount: 1, cards: [] },
      ],
      error: null, reload: vi.fn(), restore: vi.fn(), purge: vi.fn(),
    };
    appStore.setState({ dossiers: [structuredClone(dossier)], pendingDossierItemIds: {}, pendingDossierOrders: {} });
    render(<MemoryRouter><DossierDetailView dossier={dossier} onBack={() => {}} showToast={() => {}} trash={trash} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Rimossi di recente (1) — ripristina' })).toBeInTheDocument();
  });
});

describe('DossierDetailView — «Esporta → PDF»', () => {
  const withDecisions: Dossier = { ...dossier, items: [...dossier.items,
    { id: 's1', type: 'sentenza', addedAt: '', data: { corte: 'corte_costituzionale', numero: 1, anno: 2014, tipo: 'sentenza', data_deposito: '2014-01-13', etichetta: 'x' } },
    { id: 's2', type: 'sentenza', addedAt: '', data: { corte: 'corte_costituzionale', numero: 2, anno: 2015, tipo: 'sentenza', data_deposito: '2015-01-13', etichetta: 'x' } }] };
  const showToast = vi.fn();

  const open = (d: Dossier) => {
    appStore.setState({ dossiers: [structuredClone(d)], pendingDossierItemIds: {}, pendingDossierOrders: {} });
    render(<MemoryRouter><DossierDetailView dossier={d} onBack={() => {}} showToast={showToast} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Esporta' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'PDF' }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    pdf.built.length = 0;
    pdf.written.length = 0;
    pdf.loadDossierTexts.mockImplementation(async (_items: unknown, progress: (d: number, t: number) => void) => { progress(3, 3); return new Map(); });
    pdf.loadDossierDecisions.mockImplementation(async (_items: unknown, _ids: unknown, progress: (d: number, t: number) => void) => { progress(0, 0); return new Map(); });
    pdf.loadPdfMarks.mockResolvedValue(new Map());
  });

  it('opens the dialog instead of downloading', () => {
    open(dossier);
    expect(screen.getByRole('dialog', { name: 'Esporta in PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Sentenze' })).toBeNull();
    expect(pdf.loadDossierTexts).not.toHaveBeenCalled();
    expect(pdf.save).not.toHaveBeenCalled();
  });

  it('lists the dossier\'s decisions by their citation', () => {
    open(withDecisions);
    const group = screen.getByRole('group', { name: 'Sentenze' });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(group).getByRole('checkbox', { name: 'Corte cost., sent. 13 gennaio 2014, n. 1' })).toBeChecked();
  });

  it('exports the full text with every decision by default, saves the file and closes the dialog', async () => {
    open(withDecisions);
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalledWith('Ricorso_Rossi.pdf'));
    expect(pdf.loadDossierDecisions).toHaveBeenCalledWith(expect.any(Array), new Set(['s1', 's2']), expect.any(Function));
    expect(pdf.loadPdfMarks).toHaveBeenCalledWith(expect.any(Array), { articles: false, decisionIds: new Set(['s1', 's2']) });
    expect(pdf.built[0][3]).toMatchObject({ excerpts: false });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('prints the tags as stored: the PDF is a document, not the screen (D1)', async () => {
    open({ ...dossier, tags: ['accesso', 'GDPR'] });
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalled());
    expect(pdf.written[0][0]).toMatchObject({ tags: ['accesso', 'GDPR'] });
  });

  it('passes the choices on: only the marked passages, and not the decision left out', async () => {
    open(withDecisions);
    fireEvent.click(screen.getByRole('radio', { name: 'Solo le parti evidenziate e annotate' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Corte cost., sent. 13 gennaio 2014, n. 1' }));
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalled());
    expect(pdf.loadDossierDecisions).toHaveBeenCalledWith(expect.any(Array), new Set(['s2']), expect.any(Function));
    expect(pdf.loadPdfMarks).toHaveBeenCalledWith(expect.any(Array), { articles: true, decisionIds: new Set(['s2']) });
    expect(pdf.built[0][3]).toMatchObject({ excerpts: true });
  });

  it('counts the decisions it could not read among the unavailable texts', async () => {
    pdf.loadDossierDecisions.mockResolvedValue(new Map([['s1', null], ['s2', null]]));
    pdf.loadDossierTexts.mockResolvedValue(new Map([
      ['a1', { text: 'uno' }], ['a3', { text: 'tre' }], ['b1', { text: 'due' }],
    ]));
    open(withDecisions);
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('PDF salvato: 2 testi non disponibili', 'info'));
  });

  it('keeps the dialog open and says so when the PDF cannot be made', async () => {
    pdf.loadDossierTexts.mockRejectedValue(new Error('down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    open(dossier);
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Impossibile creare il PDF del dossier', 'error'));
    expect(screen.getByRole('dialog', { name: 'Esporta in PDF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Scarica PDF/ })).toBeEnabled();
    error.mockRestore();
  });
});

describe('DossierDetailView — an import from the act\'s index (K1a)', () => {
  const importing = async (count: number) => {
    tree.count = count;
    const addToDossier = vi.fn();
    appStore.setState({ addToDossier });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Articoli da una norma' }));
    fireEvent.click(screen.getByRole('button', { name: "importa dall'indice" }));
    return addToDossier;
  };

  it('a few articles go in at once', async () => {
    const addToDossier = await importing(3);
    expect(addToDossier).toHaveBeenCalledTimes(3);
    expect(toast).toBeNull();
  });

  it('more than a hundred ask no question, and write nothing until the notification is gone', async () => {
    const addToDossier = await importing(150);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(toast?.message).toBe('150 articoli verranno importati nel dossier'));
    expect(addToDossier).not.toHaveBeenCalled();
    await act(async () => { toast?.onDismiss(); });
    await waitFor(() => expect(addToDossier).toHaveBeenCalledTimes(150));
  });

  it('«Annulla» leaves the dossier as it was: nothing was written', async () => {
    const addToDossier = await importing(150);
    await waitFor(() => expect(toast).not.toBeNull());
    await act(async () => { await toast?.onUndo(); });
    expect(addToDossier).not.toHaveBeenCalled();
  });

  it('writes nothing into a dossier deleted while it waited, and says so', async () => {
    const addToDossier = await importing(150);
    await waitFor(() => expect(toast).not.toBeNull());
    appStore.setState({ dossiers: [] });
    await act(async () => { toast?.onDismiss(); });
    expect(addToDossier).not.toHaveBeenCalled();
    expect(appStore.getState().lastSyncError?.message).toBe('Nessun articolo importato: il dossier «Ricorso Rossi» non c’è più.');
  });

  it('asks before leaving the page while an import waits, and no more once it is written', async () => {
    await importing(150);
    await waitFor(() => expect(toast).not.toBeNull());
    const leaving = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leaving()).toBe(true);
    await act(async () => { toast?.onDismiss(); });
    expect(leaving()).toBe(false);
  });
});

// A dossier's page in the planner's shape (S7c).
describe('DossierDetailView — in the frame, in the planner\'s shape (S7c)', () => {
  it('titles the page with the dossier\'s name in the reader\'s serif, no icon, its section\'s phrase over it', () => {
    renderView({ ...dossier, kind: 'studio', description: 'Ricorso in appello' });
    const title = screen.getByRole('heading', { level: 1, name: dossier.title });
    expect(title).toHaveClass('font-serif');
    expect(title.querySelector('svg')).toBeNull();
    // A name of one long word wraps rather than widening the page.
    expect(title.firstElementChild).toHaveClass('[overflow-wrap:anywhere]');
    expect(title).toHaveAccessibleDescription('Gymnasium · la tua palestra giuridica');
    expect(screen.getByText('Ricorso in appello')).toBeInTheDocument();
  });

  it('draws the header\'s actions in one row under the title, every one 44 px', () => {
    renderView();
    const open = screen.getByRole('button', { name: 'Apri tutto su Dashboard' });
    const row = open.parentElement!;
    for (const name of ['Aggiungi', 'Esporta', 'Altre azioni']) expect(row).toContainElement(screen.getByRole('button', { name }));
    // Under the title, not beside it: a long name would be squeezed.
    expect(screen.getByRole('heading', { level: 1 }).closest('header')).not.toContainElement(open);
    expect(open).toHaveClass('min-h-[44px]');
    expect(screen.getByRole('button', { name: 'Aggiungi' })).toHaveClass('min-h-[44px]', 'min-w-[44px]');
    expect(screen.getByRole('button', { name: 'Altre azioni' })).toHaveClass('h-11', 'w-11');
    for (const button of within(row).getAllByRole('button')) expect(button.className).not.toMatch(/md:min-h-0/);
  });

  it('draws an article as a row of two levels — the article, a grey line, the signs — with 44 px controls', () => {
    renderView({
      ...dossier,
      items: [{ id: 'a3', type: 'norma', addedAt: '2026-10-12T08:00:00Z', actCitation: L247, data: { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', numero_articolo: '3' } }],
    });
    const block = screen.getByRole('region', { name: L247 });
    const title = within(block).getByText('art. 3');
    // No rubric read (the act's index is mocked empty): the grey line says when it was added.
    expect(within(block).getByText('Aggiunto il 12 ottobre 2026')).toHaveClass('text-[13px]');
    expect(title).toHaveClass('text-[15px]');
    expect(within(block).getByRole('button', { name: 'Segna come importante' })).toHaveClass('h-11', 'w-11');
    expect(within(block).getByRole('button', { name: 'Rimuovi articolo dal dossier' })).toHaveClass('h-11', 'w-11');
  });

  it('writes no grey line it cannot fill: no «Aggiunto il» without a date', () => {
    renderView();
    expect(screen.queryByText(/^Aggiunto il\s*$/)).toBeNull();
  });

  it('draws the free notes as rows: the words, then a grey line with the date, the removal at the right', () => {
    renderView();
    const notes = screen.getByRole('region', { name: /Note \(1\)/ });
    expect(within(notes).getByRole('heading', { level: 2 })).toHaveClass('font-serif');
    expect(within(notes).getByRole('heading', { level: 2 }).className).not.toMatch(/uppercase/);
    const words = within(notes).getByText('Verificare la decorrenza');
    const date = within(notes).getByText('4 ottobre 2026');
    // The date under the words, never beside them, so a phone's row keeps the note's width.
    expect(words.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(words.parentElement).toContainElement(date);
    expect(within(notes).getByRole('button', { name: 'Rimuovi nota' })).toHaveClass('h-11', 'w-11');
  });

  it('writes the search at 16 px at least on a phone, whatever the text size (Safari zooms under it)', () => {
    renderView(dossier);
    const search = screen.getByRole('textbox', { name: 'Cerca negli elementi del dossier' });
    expect(search).toHaveClass('text-[length:max(1rem,16px)]', 'md:text-sm');
    expect(search).not.toHaveClass('text-base');
  });
});
