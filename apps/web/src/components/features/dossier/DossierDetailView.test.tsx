import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// What each act block asks its title and rubriche for.
const actDetailsAskedFor = vi.hoisted(() => [] as { key: string; articles: unknown[] }[]);
// D7b's flag: asked as the dossier page mounts and as the app starts; off here, with no request leaving the test.
vi.mock('../../../services/assistantService', () => ({ assistantService: { features: vi.fn(async () => ({ assistantPassages: false })) } }));
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
    writeDossierPdf: async (...args: unknown[]) => { pdf.written.push(args); return { save: pdf.save }; },
  };
});
vi.mock('./dossierPdfMarks', () => ({ loadPdfMarks: pdf.loadPdfMarks }));
vi.mock('../../../utils/actStructureCache', () => ({ fetchActRubriche: async () => ({ title: 'Titolo' }) }));
// The act's index, reduced to what it hands over: this many articles of a law.
const tree = vi.hoisted(() => ({ count: 0 }));
vi.mock('./TreeNavigatorModal', () => ({
  TreeNavigatorModal: ({ open, onImport, onClose }: { open: boolean; onImport: (a: { numero: string }[], act: { tipo_atto: string; data: string; numero_atto: string }) => void; onClose: () => void }) => open && (
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

// The «Lettura» tab's own view (its tests: `DossierReadingView.test.tsx`): here, only when it is mounted.
// An article's row stands in as the reading draws it (`PracticeRowShell`): its key and the dossier entries it shows.
vi.mock('./DossierReadingView', () => ({ DossierReadingView: ({ dossier: shown }: { dossier: { id: string } }) => (
  <div data-testid="lettura">
    {shown.id}
    <div data-practice-row="p1/act/3" data-dossier-entries="a3"><button type="button" aria-expanded="false">art. 3</button></div>
  </div>
) }));
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
  it('takes the dossier\'s title as the page\'s h1', () => {
    renderView();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(dossier.title);
  });

  it('puts the dossier\'s notes in a group under the reading (LC86)', () => {
    renderView();
    const notes = screen.getByRole('region', { name: /Note \(1\)/ });
    expect(within(notes).getByText('Verificare la decorrenza')).toBeInTheDocument();
    expect(screen.getByTestId('lettura').compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows its tags with a capital letter, as typed past the first (D1)', () => {
    renderView({ ...dossier, tags: ['accesso', 'GDPR'] });
    expect(screen.getByText('Accesso')).toBeInTheDocument();
    expect(screen.getByText('GDPR')).toBeInTheDocument();
    expect(appStore.getState().dossiers[0].tags).toEqual(['accesso', 'GDPR']);
  });

  it('counts acts, articles and notes', () => {
    renderView();
    expect(screen.getByText(/2 fonti · 3 articoli · 1 nota/)).toBeInTheDocument();
  });

  it('has its actions and a menu in its header, and no selection bar until asked', () => {
    renderView();
    // LC60: the pratica is read in its «Lettura», never opened again in the Ricerca.
    expect(screen.queryByRole('button', { name: 'Apri tutto in Ricerca' })).toBeNull();
    for (const name of ['Aggiungi', 'Esporta', 'Altre azioni']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-haspopup', 'menu');
    }
    // LC86: the selection comes back on the one «Fonti» with PR 2.
    expect(screen.queryByText('Seleziona tutti')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Altre azioni' }));
    expect(screen.queryByRole('menuitem', { name: 'Seleziona elementi' })).toBeNull();
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
    expect(items('Altre azioni')).toEqual(['Modifica', 'Confronta versioni', 'Aggiungi ai preferiti', 'Elimina la pratica']);
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
});

describe('DossierDetailView — notes about an article', () => {
  it('writes a note to the dossier through the notes route', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Nota' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Testo della nota' }), { target: { value: 'Nuova nota' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi alla pratica' }));
    await waitFor(() => expect(dossierService.addNote).toHaveBeenCalledWith('d1', { text: 'Nuova nota' }));
    await waitFor(() => expect(appStore.getState().dossiers[0].items.some((i) => i.id === 'srv-note')).toBe(true));
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
    expect(screen.getByRole('button', { name: 'Rimossi di recente (1): ripristina' })).toBeInTheDocument();
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

  it('opens the space instead of downloading', () => {
    open(dossier);
    expect(screen.getByRole('region', { name: 'Esporta in PDF' })).toBeInTheDocument();
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

  it('exports the full text with every decision by default, saves the file and closes the space', async () => {
    open(withDecisions);
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalledWith('Ricorso_Rossi.pdf'));
    expect(pdf.loadDossierDecisions).toHaveBeenCalledWith(expect.any(Array), new Set(['s1', 's2']), expect.any(Function));
    expect(pdf.loadPdfMarks).toHaveBeenCalledWith(expect.any(Array), { articles: false, decisionIds: new Set(['s1', 's2']) });
    expect(pdf.built[0][3]).toMatchObject({ excerpts: false });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Esporta in PDF' })).toBeNull());
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

  it('keeps the space open and says so when the PDF cannot be made', async () => {
    pdf.loadDossierTexts.mockRejectedValue(new Error('down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    open(dossier);
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Impossibile creare il PDF della pratica', 'error'));
    expect(screen.getByRole('region', { name: 'Esporta in PDF' })).toBeInTheDocument();
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
    await waitFor(() => expect(toast?.message).toBe('150 articoli verranno importati nella pratica'));
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
    expect(appStore.getState().lastSyncError?.message).toBe('Nessun articolo importato: la pratica «Ricorso Rossi» non c’è più.');
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
    expect(title).toHaveAccessibleDescription('Learn');
    expect(screen.getByText('Ricorso in appello')).toBeInTheDocument();
  });

  it('draws the header\'s actions in one row under the title, 44 px on a phone (`Button`\'s heights, LC106)', () => {
    renderView();
    const open = screen.getByRole('button', { name: 'Aggiungi' });
    const row = open.closest('.flex-wrap') as HTMLElement;
    for (const name of ['Aggiungi', 'Esporta', 'Altre azioni']) expect(row).toContainElement(screen.getByRole('button', { name }));
    // Under the title, not beside it: a long name would be squeezed.
    expect(screen.getByRole('heading', { level: 1 }).closest('header')).not.toContainElement(open);
    expect(open).toHaveClass('min-h-11', 'min-w-11', 'rounded-md');
    expect(screen.getByRole('button', { name: 'Altre azioni' })).toHaveClass('min-h-11', 'min-w-11');
    for (const button of within(row).getAllByRole('button')) expect(button).toHaveClass('min-h-11');
  });

  it('keeps a long title clear of the actions: they come after the description and the facts, each label on one line (D3b)', () => {
    const title = 'Ransomware EVST – pagamento del riscatto e fondi pubblici, profili di responsabilità';
    renderView({ ...dossier, title, description: 'Richiesta di riscatto ricevuta il 3 ottobre' });
    const heading = screen.getByRole('heading', { level: 1, name: title });
    const open = screen.getByRole('button', { name: 'Aggiungi' });
    const row = open.closest('.flex-wrap') as HTMLElement;
    // Nothing beside the title: the header holds only the section's phrase, the title and the description.
    expect(heading.closest('header')!.querySelector('button')).toBeNull();
    // After the line of the facts.
    expect(screen.getByText(/creata il/).compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The row wraps as a row when the window is narrow, never a label inside its button.
    expect(row).toHaveClass('flex-wrap');
    const buttons = ['Aggiungi', 'Esporta', 'Pubblica nel Forum'].map((name) => screen.getByRole('button', { name }));
    for (const button of buttons) expect(button).toHaveClass('whitespace-nowrap');
    expect(row.lastElementChild).toContainElement(screen.getByRole('button', { name: 'Altre azioni' }));
  });

  it('keeps the Forum\'s label on one line once the dossier is published (D3b)', () => {
    renderView({ ...dossier, published: { sharedEnvironmentId: 'e1', version: 3, isActive: true, updatedAt: '' } });
    expect(screen.getByRole('button', { name: 'Forum: Nel Forum · v3' })).toHaveClass('whitespace-nowrap', 'min-h-11');
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
    // `IconButton size="lg"`: 44 px square at every width.
    expect(within(notes).getByRole('button', { name: 'Rimuovi nota' })).toHaveClass('min-h-11', 'min-w-11');
    expect(within(notes).getByRole('button', { name: 'Rimuovi nota' }).className).not.toMatch(/md:min-[hw]-/);
    // A box that holds: `Card`, 8 px.
    expect(notes).toHaveClass('rounded-[8px]');
  });
});

describe('DossierDetailView — one «Fonti» for the sources and the reading (LC86)', () => {
  afterEach(() => { window.history.replaceState(null, '', '/'); });

  it('offers four views in order: Fonti, Atti, Compiti, Cronologia; the narrow padding keeps them whole on a phone', () => {
    renderView();
    const tabs = within(screen.getByRole('tablist', { name: 'Viste della pratica' })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent?.replace(/\d+/g, '').trim())).toEqual(['Fonti', 'Atti', 'Compiti', 'Cronologia']);
    for (const tab of tabs) expect(tab).toHaveClass('px-2.5', 'sm:px-4');
  });

  it('opens on «Fonti», which is the reading of the page\'s dossier, kept mounted under the other views', () => {
    renderView();
    expect(screen.getByRole('tab', { name: /^Fonti/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('lettura')).toHaveTextContent('d1');
    fireEvent.click(screen.getByRole('tab', { name: 'Compiti' }));
    expect(screen.getByTestId('lettura')).not.toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: /^Fonti/ }));
    expect(screen.getByTestId('lettura')).toBeVisible();
  });

  it('takes the old `?vista=lettura` to «Fonti», with the reading; `?vista=atti` still opens on the acts', () => {
    window.history.replaceState(null, '', '/pratiche?dossier=d1&vista=lettura');
    const { unmount } = render(<MemoryRouter><DossierDetailView dossier={dossier} onBack={() => {}} showToast={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('tab', { name: /^Fonti/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('lettura')).toBeVisible();
    unmount();
    window.history.replaceState(null, '', '/pratiche?dossier=d1&vista=atti');
    renderView();
    expect(screen.getByRole('tab', { name: /^Atti/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('lets the tabs scroll away in «Fonti», where the act\'s head sticks (#529), and keeps them at the top in the others', () => {
    renderView();
    const bar = () => screen.getByRole('tablist', { name: 'Viste della pratica' }).closest('div.-mx-2');
    expect(bar()).not.toHaveClass('sticky');
    fireEvent.click(screen.getByRole('tab', { name: 'Compiti' }));
    expect(bar()).toHaveClass('sticky');
    fireEvent.click(screen.getByRole('tab', { name: /^Fonti/ }));
    expect(bar()).not.toHaveClass('sticky');
  });

  it('draws nothing over the content (L-73): no dialog on the page', () => {
    renderView();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each([
    ['Aggiungi', 'Articoli da una norma', 'Importa articoli da norma'],
    ['Aggiungi', 'Nota', 'Aggiungi una nota alla pratica'],
    ['Esporta', 'PDF', 'Esporta in PDF'],
  ])('opens «%s → %s» under the header, in the page, and Esc gives the focus back to its menu (LC125)', (menu, item, name) => {
    renderView();
    const trigger = screen.getByRole('button', { name: menu });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: item }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // The tree's own component is mocked here (its tests: `TreeNavigatorModal.test.tsx`): the others are the real ones.
    if (item === 'Articoli da una norma') {
      expect(screen.getByRole('button', { name: "importa dall'indice" })).toBeInTheDocument();
      return;
    }
    const region = screen.getByRole('region', { name });
    expect(region).toHaveFocus();
    expect(trigger.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.compareDocumentPosition(screen.getByRole('tablist', { name: 'Viste della pratica' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(screen.queryByRole('region', { name })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('opens «Pubblica nel Forum» under the header, in the page, and Esc gives the focus back to it (LC125)', () => {
    renderView();
    const command = screen.getByRole('button', { name: 'Pubblica nel Forum' });
    command.focus();
    fireEvent.click(command);
    expect(command).toHaveAttribute('aria-expanded', 'true');
    const region = screen.getByRole('region', { name: 'Pubblica nel Forum' });
    expect(region).toHaveFocus();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(region.compareDocumentPosition(screen.getByRole('tablist', { name: 'Viste della pratica' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Pubblica nel Forum' })).toBeNull();
    expect(command).toHaveFocus();
  });

  it('opens «Modifica» under the header, in the page, and Esc gives the focus back to its menu (LC107)', () => {
    renderView();
    const more = screen.getByRole('button', { name: 'Altre azioni' });
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Modifica' }));
    const region = screen.getByRole('region', { name: 'Modifica pratica' });
    expect(region).toHaveFocus();
    expect(screen.queryByRole('dialog')).toBeNull();
    // Under the header's actions, before the dossier's views.
    expect(more.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.compareDocumentPosition(screen.getByRole('tablist', { name: 'Viste della pratica' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Titolo' })).toHaveValue(dossier.title);
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Modifica pratica' })).toBeNull();
    expect(more).toHaveFocus();
  });

  it('an empty dossier says so, with its two ways to fill it', () => {
    renderView({ ...dossier, items: [] });
    expect(screen.getByText('Pratica vuota')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerca articoli' })).toBeInTheDocument();
    expect(screen.queryByTestId('lettura')).toBeNull();
  });

  it('opens nothing in the Ricerca (LC60)', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Altre azioni' }));
    expect(screen.queryByRole('menuitem', { name: 'Apri anche in Ricerca' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apri tutto in Ricerca' })).toBeNull();
  });
});

describe('DossierDetailView — «Cronologia» (LC137)', () => {
  const dated: Dossier = {
    ...dossier,
    items: [
      ...dossier.items,
      { id: 'n2', type: 'note', addedAt: '2026-11-01T09:00:00Z', data: '12/03/2025 — Notifica della diffida' },
      { id: 'n3', type: 'note', addedAt: '2026-11-02T09:00:00Z', data: '**2024-06-30**: firma del contratto' },
      { id: 'n4', type: 'note', addedAt: '2026-11-03T09:00:00Z', aboutItemId: 'a3', data: '01/02/2023 — Termine dell\'art. 3' },
      { id: 's1', type: 'sentenza', addedAt: '', data: { corte: 'cassazione', archivio: 'civile', numero: 123, anno: 2024, data_deposito: '2024-09-15', etichetta: 'Cass. civ., n. 123/2024' } },
    ],
  };

  it('shows the dated facts by year, oldest first, in the page under the tabs, never in a dialog', () => {
    renderView(dated);
    fireEvent.click(screen.getByRole('tab', { name: 'Cronologia' }));
    // One list, the years its headings: no card or region per year (LC145).
    expect(screen.queryByRole('region', { name: /^\d{4} / })).toBeNull();
    const y2024 = screen.getByRole('list', { name: '2024 (2)' });
    const y2025 = screen.getByRole('list', { name: '2025 (1)' });
    expect(screen.getByRole('heading', { level: 2, name: '2024 (2)' })).toBeInTheDocument();
    expect(y2024.closest('.bg-card')).toBe(y2025.closest('.bg-card'));
    expect(screen.getByRole('list', { name: '2023 (1)' }).compareDocumentPosition(y2024) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(y2024.compareDocumentPosition(y2025) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(y2024).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('firma del contratto'),
      expect.stringContaining('Cass. civ., n. 123/2024'),
    ]);
    expect(within(y2024).getByText(/30 giugno 2024/).closest('span')).toHaveTextContent('Nota');
    expect(within(y2024).getByText(/15 settembre 2024/).closest('span')).toHaveTextContent('Sentenza');
    expect(screen.getByText(/1 nota senza data non compare/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    // One command per fact, the row itself, named by the fact; no repeated link under each.
    expect(screen.queryByRole('button', { name: 'Apri nella pratica' })).toBeNull();
    expect(screen.getByRole('button', { name: '12 marzo 2025, Nota: Notifica della diffida — apri nella pratica' })).toHaveClass('min-h-11', 'w-[calc(100%+1rem)]');
    // The toggle says the order a press gives.
    fireEvent.click(screen.getByRole('button', { name: 'Dal più recente' }));
    expect(screen.getAllByRole('list', { name: /^\d{4} / }).map((r) => r.getAttribute('aria-labelledby'))).toEqual(['chronology-2025', 'chronology-2024', 'chronology-2023']);
    fireEvent.click(screen.getByRole('button', { name: 'Dal più vecchio' }));
    expect(screen.getAllByRole('list', { name: /^\d{4} / })[0]).toHaveAccessibleName('2023 (1)');
  });

  it('opens a note in «Fonti», clearing the filter, the focus on its row', () => {
    renderView(dated);
    fireEvent.change(screen.getByLabelText('Filtra le fonti della pratica'), { target: { value: 'decorrenza' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Cronologia' }));
    fireEvent.click(screen.getByRole('button', { name: /^12 marzo 2025, Nota/ }));
    expect(screen.getByRole('tab', { name: /^Fonti/ })).toHaveAttribute('aria-selected', 'true');
    const note = document.querySelector('[data-dossier-entry="n2"]')!;
    expect(note).toBeVisible();
    expect(screen.getByLabelText('Filtra le fonti della pratica')).toHaveValue('');
    expect(document.activeElement).toBe(note);
    // The rows' shared focus ring, not the browser's outline.
    expect(note).toHaveClass('focus-visible:ring-2', 'focus-visible:outline-none');
  });

  it('opens the article\'s row for a note about it, the focus on the row\'s toggle', () => {
    renderView(dated);
    fireEvent.click(screen.getByRole('tab', { name: 'Cronologia' }));
    fireEvent.click(screen.getByRole('button', { name: /^1 febbraio 2023, Nota/ }));
    expect(appStore.getState().practiceRows['p1/act/3']).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'art. 3' }));
  });

  it('says how dates are read when nothing has one', () => {
    renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'Cronologia' }));
    expect(screen.getByText(/Le note che iniziano con una data, come 12\/03\/2025/)).toBeVisible();
    expect(screen.getByText('1 nota senza data non compare.')).toBeVisible();
  });

  it('is not offered in a pratica di studio', () => {
    renderView({ ...dated, kind: 'studio' });
    expect(screen.queryByRole('tab', { name: 'Cronologia' })).toBeNull();
  });
});
