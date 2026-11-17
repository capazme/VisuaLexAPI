import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { appStore } from '../../../store/useAppStore';
import { DossierListView } from './DossierListView';
import { registerUndoToastListener, type UndoToast } from '../../../hooks/useUndoableAction';
import { resetNotifications } from '../../ui/notifications/notifications';
import { sectionStore } from '../../../features/sections/useSection';
import type { Dossier, NormaVisitata } from '../../../types';
import { CARD_GRID_COLUMNS } from '../../layout/frame';

// The list's viewport (`useIsDesktop`): a phone, as jsdom's matchMedia shim says, unless a test says otherwise.
const viewport = vi.hoisted(() => ({ desktop: false }));
vi.mock('../../../hooks/useIsDesktop', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/useIsDesktop')>()),
  useIsDesktop: () => viewport.desktop,
}));

const CIVIL: NormaVisitata = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1284' };
const PENAL: NormaVisitata = { tipo_atto: 'codice penale', numero_atto: '1398', data: '1930-10-19', numero_articolo: '575' };

const dossier = (data: NormaVisitata[]): Dossier => ({
  id: 'd1', title: 'Pratica Rossi', createdAt: '2026-08-01T10:00:00.000Z',
  items: data.map((d, i) => ({ id: `i${i}`, type: 'norma' as const, data: d, addedAt: '2026-08-01T10:00:00.000Z' })),
});


beforeEach(() => {
  viewport.desktop = false;
  appStore.setState({ practices: [], activePracticeId: null, searchTrigger: null, searchQueue: [], isLoadingData: false });
  sectionStore.setState({ section: 'opus', dossierKind: 'lavoro' });
});

describe('DossierListView — the menu of a card', () => {
  it('opens, closes on Escape, and never opens the dossier', () => {
    const onSelect = vi.fn();
    appStore.setState({ dossiers: [dossier([CIVIL])], practices: [], activePracticeId: null, searchTrigger: null, searchQueue: [] });
    render(<MemoryRouter><DossierListView onSelect={onSelect} showToast={() => {}} /></MemoryRouter>);
    const trigger = screen.getByRole('button', { name: 'Azioni su Pratica Rossi' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Rinomina / Modifica' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('deletes with no confirmation: the dossier goes to the trash and the notification offers «Annulla» (K1a)', async () => {
    const deleteDossier = vi.fn().mockResolvedValue({ trashId: 't1', itemCount: 1 });
    appStore.setState({ dossiers: [dossier([CIVIL])], practices: [], activePracticeId: null, searchTrigger: null, searchQueue: [], deleteDossier });
    let shown: UndoToast | null = null;
    const unregister = registerUndoToastListener((t) => { shown = t; });
    try {
      render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
      fireEvent.click(screen.getByRole('button', { name: 'Azioni su Pratica Rossi' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(deleteDossier).toHaveBeenCalledWith('d1');
      await waitFor(() => expect(shown?.message).toBe('Pratica «Pratica Rossi» spostata nel cestino'));
    } finally {
      unregister();
      resetNotifications();
    }
  });
});

describe('DossierListView — a card names its acts', () => {
  it('lists the acts a dossier holds, and its notes', () => {
    appStore.setState({ dossiers: [{
      id: 'd1', title: 'Pratica Rossi', createdAt: '2026-08-01T10:00:00.000Z',
      items: [
        { id: 'a', type: 'norma', addedAt: '2026-08-01T10:00:00.000Z', actCitation: 'l. 31 dicembre 2012, n. 247', data: { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', numero_articolo: '3' } },
        { id: 'b', type: 'norma', addedAt: '2026-08-01T10:00:00.000Z', data: CIVIL },
        { id: 'n', type: 'note', addedAt: '2026-08-01T10:00:00.000Z', data: 'appunto' },
      ],
    }], practices: [], activePracticeId: null, searchTrigger: null, searchQueue: [] });
    render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
    expect(screen.getByText('l. 31 dicembre 2012, n. 247 · Codice civile')).toBeInTheDocument();
    expect(screen.getByText('1 nota')).toBeInTheDocument();
  });
});

describe('DossierListView — a card counts its decisions', () => {
  it('says how many decisions a dossier keeps, apart from its notes', () => {
    appStore.setState({ dossiers: [{
      id: 'd1', title: 'Pratica Rossi', createdAt: '2026-08-01T10:00:00.000Z',
      items: [
        { id: 'n', type: 'note', addedAt: '2026-08-01T10:00:00.000Z', data: 'appunto' },
        { id: 's', type: 'sentenza', addedAt: '2026-08-01T10:00:00.000Z', data: { corte: 'corte_costituzionale', numero: 1, anno: 2014, etichetta: 'x' } },
      ],
    }], practices: [], activePracticeId: null, searchTrigger: null, searchQueue: [] });
    render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
    expect(screen.getByText('1 nota')).toBeInTheDocument();
    expect(screen.getByText('1 sentenza')).toBeInTheDocument();
  });

  it('finds a dossier by the citation of a decision it keeps', () => {
    appStore.setState({ dossiers: [{
      id: 'd1', title: 'Pratica Rossi', createdAt: '2026-08-01T10:00:00.000Z',
      items: [{ id: 's', type: 'sentenza', addedAt: '', data: { corte: 'corte_costituzionale', numero: 1, anno: 2014, etichetta: 'x' } }],
    }], practices: [], activePracticeId: null, searchTrigger: null, searchQueue: [] });
    render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/cerca/i), { target: { value: 'corte cost.' } });
    expect(screen.getByText('Pratica Rossi')).toBeInTheDocument();
  });
});

describe('DossierListView — the trash', () => {
  it('shows «Cestino (n)» only when the trash holds something', () => {
    viewport.desktop = true;
    const onOpenTrash = vi.fn();
    appStore.setState({ dossiers: [dossier([CIVIL])], practices: [], activePracticeId: null, searchTrigger: null, searchQueue: [] });
    const { rerender } = render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} trashCount={0} onOpenTrash={onOpenTrash} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /Cestino/ })).toBeNull();
    rerender(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} trashCount={2} onOpenTrash={onOpenTrash} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Cestino (2)' }));
    expect(onOpenTrash).toHaveBeenCalledTimes(1);
  });
});

describe('DossierListView — dossiers di lavoro and di studio', () => {
  const kinds: Dossier[] = [
    { ...dossier([CIVIL]), id: 'w', title: 'Pratica Rossi', kind: 'lavoro' },
    { ...dossier([PENAL]), id: 's', title: 'Diritto penale', kind: 'studio', published: { sharedEnvironmentId: 'e1', version: 2, isActive: true, updatedAt: '2026-10-14' } },
    { ...dossier([]), id: 'o', title: 'Senza tipo' },
  ];
  const titles = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

  it("lists the section's kind: Opus the dossiers di lavoro (one with no kind among them), Gymnasium those di studio (sections spec S7)", () => {
    appStore.setState({ dossiers: kinds });
    sectionStore.setState({ section: 'opus', dossierKind: 'lavoro' });
    const { unmount } = render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
    // The page's name, its section's phrase over it (L-37): the section says the kind.
    expect(screen.getByRole('heading', { level: 1, name: 'Pratiche' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleDescription('Work');
    expect(titles().sort()).toEqual(['Pratica Rossi', 'Senza tipo']);
    // The kind filter is gone: the section is the filter.
    expect(screen.queryByRole('group', { name: 'Tipo di pratica' })).toBeNull();
    unmount();

    sectionStore.setState({ section: 'gymnasium', dossierKind: 'studio' });
    render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Pratiche' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleDescription('Learn');
    expect(titles()).toEqual(['Diritto penale']);
    expect(screen.getAllByText('Di studio', { selector: 'span' })).toHaveLength(1);
    expect(screen.getByText('Pubblicato nel Forum')).toBeInTheDocument();
  });

  it('says which kind is empty', () => {
    appStore.setState({ dossiers: [kinds[0]] });
    sectionStore.setState({ section: 'gymnasium', dossierKind: 'studio' });
    render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
    expect(screen.getByText('Nessuna pratica di studio')).toBeInTheDocument();
  });

  it('lists every dossier without Gymnasium (VITE_FEATURE_STUDIA off), or the study ones could not be reached', () => {
    vi.stubEnv('VITE_FEATURE_STUDIA', 'false');
    try {
      appStore.setState({ dossiers: kinds });
      render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
      expect(titles()).toHaveLength(3);
      expect(screen.getByRole('heading', { level: 1, name: 'Pratiche' })).toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('DossierListView — the category menu (D1)', () => {
  const tagged = (id: string, title: string, tags: string[], kind: Dossier['kind'] = 'lavoro'): Dossier =>
    ({ ...dossier([CIVIL]), id, title, tags, kind });
  const listed = [
    tagged('a', 'Accesso agli atti', ['accesso', 'DPO']),
    tagged('b', 'Ricorso in appello', ['appello']),
    tagged('c', 'Registro trattamenti', ['gdpr']),
    tagged('d', 'Valutazione d\'impatto', ['GDPR', 'cancellazione']),
  ];
  const titles = () => screen.queryAllByRole('heading', { level: 2 }).map((h) => h.textContent).sort();
  const renderList = () => render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);

  it('lists the categories capitalised and in alphabetical order, «Tutte le categorie» first, one for «gdpr» and «GDPR»', () => {
    viewport.desktop = true;
    appStore.setState({ dossiers: listed });
    renderList();
    const menu = screen.getByRole('combobox', { name: 'Filtra per categoria' });
    expect(menu).toHaveAttribute('id', 'tour-dossier-filters');
    const options = Array.from((menu as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(['Tutte le categorie', 'Accesso', 'Appello', 'Cancellazione', 'DPO', 'GDPR']);
    // The chips are gone.
    expect(screen.queryByRole('button', { name: 'Tutti' })).toBeNull();
  });

  it('says «Tutte» on a phone, where the half-width menu has no room for «Tutte le categorie»', () => {
    appStore.setState({ dossiers: listed });
    renderList();
    const menu = screen.getByRole('combobox', { name: 'Filtra per categoria' }) as HTMLSelectElement;
    expect(Array.from(menu.options).map((o) => o.textContent)).toEqual(['Tutte', 'Accesso', 'Appello', 'Cancellazione', 'DPO', 'GDPR']);
    expect(menu.value).toBe('');
  });

  it('filters by the category chosen, and «Tutte le categorie» brings the list back', () => {
    appStore.setState({ dossiers: listed });
    renderList();
    const menu = screen.getByRole('combobox', { name: 'Filtra per categoria' });
    fireEvent.change(menu, { target: { value: 'appello' } });
    expect(titles()).toEqual(['Ricorso in appello']);
    // «gdpr» and «GDPR» are one category: both dossiers.
    fireEvent.change(menu, { target: { value: 'gdpr' } });
    expect(titles()).toEqual(['Registro trattamenti', 'Valutazione d\'impatto']);
    fireEvent.change(menu, { target: { value: '' } });
    expect(titles()).toHaveLength(4);
  });

  it('shows the labels capitalised on the cards and never changes the stored tags', () => {
    appStore.setState({ dossiers: listed });
    renderList();
    expect(screen.getByText('Accesso', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('DPO', { selector: 'span' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtra per categoria' }), { target: { value: 'accesso' } });
    expect(appStore.getState().dossiers.map((d) => d.tags)).toEqual([['accesso', 'DPO'], ['appello'], ['gdpr'], ['GDPR', 'cancellazione']]);
  });

  it('offers only the categories of the dossiers the section lists', () => {
    appStore.setState({ dossiers: [...listed, tagged('s', 'Diritto penale', ['penale'], 'studio')] });
    const values = () => Array.from((screen.getByRole('combobox', { name: 'Filtra per categoria' }) as HTMLSelectElement).options).map((o) => o.value);
    const { unmount } = renderList();
    expect(values()).not.toContain('penale');
    unmount();
    sectionStore.setState({ section: 'gymnasium', dossierKind: 'studio' });
    renderList();
    expect(values()).toEqual(['', 'penale']);
  });

  it('gives both menus the same look, 44 px at every width (S7c) and half the row each on a phone', () => {
    appStore.setState({ dossiers: listed });
    renderList();
    for (const name of ['Ordina le pratiche', 'Filtra per categoria']) {
      expect(screen.getByRole('combobox', { name }).className).toEqual(expect.stringContaining('flex-1 min-w-0'));
      expect(screen.getByRole('combobox', { name })).toHaveClass('min-h-[44px]');
      expect(screen.getByRole('combobox', { name }).className).not.toMatch(/md:min-h-0/);
    }
  });

  it('has no menu when no dossier has a category, and the order menu stays', () => {
    appStore.setState({ dossiers: [dossier([CIVIL])] });
    renderList();
    expect(screen.queryByRole('combobox', { name: 'Filtra per categoria' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Ordina le pratiche' })).toBeInTheDocument();
  });

  it('shows «Tutte le categorie» again when the chosen category leaves the list', () => {
    appStore.setState({ dossiers: listed });
    renderList();
    const menu = screen.getByRole('combobox', { name: 'Filtra per categoria' }) as HTMLSelectElement;
    fireEvent.change(menu, { target: { value: 'appello' } });
    act(() => { appStore.setState({ dossiers: listed.filter((d) => d.id !== 'b') }); });
    expect(menu.value).toBe('');
    expect(titles()).toHaveLength(3);
    // The category back (an undone deletion) does not filter again on its own.
    act(() => { appStore.setState({ dossiers: listed }); });
    expect(menu.value).toBe('');
    expect(titles()).toHaveLength(4);
  });

  it('says «Cerca nelle pratiche…» without the shortcut, which still puts the cursor there', () => {
    appStore.setState({ dossiers: listed });
    renderList();
    const field = screen.getByRole('textbox', { name: 'Cerca nelle pratiche' });
    expect(field).toHaveAttribute('placeholder', 'Cerca nelle pratiche…');
    expect(field).toHaveAttribute('aria-keyshortcuts', '/');
    fireEvent.keyDown(window, { key: '/' });
    expect(field).toHaveFocus();
  });
});

// On a phone the title keeps its row (M1): «⋯» with «Importa» and «Cestino», and «+» for a new dossier, beside it.
describe('DossierListView — the heading on a phone', () => {
  const page = (trashCount = 0, onOpenTrash = vi.fn()) => {
    appStore.setState({ dossiers: [dossier([CIVIL])], practices: [], activePracticeId: null, searchTrigger: null, searchQueue: [] });
    render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} trashCount={trashCount} onOpenTrash={onOpenTrash} /></MemoryRouter>);
  };

  it('puts «⋯» and «+» beside the title, 44 px each, and no row of buttons under it', () => {
    page();
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
    expect(header).toHaveClass('flex-row', 'items-center', 'justify-between');
    const create = screen.getByRole('button', { name: 'Nuova pratica' });
    expect(create).toHaveAttribute('id', 'tour-dossier-create');
    expect(create).toHaveClass('h-11', 'w-11');
    expect(screen.getByRole('button', { name: 'Altre azioni sulle pratiche' })).toHaveClass('h-11', 'w-11');
    expect(screen.queryByRole('button', { name: 'Importa una pratica da file JSON' })).toBeNull();
  });

  it('holds «Importa» in «⋯», and «Cestino (n)» when the trash holds something', () => {
    const onOpenTrash = vi.fn();
    page(2, onOpenTrash);
    fireEvent.click(screen.getByRole('button', { name: 'Altre azioni sulle pratiche' }));
    expect(screen.getAllByRole('menuitem').map((e) => e.textContent?.trim())).toEqual(['Importa da file JSON', 'Cestino (2)']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cestino (2)' }));
    expect(onOpenTrash).toHaveBeenCalledTimes(1);
  });

  it('opens the new dossier from «+»', () => {
    page();
    fireEvent.click(screen.getByRole('button', { name: 'Nuova pratica' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

// The list in the planner's shape (S7c): the card says what it holds in one line, and an empty list is composed.
describe('DossierListView — cards and the empty list (S7c)', () => {
  it('says what a dossier holds in one line at the card\'s foot, with its date; its controls 44 px, always there', () => {
    appStore.setState({ dossiers: [{
      id: 'd1', title: 'Pratica Rossi', createdAt: '2026-08-01T10:00:00.000Z',
      items: [
        { id: 'b', type: 'norma', addedAt: '2026-08-01T10:00:00.000Z', data: CIVIL },
        { id: 'n', type: 'note', addedAt: '2026-08-01T10:00:00.000Z', data: 'appunto' },
      ],
    }], practices: [], activePracticeId: null, searchTrigger: null, searchQueue: [] });
    render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
    const card = screen.getByRole('button', { name: 'Apri la pratica Pratica Rossi' });
    expect(within(card).getByRole('heading', { level: 2, name: 'Pratica Rossi' })).toHaveClass('font-serif');
    const line = within(card).getByText('1 nota').closest('p')!;
    // Said as it is seen: the spaces round «·» are in the text.
    expect(line).toHaveTextContent(/^1 fonte · 1 articolo · 1 nota$/);
    expect(within(card).getByText('Creata il 1 agosto 2026')).toBeInTheDocument();
    // LC60: no «Apri in Ricerca» on a card.
    expect(within(card).queryByRole('button', { name: 'Apri Pratica Rossi in Ricerca' })).toBeNull();
    for (const name of ['Azioni su Pratica Rossi']) {
      const control = within(card).getByRole('button', { name });
      expect(control).toHaveClass('min-h-[44px]', 'min-w-[44px]');
      expect(control.className).not.toMatch(/opacity-0/);
    }
    // No icon of a folder, no «N elementi» badge.
    expect(within(card).queryByText(/elementi?$/)).toBeNull();
  });

  it('lays the cards out as a grid of cards of at least 20rem, as many columns as the frame holds (U1)', () => {
    const address = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:codice.civile:1942-03-16;262~art1284';
    appStore.setState({ dossiers: [
      { ...dossier([CIVIL]), description: address },
      { ...dossier([PENAL]), id: 'd2', title: 'Pratica Bianchi' },
    ] });
    render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
    const card = screen.getByRole('button', { name: 'Apri la pratica Pratica Rossi' });
    const grid = card.parentElement!;
    expect(grid).toBe(screen.getByRole('button', { name: 'Apri la pratica Pratica Bianchi' }).parentElement);
    expect(grid).toHaveClass('grid', CARD_GRID_COLUMNS);
    // No column count set by breakpoint: the cards' width decides, so none is under 20rem (320 px at the default text size).
    expect(grid.className).not.toMatch(/\bgrid-cols-\d/);
    // A description with no space in it (an address) wraps inside a card of 20rem rather than being cut at its edge.
    expect(within(card).getByText(address)).toHaveClass('break-words', 'line-clamp-2');
  });

  it('says it is opening the pratiche, not that there are none, while they are read again (after «Riprova»)', () => {
    appStore.setState({ dossiers: [], practices: [], activePracticeId: null, searchTrigger: null, searchQueue: [], isLoadingData: true });
    sectionStore.setState({ section: 'opus', dossierKind: 'lavoro' });
    render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveTextContent('Apro le pratiche…');
    expect(screen.queryByRole('heading', { name: 'Nessuna pratica di lavoro' })).toBeNull();
  });

  // LC21: the line art is gone (no drawing over an empty list); the words and the two ways to begin stay.
  it('composes the empty list: the empty folder’s engraving, what a dossier is for and two ways to begin', () => {
    appStore.setState({ dossiers: [], practices: [], activePracticeId: null, searchTrigger: null, searchQueue: [] });
    sectionStore.setState({ section: 'opus', dossierKind: 'lavoro' });
    render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
    const empty = screen.getByRole('region', { name: 'Nessuna pratica di lavoro' });
    expect(empty).toHaveClass('mx-auto', 'items-center', 'text-center');
    // LC35: the empty folder's engraving over the heading, decorative; the other pictures are the buttons' icons.
    expect(empty.firstElementChild).toHaveAttribute('data-illustration', 'dossier-vuoti');
    expect(empty.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(empty.children[1]).toBe(screen.getByRole('heading', { name: 'Nessuna pratica di lavoro' }));
    expect(empty.innerHTML).not.toContain('--vlx-section-');
    for (const svg of empty.querySelectorAll('svg')) expect(svg.closest('button')).not.toBeNull();
    expect(within(empty).getByRole('button', { name: 'Crea la tua prima pratica' })).toHaveClass('min-h-[44px]', 'bg-primary-600');
    expect(within(empty).getByRole('button', { name: 'Pronti da LexCraft' })).toHaveClass('min-h-[44px]');
  });
});
