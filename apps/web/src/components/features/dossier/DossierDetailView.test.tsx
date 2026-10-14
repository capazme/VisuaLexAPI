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
}));
vi.mock('./dossierPdf', async (importOriginal) => {
  const real = await importOriginal<typeof import('./dossierPdf')>();
  return {
    ...real,
    loadDossierTexts: pdf.loadDossierTexts,
    loadDossierDecisions: pdf.loadDossierDecisions,
    buildPdfBlocks: (...args: Parameters<typeof real.buildPdfBlocks>) => { pdf.built.push(args); return real.buildPdfBlocks(...args); },
    writeDossierPdf: () => ({ save: pdf.save }),
  };
});
vi.mock('./dossierPdfMarks', () => ({ loadPdfMarks: pdf.loadPdfMarks }));
vi.mock('../../../utils/actStructureCache', () => ({ fetchActRubriche: async () => ({ title: 'Titolo' }) }));
vi.mock('./DossierItemReader', () => ({ DossierItemReader: () => null }));
vi.mock('../../../services/dossierService', () => ({
  dossierService: {
    getSnapshots: vi.fn(async () => []),
    // A fresh id per call, as the server gives.
    addItem: vi.fn(async () => ({ id: `srv-${Math.random().toString(36).slice(2)}`, item_type: 'norm', title: '', content: {}, position: 0, status: 'unread', created_at: '' })),
    deleteItem: vi.fn(async () => {}),
    updateItem: vi.fn(async () => ({})),
    reorderItems: vi.fn(async () => {}),
    addNote: vi.fn(async (_d: string, body: { text: string; aboutItemId?: string }) => ({
      id: 'srv-note', item_type: 'note', title: 'Nota', content: body.text, position: 9, status: 'unread', created_at: '2026-10-04T12:00:00Z',
      about_item_id: body.aboutItemId ?? null, created_by: null,
    })),
  },
}));

import { appStore } from '../../../store/useAppStore';
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

  it('removes a decision behind the undo toast, and puts it back as a decision', async () => {
    renderView(withDecision);
    fireEvent.click(screen.getByRole('button', { name: `Rimuovi ${CITATION} dal dossier` }));
    await waitFor(() => expect(toast?.message).toBe('Elemento rimosso'));
    expect(appStore.getState().dossiers[0].items.map((i) => i.id)).not.toContain('s1');
    await act(async () => { await toast?.onUndo(); });
    expect(dossierService.addItem).toHaveBeenLastCalledWith('d1', expect.objectContaining({ itemType: 'sentenza', title: CITATION }));
    expect(appStore.getState().dossiers[0].items.filter((i) => i.type === 'sentenza')).toHaveLength(1);
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
