import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { appStore } from '../../../store/useAppStore';
import { DossierListView } from './DossierListView';
import { registerUndoToastListener, type UndoToast } from '../../../hooks/useUndoableAction';
import { resetNotifications } from '../../ui/notifications/notifications';
import { sectionStore } from '../../../features/sections/useSection';
import type { Dossier, NormaVisitata } from '../../../types';

// The list's viewport (`useIsDesktop`): a phone, as jsdom's matchMedia shim says, unless a test says otherwise.
const viewport = vi.hoisted(() => ({ desktop: false }));
vi.mock('../../../hooks/useIsDesktop', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/useIsDesktop')>()),
  useIsDesktop: () => viewport.desktop,
}));

const CIVIL: NormaVisitata = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1284' };
const PENAL: NormaVisitata = { tipo_atto: 'codice penale', numero_atto: '1398', data: '1930-10-19', numero_articolo: '575' };
const PAST: NormaVisitata = { ...CIVIL, versione: 'vigente', data_versione: '2007-12-29' };

const dossier = (data: NormaVisitata[]): Dossier => ({
  id: 'd1', title: 'Pratica Rossi', createdAt: '2026-08-01T10:00:00.000Z',
  items: data.map((d, i) => ({ id: `i${i}`, type: 'norma' as const, data: d, addedAt: '2026-08-01T10:00:00.000Z' })),
});

function open(items: NormaVisitata[]) {
  appStore.setState({ dossiers: [dossier(items)], practices: [], activePracticeId: null, searchTrigger: null, searchQueue: [] });
  render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Apri Pratica Rossi su Dashboard' }));
}

beforeEach(() => {
  viewport.desktop = false;
  appStore.setState({ practices: [], activePracticeId: null, searchTrigger: null, searchQueue: [] });
  sectionStore.setState({ section: 'opus', dossierKind: 'lavoro' });
});

describe('DossierListView — the quick-open of a card', () => {
  // D7a: a dossier of decisions alone opens them, as from its page; before, the card's button was disabled.
  it('opens a dossier of decisions alone in one practice holding them, no search to run', () => {
    const decisions: Dossier = { id: 'd1', title: 'Pratica Rossi', createdAt: '2026-08-01T10:00:00.000Z', items: [
      { id: 's1', type: 'sentenza', addedAt: '', data: { corte: 'cassazione', archivio: 'civile', numero: 28994, anno: 2019, etichetta: 'Cass. civ. 28994/2019' } },
    ] };
    appStore.setState({ dossiers: [decisions], practices: [], activePracticeId: null, searchTrigger: null, searchQueue: [] });
    render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
    const button = screen.getByRole('button', { name: 'Apri Pratica Rossi su Dashboard' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    const { practices, searchTrigger, searchQueue } = appStore.getState();
    expect(practices).toHaveLength(1);
    expect(practices[0].decisions.map((d) => d.reference.numero)).toEqual([28994]);
    expect(searchTrigger).toBeNull();
    expect(searchQueue).toEqual([]);
  });

  it('opens a single past group as that text, in the dossier\'s practice', () => {
    open([PAST]);
    const { searchQueue, practices } = appStore.getState();
    expect(searchQueue).toHaveLength(1);
    expect(searchQueue[0]).toMatchObject({
      article: '1284', version: 'vigente', version_date: '2007-12-29',
      tabLabel: 'Pratica Rossi — testo al 29/12/2007',
    });
    expect(practices.map((p) => p.label)).toEqual(['Pratica Rossi']);
    expect(searchQueue[0].targetPracticeId).toBe(practices[0].id);
  });

  it('opens a single group in force as it always did', () => {
    open([CIVIL]);
    expect(appStore.getState().searchQueue[0]).toMatchObject({
      version: 'vigente', version_date: '', tabLabel: 'Pratica Rossi',
    });
  });

  it('through the picker: "open all" keeps each version, and every group goes to the one practice', () => {
    open([CIVIL, PAST]);
    fireEvent.click(screen.getByRole('button', { name: /Apri tutto/ }));
    const { searchQueue, practices } = appStore.getState();
    expect(searchQueue).toHaveLength(2);
    expect(searchQueue[0]).toMatchObject({ version: 'vigente', version_date: '' });
    expect(searchQueue[1]).toMatchObject({ version: 'vigente', version_date: '2007-12-29' });
    expect(practices.map((p) => p.label)).toEqual(['Pratica Rossi']);
    expect(searchQueue.map((q) => q.targetPracticeId)).toEqual([practices[0].id, practices[0].id]);
  });

  it('through the picker: when every group asks for a past text there is still one practice, not one per group', () => {
    open([PAST, { ...PENAL, versione: 'originale' }]);
    fireEvent.click(screen.getByRole('button', { name: /Apri tutto/ }));
    expect(appStore.getState().practices.map((p) => p.label)).toEqual(['Pratica Rossi']);
  });

  it('through the picker: one group on its own keeps its version', () => {
    open([CIVIL, PAST]);
    fireEvent.click(screen.getByText('Testo al 29/12/2007'));
    expect(appStore.getState().searchTrigger).toMatchObject({
      version_date: '2007-12-29', tabLabel: 'Pratica Rossi — testo al 29/12/2007',
    });
  });
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
      await waitFor(() => expect(shown?.message).toBe('Dossier «Pratica Rossi» spostato nel cestino'));
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
    expect(screen.getByRole('heading', { level: 1, name: 'Dossier' })).toBeInTheDocument();
    expect(screen.getByText('Opus · la tua officina giuridica')).toBeInTheDocument();
    expect(titles().sort()).toEqual(['Pratica Rossi', 'Senza tipo']);
    // The kind filter is gone: the section is the filter.
    expect(screen.queryByRole('group', { name: 'Tipo di dossier' })).toBeNull();
    unmount();

    sectionStore.setState({ section: 'gymnasium', dossierKind: 'studio' });
    render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Dossier' })).toBeInTheDocument();
    expect(screen.getByText('Gymnasium · la tua palestra giuridica')).toBeInTheDocument();
    expect(titles()).toEqual(['Diritto penale']);
    expect(screen.getAllByText('Di studio', { selector: 'span' })).toHaveLength(1);
    expect(screen.getByText('Pubblicato nel Forum')).toBeInTheDocument();
  });

  it('says which kind is empty', () => {
    appStore.setState({ dossiers: [kinds[0]] });
    sectionStore.setState({ section: 'gymnasium', dossierKind: 'studio' });
    render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
    expect(screen.getByText('Nessun dossier di studio')).toBeInTheDocument();
  });

  it('lists every dossier without Gymnasium (VITE_FEATURE_STUDIA off), or the study ones could not be reached', () => {
    vi.stubEnv('VITE_FEATURE_STUDIA', 'false');
    try {
      appStore.setState({ dossiers: kinds });
      render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
      expect(titles()).toHaveLength(3);
      expect(screen.getByRole('heading', { level: 1, name: 'Dossier' })).toBeInTheDocument();
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
    for (const name of ['Ordina i dossier', 'Filtra per categoria']) {
      expect(screen.getByRole('combobox', { name }).className).toEqual(expect.stringContaining('flex-1 min-w-0'));
      expect(screen.getByRole('combobox', { name })).toHaveClass('min-h-[44px]');
      expect(screen.getByRole('combobox', { name }).className).not.toMatch(/md:min-h-0/);
    }
  });

  it('has no menu when no dossier has a category, and the order menu stays', () => {
    appStore.setState({ dossiers: [dossier([CIVIL])] });
    renderList();
    expect(screen.queryByRole('combobox', { name: 'Filtra per categoria' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Ordina i dossier' })).toBeInTheDocument();
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

  it('says «Cerca nei dossier…» without the shortcut, which still puts the cursor there', () => {
    appStore.setState({ dossiers: listed });
    renderList();
    const field = screen.getByRole('textbox', { name: 'Cerca nei dossier' });
    expect(field).toHaveAttribute('placeholder', 'Cerca nei dossier…');
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
    expect(header).toHaveClass('flex-row', 'items-start', 'justify-between');
    const create = screen.getByRole('button', { name: 'Nuovo dossier' });
    expect(create).toHaveAttribute('id', 'tour-dossier-create');
    expect(create).toHaveClass('h-11', 'w-11');
    expect(screen.getByRole('button', { name: 'Altre azioni sui dossier' })).toHaveClass('h-11', 'w-11');
    expect(screen.queryByRole('button', { name: 'Importa dossier da file JSON' })).toBeNull();
  });

  it('holds «Importa» in «⋯», and «Cestino (n)» when the trash holds something', () => {
    const onOpenTrash = vi.fn();
    page(2, onOpenTrash);
    fireEvent.click(screen.getByRole('button', { name: 'Altre azioni sui dossier' }));
    expect(screen.getAllByRole('menuitem').map((e) => e.textContent?.trim())).toEqual(['Importa da file JSON', 'Cestino (2)']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cestino (2)' }));
    expect(onOpenTrash).toHaveBeenCalledTimes(1);
  });

  it('opens the new dossier from «+»', () => {
    page();
    fireEvent.click(screen.getByRole('button', { name: 'Nuovo dossier' }));
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
    const card = screen.getByRole('button', { name: 'Apri dossier Pratica Rossi' });
    expect(within(card).getByRole('heading', { level: 2, name: 'Pratica Rossi' })).toHaveClass('font-serif');
    const line = within(card).getByText('1 nota').closest('p')!;
    // Said as it is seen: the spaces round «·» are in the text.
    expect(line).toHaveTextContent(/^1 atto · 1 articolo · 1 nota$/);
    expect(within(card).getByText('Creato il 1 agosto 2026')).toBeInTheDocument();
    for (const name of ['Apri Pratica Rossi su Dashboard', 'Azioni su Pratica Rossi']) {
      const control = within(card).getByRole('button', { name });
      expect(control).toHaveClass('min-h-[44px]', 'min-w-[44px]');
      expect(control.className).not.toMatch(/opacity-0/);
    }
    // No icon of a folder, no «N elementi» badge.
    expect(within(card).queryByText(/elementi?$/)).toBeNull();
  });

  it('composes the empty list: line art in the section\'s hue, what a dossier is for, and two ways to begin', () => {
    appStore.setState({ dossiers: [], practices: [], activePracticeId: null, searchTrigger: null, searchQueue: [] });
    sectionStore.setState({ section: 'opus', dossierKind: 'lavoro' });
    render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
    const empty = screen.getByRole('region', { name: 'Nessun dossier di lavoro' });
    expect(empty).toHaveClass('mx-auto', 'items-center', 'text-center');
    const drawing = empty.querySelector('svg')!;
    expect(drawing).toHaveAttribute('aria-hidden', 'true');
    expect(drawing.innerHTML).toContain('var(--vlx-section-opus)');
    expect(within(empty).getByRole('button', { name: 'Crea il tuo primo dossier' })).toHaveClass('min-h-[44px]', 'bg-primary-600');
    expect(within(empty).getByRole('button', { name: 'Pronti da VisuaLex' })).toHaveClass('min-h-[44px]');
  });
});
