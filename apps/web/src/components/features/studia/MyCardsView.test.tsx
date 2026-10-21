import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../../../services/studiaService', () => ({
  studiaService: { list: vi.fn(), get: vi.fn(), trash: vi.fn(), create: vi.fn(), update: vi.fn(), propose: vi.fn(), withdraw: vi.fn() },
}));

vi.mock('../../../services/healthService', () => ({ cardSourcesAnswer: vi.fn() }));
vi.mock('../../../services/trashService', () => ({ trashService: { restore: vi.fn() } }));

vi.mock('../../../utils/articleCardsCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/articleCardsCache')>()),
  invalidateArticleCards: vi.fn(),
}));

import { cardSourcesAnswer } from '../../../services/healthService';
import { studiaService } from '../../../services/studiaService';
import { invalidateArticleCards } from '../../../utils/articleCardsCache';
import { appStore } from '../../../store/useAppStore';
import type { Scheda, StatoScheda } from '../../../types/studia';
import { MyCardsView } from './MyCardsView';
import { trashService } from '../../../services/trashService';
import { registerUndoToastListener, type UndoToast } from '../../../hooks/useUndoableAction';
import { resetNotifications } from '../../ui/notifications/notifications';

const list = vi.mocked(studiaService.list);
const get = vi.mocked(studiaService.get);
const trash = vi.mocked(studiaService.trash);
const propose = vi.mocked(studiaService.propose);
const withdraw = vi.mocked(studiaService.withdraw);
const sources = vi.mocked(cardSourcesAnswer);

const CIVILE_URN = 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453';
const LEGGE_URN = 'urn:nir:stato:legge:1990-08-07;241~art2';

const card = (id: string, extra: Partial<Scheda> = {}): Scheda => ({
  id, materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione per inadempimento', tipo: 'ISTITUTO_DEFINIZIONE',
  domanda: `Domanda ${id}?`, risposta: `Risposta ${id}.`, spiegazione: null, stato: 'BOZZA_PERSONALE',
  createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z', origine: null,
  ancore: [{ normaKey: 'codice_civile', articleId: 'art_1453', urn: CIVILE_URN, isPrimary: true }],
  ...extra,
});

// Server order for `ordine=materia`: subjects, then institutes alphabetically.
const FIVE: Scheda[] = [
  card('c1', { istituto: 'Contratto' }),
  card('r1'),
  card('r2'),
  card('p1', { materia: 'DIRITTO_PENALE', istituto: 'Reato', ancore: [] }),
  card('p2', { materia: 'DIRITTO_PENALE', istituto: 'Reato', ancore: [] }),
];

/** jsdom has no viewport: the phone's layout is the default, the desktop's is chosen here. */
function setDesktop(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderView(path = '/studia/schede') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Where />} />
        <Route path="/studia/schede" element={<><MyCardsView /><Where /></>} />
        <Route path="/studia/schede/:id" element={<><MyCardsView /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

const page = (cards: Scheda[]) => ({ cards, nextOffset: null });

beforeEach(() => {
  setDesktop(true);
  list.mockReset();
  get.mockReset();
  trash.mockReset();
  propose.mockReset();
  withdraw.mockReset();
  vi.mocked(invalidateArticleCards).mockClear();
  list.mockResolvedValue(page(FIVE));
  sources.mockReset();
  sources.mockResolvedValue(true);
  vi.mocked(studiaService.create).mockReset();
  appStore.setState({ searchTrigger: null });
});

afterEach(() => {
  vi.useRealTimers();
  setDesktop(false);
});

describe('«Le mie schede», the list', () => {
  it('groups the cards by subject and institute, in the order the server gives', async () => {
    renderView();
    await screen.findByRole('heading', { level: 3, name: /Diritto civile/ });
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Diritto civile3 schede', 'Diritto penale2 schede']);
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
      'Contratto1 scheda', 'Risoluzione per inadempimento2 schede', 'Reato2 schede',
    ]);
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ ordine: 'materia' }));
  });

  it('invites to write the first card from here when there is none and the sources answer', async () => {
    list.mockResolvedValue(page([]));
    renderView();
    expect(await screen.findByText('Non hai ancora schede.')).toBeInTheDocument();
    expect(screen.getByText(/Scrivi la prima da qui: indica l’articolo su cui poggia, ad esempio «art\. 1455 c\.c\.»/)).toBeInTheDocument();
    // The heading's and the empty list's.
    expect(screen.getAllByRole('button', { name: '+ Nuova scheda' })).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Ricerca' })).toHaveAttribute('href', '/');
  });

  it('points to an article, and promises no button, when the sources do not answer', async () => {
    sources.mockResolvedValue(false);
    list.mockResolvedValue(page([]));
    renderView();
    expect(await screen.findByText(/Per cominciare, apri un articolo dalla/)).toBeInTheDocument();
    expect(screen.getByText(/e scegli «\+ Nuova scheda» sotto il testo, o chiedi a Claude di scriverne\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Nuova scheda' })).toBeNull();
    expect(screen.queryByText(/Scrivi la prima da qui/)).toBeNull();
  });

  it('says only that there is no card while the sources have not answered: the way to begin is not said twice', async () => {
    sources.mockReturnValue(new Promise(() => {}));
    list.mockResolvedValue(page([]));
    renderView();
    expect(await screen.findByText('Non hai ancora schede.')).toBeInTheDocument();
    expect(screen.queryByText(/Per cominciare/)).toBeNull();
    expect(screen.queryByText(/Scrivi la prima da qui/)).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Nuova scheda' })).toBeNull();
  });

  it('offers no «+ Nuova scheda» while the sources have not answered yet', async () => {
    sources.mockReturnValue(new Promise(() => {}));
    renderView();
    await screen.findAllByRole('link');
    expect(screen.getByRole('heading', { level: 2, name: 'Le mie schede' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Nuova scheda' })).toBeNull();
  });

  it('says so, and offers to clear the filters, when they leave nothing', async () => {
    renderView();
    await screen.findAllByRole('link');
    list.mockResolvedValue(page([]));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Scritte da Claude, da rileggere' }));
    expect(await screen.findByText('Nessuna scheda con questi filtri.')).toBeInTheDocument();
    list.mockResolvedValue(page(FIVE));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Azzera i filtri' }));
    expect(await screen.findAllByRole('link')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Scritte da Claude, da rileggere' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('folds an institute shut from its heading', async () => {
    renderView();
    await screen.findAllByRole('link');
    await userEvent.setup().click(screen.getByRole('button', { name: /^Reato/ }));
    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /^Reato/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('reads the next page on request', async () => {
    list.mockResolvedValueOnce({ cards: FIVE.slice(0, 3), nextOffset: 3 });
    renderView();
    await screen.findAllByRole('link');
    list.mockResolvedValueOnce(page(FIVE.slice(3)));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Mostra altre schede' }));
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(5));
    expect(list).toHaveBeenLastCalledWith({ ordine: 'materia', offset: 3 });
    expect(screen.queryByRole('button', { name: 'Mostra altre schede' })).not.toBeInTheDocument();
  });

  it('says when the cards cannot be read, and tries again', async () => {
    list.mockRejectedValueOnce(new Error('down'));
    renderView();
    expect(await screen.findByRole('alert')).toHaveTextContent('Non riesco a leggere le schede. Riprova.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findAllByRole('link')).toHaveLength(5);
  });
});

describe('«Le mie schede», the filters', () => {
  it('searches after 300 ms of quiet', async () => {
    renderView();
    await screen.findAllByRole('link');
    list.mockClear();
    vi.useFakeTimers();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Cerca nelle schede' }), { target: { value: 'caparra' } });
    await act(async () => { vi.advanceTimersByTime(299); });
    expect(list).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ q: 'caparra', ordine: 'materia' }));
  });

  it('clears the filters in one request, with no stale search left to settle', async () => {
    renderView();
    await screen.findAllByRole('link');
    vi.useFakeTimers();
    fireEvent.change(screen.getByRole('combobox', { name: 'Materia' }), { target: { value: 'DIRITTO_PENALE' } });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Cerca nelle schede' }), { target: { value: 'caparra' } });
    list.mockResolvedValue(page([]));
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.getByText('Nessuna scheda con questi filtri.')).toBeInTheDocument();

    list.mockClear();
    list.mockResolvedValue(page(FIVE));
    fireEvent.click(screen.getByRole('button', { name: 'Azzera i filtri' }));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(list.mock.calls.map(([query]) => query)).toEqual([{ ordine: 'materia' }]);
    expect(screen.getByRole('searchbox', { name: 'Cerca nelle schede' })).toHaveValue('');
  });

  it('asks for the cards Claude wrote and the user has yet to read', async () => {
    renderView();
    await screen.findAllByRole('link');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Scritte da Claude, da rileggere' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ origine: 'applicazione', stato: 'BOZZA_PERSONALE' })));
    expect(screen.getByRole('combobox', { name: 'Stato' })).toBeDisabled();
  });

  it('asks for the cards due today', async () => {
    renderView();
    await screen.findAllByRole('link');
    const toggle = screen.getByRole('button', { name: 'Da ripassare oggi' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ dovuteOggi: 'true' })));
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // Not together with «Claude»: they are separate filters, and the state select stays free.
    expect(screen.getByRole('combobox', { name: 'Stato' })).toBeEnabled();
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(list.mock.lastCall?.[0]).not.toHaveProperty('dovuteOggi'));
  });

  describe('the next review in each row', () => {
    afterEach(() => vi.useRealTimers());

    it('says when a card comes back, and «Da ripassare oggi» from the day on', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-11T10:00:00+02:00'));
      list.mockResolvedValue(page([
        card('f1', { prossimoRipasso: '2026-10-12' }),
        card('f2', { prossimoRipasso: '2026-10-11' }),
        card('f3', { prossimoRipasso: '2026-10-01' }),
        card('f4', { prossimoRipasso: null }),
        card('f5'),
      ]));
      renderView();
      const rows = await screen.findAllByRole('link');
      expect(within(rows[0]).getByText('Prossimo ripasso: 12 ottobre')).toBeInTheDocument();
      expect(within(rows[1]).getByText('Da ripassare oggi')).toBeInTheDocument();
      expect(within(rows[2]).getByText('Da ripassare oggi')).toBeInTheDocument();
      expect(within(rows[3]).queryByText(/ripass/i)).not.toBeInTheDocument();
      expect(within(rows[4]).queryByText(/ripass/i)).not.toBeInTheDocument();
    });
  });

  it('filters by subject, state and kind', async () => {
    renderView();
    await screen.findAllByRole('link');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Materia' }), 'DIRITTO_PENALE');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Stato' }), 'VALIDATA');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tipo' }), 'CASO_APPLICATIVO');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ materia: 'DIRITTO_PENALE', stato: 'VALIDATA', tipo: 'CASO_APPLICATIVO' })));
  });

  it('offers the acts the cards rest on, named by the source convention, and filters by their key', async () => {
    list.mockResolvedValue(page([
      card('c1', { istituto: 'Contratto' }),
      card('a1', { materia: 'DIRITTO_AMMINISTRATIVO', istituto: 'Termine', ancore: [{ normaKey: 'l_241_1990', articleId: 'art_2', urn: LEGGE_URN, isPrimary: true }] }),
      card('p1', { materia: 'DIRITTO_PENALE', istituto: 'Reato', ancore: [] }),
    ]));
    renderView();
    const acts = await screen.findByRole('combobox', { name: 'Atto' });
    expect(within(acts).getAllByRole('option').map((o) => [o.textContent, (o as HTMLOptionElement).value])).toEqual([
      ['Tutti gli atti', ''], ['Codice civile', 'codice_civile'], ['l. 7 agosto 1990, n. 241', 'l_241_1990'],
    ]);
    await userEvent.setup().selectOptions(acts, 'codice_civile');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ normaKey: 'codice_civile' })));
    // What was on offer stays on offer once the list is narrowed.
    expect(within(screen.getByRole('combobox', { name: 'Atto' })).getAllByRole('option')).toHaveLength(3);
  });

  it('offers no act when no anchor names one', async () => {
    list.mockResolvedValue(page([card('p1', { materia: 'DIRITTO_PENALE', istituto: 'Reato', ancore: [] })]));
    renderView();
    await screen.findAllByRole('link');
    expect(screen.queryByRole('combobox', { name: 'Atto' })).not.toBeInTheDocument();
  });
});

describe('«Le mie schede», the act filter after a deletion', () => {
  const CIVILE = card('c1', { istituto: 'Contratto' });
  const LEGGE = card('a1', { materia: 'DIRITTO_AMMINISTRATIVO', istituto: 'Termine', ancore: [{ normaKey: 'l_241_1990', articleId: 'art_2', urn: LEGGE_URN, isPrimary: true }] });
  const actValues = () => within(screen.getByRole('combobox', { name: 'Atto' })).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);

  const deleteCard = async (id: string) => {
    const detail = await screen.findByRole('article', { name: 'Scheda' });
    await userEvent.setup().click(within(detail).getByRole('button', { name: 'Elimina' }));
    await waitFor(() => expect(trash).toHaveBeenCalledWith([id]));
  };

  it('stops offering the act whose only card was deleted', async () => {
    list.mockResolvedValue(page([CIVILE, LEGGE]));
    renderView('/studia/schede/a1');
    await screen.findByRole('combobox', { name: 'Atto' });
    expect(actValues()).toEqual(['', 'codice_civile', 'l_241_1990']);
    trash.mockResolvedValue({ trashId: 't1', moved: ['a1'], notFound: [], notDeletable: [] });
    list.mockResolvedValue(page([CIVILE]));
    await deleteCard('a1');
    await waitFor(() => expect(actValues()).toEqual(['', 'codice_civile']));
  });

  it('forgets the act of a deleted card even while a filter narrows the list, but keeps the selected one', async () => {
    list.mockResolvedValue(page([CIVILE, LEGGE]));
    renderView();
    const acts = await screen.findByRole('combobox', { name: 'Atto' });
    list.mockResolvedValue(page([LEGGE]));
    await userEvent.setup().selectOptions(acts, 'l_241_1990');
    await screen.findByRole('link', { name: /Domanda a1\?/ });
    // Narrowed, the options are kept: the civil code is still on offer.
    expect(actValues()).toEqual(['', 'codice_civile', 'l_241_1990']);
    await userEvent.setup().click(screen.getByRole('link', { name: /Domanda a1\?/ }));
    trash.mockResolvedValue({ trashId: 't1', moved: ['a1'], notFound: [], notDeletable: [] });
    list.mockResolvedValue(page([]));
    await deleteCard('a1');
    // The act of the empty list is the selected one and stays; the civil code, no longer read, goes.
    await waitFor(() => expect(actValues()).toEqual(['', 'l_241_1990']));
    expect(screen.getByRole('combobox', { name: 'Atto' })).toHaveValue('l_241_1990');
  });
});

describe('«Le mie schede», the detail', () => {
  it('opens beside the list from a row, at its own address', async () => {
    renderView();
    await userEvent.setup().click(await screen.findByRole('link', { name: /Domanda r1\?/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/schede/r1');
    const detail = await screen.findByRole('article', { name: 'Scheda' });
    expect(within(detail).getByRole('heading', { level: 3, name: 'Domanda r1?' })).toBeInTheDocument();
    expect(within(detail).getByText('Risposta r1.')).toBeInTheDocument();
    expect(within(detail).getByText('art. 1453 c.c.')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(screen.getByRole('link', { name: /Domanda r1\?/ })).toHaveAttribute('aria-current', 'true');
    expect(within(detail).queryByRole('button', { name: 'Indietro' })).not.toBeInTheDocument();
  });

  it('replaces the list on a phone, and «Indietro» returns to it', async () => {
    setDesktop(false);
    renderView();
    await userEvent.setup().click(await screen.findByRole('link', { name: /Domanda r1\?/ }));
    const detail = await screen.findByRole('article', { name: 'Scheda' });
    expect(screen.queryByRole('group', { name: 'Filtri' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    await userEvent.setup().click(within(detail).getByRole('button', { name: 'Indietro' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/schede');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(await screen.findAllByRole('link')).toHaveLength(5);
  });

  it('shows the explanation, the origin and the state', async () => {
    const rivedere = card('r1', { spiegazione: 'Perché la prestazione è corrispettiva.', stato: 'DA_RIVEDERE', origine: { clientName: 'Claude Code' } });
    list.mockResolvedValue(page([rivedere]));
    get.mockResolvedValue({ ...rivedere, approvazioni: 0, rilievi: [] });
    renderView('/studia/schede/r1');
    const detail = await screen.findByRole('article', { name: 'Scheda' });
    expect(within(detail).getByText('Perché la prestazione è corrispettiva.')).toBeInTheDocument();
    expect(within(detail).getByText('scritta da Claude Code (applicazione collegata)')).toBeInTheDocument();
    expect(within(detail).getByText('Da rivedere')).toBeInTheDocument();
    expect(within(detail).getByText(/Diritto civile · Risoluzione per inadempimento · Definizione/)).toBeInTheDocument();
  });

  it('reads a card the list does not hold, from its address', async () => {
    get.mockResolvedValue(card('lontana', { domanda: 'Una scheda fuori elenco?' }));
    renderView('/studia/schede/lontana');
    expect(await screen.findByRole('heading', { level: 3, name: 'Una scheda fuori elenco?' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('lontana');
  });

  it('says when the card is not there', async () => {
    get.mockRejectedValue({ status: 404 });
    renderView('/studia/schede/sparita');
    expect(await screen.findByText('Questa scheda non c’è più.')).toBeInTheDocument();
  });

  it('renders the text of a card as text, never as markup', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    list.mockResolvedValue(page([card('x1', { domanda: hostile, risposta: '<b>grassetto</b>', spiegazione: '<script>alert(1)</script>' })]));
    renderView('/studia/schede/x1');
    const detail = await screen.findByRole('article', { name: 'Scheda' });
    expect(within(detail).getByText(hostile)).toBeInTheDocument();
    expect(within(detail).getByText('<b>grassetto</b>')).toBeInTheDocument();
    expect(within(detail).getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(document.querySelector('img, b, script')).toBeNull();
  });

  it('opens the article an anchor rests on in the reader', async () => {
    list.mockResolvedValue(page([card('r1', { ancore: [
      { normaKey: 'l_241_1990', articleId: 'art_2', urn: LEGGE_URN, isPrimary: false },
      { normaKey: 'codice_civile', articleId: 'art_1453', urn: CIVILE_URN, isPrimary: true },
    ] })]));
    renderView('/studia/schede/r1');
    const detail = await screen.findByRole('article', { name: 'Scheda' });
    // The primary anchor is the source line; the other one is listed under its own heading.
    expect(within(detail).getByRole('heading', { level: 4, name: 'Altre ancore' })).toBeInTheDocument();
    await userEvent.setup().click(within(detail).getByRole('button', { name: 'art. 2, l. 7 agosto 1990, n. 241' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/');
    expect(screen.getByTestId('where')).not.toHaveTextContent('/studia');
    expect(appStore.getState().searchTrigger).toMatchObject({ act_type: 'legge', act_number: '241', date: '1990-08-07', article: '2' });
  });

  it('opens the primary anchor from the source line', async () => {
    renderView('/studia/schede/r1');
    const detail = await screen.findByRole('article', { name: 'Scheda' });
    await userEvent.setup().click(within(detail).getByRole('button', { name: 'art. 1453 c.c.' }));
    expect(appStore.getState().searchTrigger).toMatchObject({ act_type: 'codice civile', article: '1453', version: 'vigente' });
  });
});

describe('«Le mie schede», the actions a state allows', () => {
  const actions = async (stato: StatoScheda) => {
    list.mockResolvedValue(page([card('k', { stato })]));
    // A card past the drafts is completed from its own address (approvals and remarks).
    get.mockResolvedValue(card('k', { stato, approvazioni: 0, rilievi: [] }));
    renderView('/studia/schede/k');
    const detail = await screen.findByRole('article', { name: 'Scheda' });
    return {
      edit: within(detail).queryByRole('button', { name: 'Modifica' }),
      del: within(detail).queryByRole('button', { name: 'Elimina' }),
    };
  };

  it('lets a draft be edited and deleted', async () => {
    const { edit, del } = await actions('BOZZA_PERSONALE');
    expect(edit).toBeInTheDocument();
    expect(del).toBeInTheDocument();
  });

  it('lets an archived card be deleted, not edited', async () => {
    const { edit, del } = await actions('ARCHIVIATA');
    expect(edit).not.toBeInTheDocument();
    expect(del).toBeInTheDocument();
  });

  it.each<StatoScheda>(['PROPOSTA_COMMUNITY', 'VALIDATA', 'DA_RIVEDERE'])('keeps a %s card: neither edit nor delete', async (stato) => {
    const { edit, del } = await actions(stato);
    expect(edit).not.toBeInTheDocument();
    expect(del).not.toBeInTheDocument();
  });
});

describe('«Le mie schede», delete', () => {
  let shown: UndoToast | null;
  let unregister: () => void;
  beforeEach(() => {
    shown = null;
    unregister = registerUndoToastListener((t) => { shown = t; });
  });
  afterEach(() => {
    unregister();
    resetNotifications();
  });

  /** Opens the card, then (`listAfter`) what the list answers once it is gone, then presses «Elimina». */
  const pressDelete = async (listAfter?: Scheda[]) => {
    renderView('/studia/schede/r1');
    const detail = await screen.findByRole('article', { name: 'Scheda' });
    if (listAfter) list.mockResolvedValue(page(listAfter));
    await userEvent.setup().click(within(detail).getByRole('button', { name: 'Elimina' }));
  };

  it('moves the card to the trash at once, with «Annulla» and no confirmation, and returns to the list (K1a)', async () => {
    trash.mockResolvedValue({ trashId: 't1', moved: ['r1'], notFound: [], notDeletable: [] });
    await pressDelete(FIVE.filter((c) => c.id !== 'r1'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(trash).toHaveBeenCalledWith(['r1']);
    await waitFor(() => expect(shown?.message).toBe('Scheda nel cestino'));
    // The row under the article must not go on counting it.
    expect(invalidateArticleCards).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/schede');
    await waitFor(() => expect(screen.queryByRole('link', { name: /Domanda r1\?/ })).not.toBeInTheDocument());
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('«Annulla» takes the card back out of the trash and lists it again', async () => {
    trash.mockResolvedValue({ trashId: 't1', moved: ['r1'], notFound: [], notDeletable: [] });
    vi.mocked(trashService.restore).mockResolvedValue({ dossierId: null });
    await pressDelete(FIVE.filter((c) => c.id !== 'r1'));
    await waitFor(() => expect(shown).not.toBeNull());
    list.mockResolvedValue(page(FIVE));
    await act(async () => { await shown!.onUndo(); });
    expect(trashService.restore).toHaveBeenCalledWith('t1');
    expect(invalidateArticleCards).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('link', { name: /Domanda r1\?/ })).toBeInTheDocument();
  });

  it('says plainly when «Annulla» cannot reach the trash', async () => {
    trash.mockResolvedValue({ trashId: 't1', moved: ['r1'], notFound: [], notDeletable: [] });
    vi.mocked(trashService.restore).mockRejectedValue(new Error('down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await pressDelete();
    await waitFor(() => expect(shown).not.toBeNull());
    await act(async () => { await shown!.onUndo(); });
    expect(appStore.getState().lastSyncError?.message).toBe('Non riesco a ripristinare la scheda ora: è nel Cestino, ripristinala da lì.');
    error.mockRestore();
  });

  it('says plainly when the card can no longer be deleted, and stays on it', async () => {
    trash.mockResolvedValue({ moved: [], notFound: [], notDeletable: ['r1'] });
    await pressDelete();
    expect(await screen.findByText(/non si può eliminare nello stato in cui si trova/)).toBeInTheDocument();
    expect(invalidateArticleCards).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/schede/r1');
    expect(shown).toBeNull();
  });

  it('says plainly when the card is gone already', async () => {
    trash.mockResolvedValue({ moved: [], notFound: ['r1'], notDeletable: [] });
    await pressDelete();
    expect(await screen.findByText(/La scheda non c’è più/)).toBeInTheDocument();
  });

  it('says what failed and what to do when the trash cannot be reached', async () => {
    trash.mockRejectedValue(new Error('down'));
    await pressDelete();
    expect(await screen.findByText('Non sono riuscito a spostare la scheda nel cestino. Riprova.')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/schede/r1');
  });
});

describe('«Le mie schede», a new card', () => {
  it('opens the form with no article from the heading, and shows the card once saved', async () => {
    const user = userEvent.setup();
    const created = card('n1', { domanda: 'Quando?', istituto: 'Risoluzione' });
    vi.mocked(studiaService.create).mockResolvedValue({ outcome: 'created', id: 'n1' });
    renderView();
    await screen.findAllByRole('link');
    await user.click(await screen.findByRole('button', { name: '+ Nuova scheda' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuova scheda' });
    expect(within(dialog).queryByText('principale')).toBeNull();
    await user.selectOptions(within(dialog).getByLabelText('Materia'), 'DIRITTO_CIVILE');
    await user.type(within(dialog).getByLabelText('Istituto'), 'Risoluzione');
    await user.type(within(dialog).getByLabelText('Domanda'), 'Quando?');
    await user.type(within(dialog).getByLabelText('Risposta'), 'Se inadempiente.');
    await user.type(within(dialog).getByLabelText('Riferimento dell’ancora'), 'art. 1455 c.c.');
    list.mockClear();
    list.mockResolvedValue(page([created, ...FIVE]));
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
    expect(vi.mocked(studiaService.create).mock.calls[0][0].ancore).toEqual([{ riferimento: 'art. 1455 c.c.', principale: true }]);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/studia/schede/n1'));
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(await screen.findByText('Scheda salvata')).toBeInTheDocument();
  });

  it('opens the same form from the empty list, and gives the focus to the heading’s button once the first card is saved', async () => {
    const user = userEvent.setup();
    vi.mocked(studiaService.create).mockResolvedValue({ outcome: 'created', id: 'n1' });
    list.mockResolvedValue(page([]));
    renderView();
    await screen.findByText('Non hai ancora schede.');
    const [fromHeading, fromEmpty] = screen.getAllByRole('button', { name: '+ Nuova scheda' });
    await user.click(fromEmpty);
    const dialog = await screen.findByRole('dialog', { name: 'Nuova scheda' });
    await user.selectOptions(within(dialog).getByLabelText('Materia'), 'DIRITTO_CIVILE');
    await user.type(within(dialog).getByLabelText('Istituto'), 'Risoluzione');
    await user.type(within(dialog).getByLabelText('Domanda'), 'Quando?');
    await user.type(within(dialog).getByLabelText('Risposta'), 'Se inadempiente.');
    await user.type(within(dialog).getByLabelText('Riferimento dell’ancora'), 'art. 1455 c.c.');
    list.mockResolvedValue(page([card('n1')]));
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
    await waitFor(() => expect(screen.queryByText('Non hai ancora schede.')).toBeNull());
    expect(fromHeading).toHaveFocus();
  });
});

describe('«Le mie schede», edit', () => {
  it('opens the form on the draft', async () => {
    renderView('/studia/schede/r1');
    const detail = await screen.findByRole('article', { name: 'Scheda' });
    await userEvent.setup().click(within(detail).getByRole('button', { name: 'Modifica' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifica scheda' });
    expect(within(dialog).getByLabelText('Domanda')).toHaveValue('Domanda r1?');
  });

  it('reads the list again after a save, and shows the saved card', async () => {
    const saved = card('r1', { domanda: 'Domanda cambiata?' });
    vi.mocked(studiaService.update).mockResolvedValue({ outcome: 'updated', card: saved });
    renderView('/studia/schede/r1');
    const detail = await screen.findByRole('article', { name: 'Scheda' });
    const user = userEvent.setup();
    await user.click(within(detail).getByRole('button', { name: 'Modifica' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifica scheda' });
    list.mockClear();
    list.mockResolvedValue(page(FIVE.map((c) => (c.id === 'r1' ? saved : c))));
    await user.click(within(dialog).getByRole('button', { name: /Salva/ }));
    expect(await screen.findByText('Scheda salvata')).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { level: 3, name: 'Domanda cambiata?' })).toBeInTheDocument();
  });
});

describe('«Le mie schede», proposing and withdrawing', () => {
  const draft = card('d1');
  const proposed = card('d1', { stato: 'PROPOSTA_COMMUNITY' });
  const notice = { id: 't1', chiave: 'PROPOSTA_SCHEDA' as const, versione: 1, titolo: 'Titolo inventato', corpo: 'Uno.\n\nDue.', conferma: 'Conferma inventata', azione: 'Azione inventata' };

  it('proposes under the notice, says so, reads the list again and drops the reader\'s cached cards', async () => {
    const user = userEvent.setup();
    list.mockResolvedValue(page([draft]));
    renderView('/studia/schede/d1');
    propose.mockResolvedValueOnce({ richiedeTesto: notice });
    await user.click(await screen.findByRole('button', { name: 'Proponi alla comunità' }));
    await screen.findByRole('dialog', { name: 'Titolo inventato' });

    propose.mockResolvedValueOnce(proposed);
    list.mockResolvedValue(page([proposed]));
    get.mockResolvedValue({ ...proposed, approvazioni: 0, rilievi: [] });
    list.mockClear();
    await user.click(screen.getByRole('checkbox', { name: 'Conferma inventata' }));
    await user.click(screen.getByRole('button', { name: 'Azione inventata' }));

    expect(await screen.findByText('Scheda proposta alla comunità')).toBeInTheDocument();
    expect(propose).toHaveBeenLastCalledWith('d1', 't1');
    expect(invalidateArticleCards).toHaveBeenCalled();
    await waitFor(() => expect(list).toHaveBeenCalled());
    // The detail now follows the proposed card: Ritira, no more Modifica.
    expect(await screen.findByRole('button', { name: 'Ritira' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifica' })).not.toBeInTheDocument();
  });

  it('withdraws a proposal and shows the card as a draft again', async () => {
    const user = userEvent.setup();
    list.mockResolvedValue(page([proposed]));
    get.mockResolvedValue({ ...proposed, approvazioni: 1, rilievi: [] });
    renderView('/studia/schede/d1');
    await user.click(await screen.findByRole('button', { name: 'Ritira' }));
    withdraw.mockResolvedValue(draft);
    list.mockResolvedValue(page([draft]));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Ritira' }));
    expect(await screen.findByText('Proposta ritirata: la scheda è di nuovo una bozza')).toBeInTheDocument();
    expect(invalidateArticleCards).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Proponi alla comunità' })).toBeInTheDocument();
  });

  it('reads the validators\' remarks of a proposed card from its own address, since the list does not carry them', async () => {
    list.mockResolvedValue(page([proposed]));
    get.mockResolvedValue({
      ...proposed, approvazioni: 1,
      rilievi: [{ giudizio: 'MIGLIORABILE', motivazione: 'Manca la diffida.', createdAt: '2026-10-06T09:00:00Z' }],
    });
    renderView('/studia/schede/d1');
    const section = await screen.findByRole('region', { name: 'Rilievi dei validatori' });
    expect(get).toHaveBeenCalledWith('d1');
    expect(within(section).getByText('Manca la diffida.')).toBeInTheDocument();
    expect(screen.getByText('Approvazioni: 1')).toBeInTheDocument();
  });

  it('says when the validators\' remarks cannot be read, logs why, and reads them again on «Riprova»', async () => {
    const user = userEvent.setup();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    list.mockResolvedValue(page([proposed]));
    get.mockRejectedValueOnce(new Error('down'));
    renderView('/studia/schede/d1');
    expect(await screen.findByText('Non ho potuto leggere i rilievi dei validatori.')).toBeInTheDocument();
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('d1'), expect.any(Error));
    // The card itself is still there, as the list gave it.
    expect(screen.getByRole('button', { name: 'Ritira' })).toBeInTheDocument();

    get.mockResolvedValue({
      ...proposed, approvazioni: 1,
      rilievi: [{ giudizio: 'ERRATA', motivazione: 'Sbagliata.', createdAt: '2026-10-06T09:00:00Z' }],
    });
    await user.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText('Sbagliata.')).toBeInTheDocument();
    expect(screen.queryByText('Non ho potuto leggere i rilievi dei validatori.')).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });

  it('starts another card\'s detail clean: a confirmation left open does not follow the route', async () => {
    const user = userEvent.setup();
    const other = card('d2', { stato: 'PROPOSTA_COMMUNITY' });
    list.mockResolvedValue(page([proposed, other]));
    get.mockImplementation(async (id) => ({ ...(id === 'd1' ? proposed : other), approvazioni: 0, rilievi: [] }));
    renderView('/studia/schede/d1');
    await user.click(await screen.findByRole('button', { name: 'Ritira' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    // The route moves under the open dialog (the dialog hides the list from the accessibility tree).
    fireEvent.click(screen.getByText('Domanda d2?'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/studia/schede/d2'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('does not read a draft again: it has no votes', async () => {
    list.mockResolvedValue(page([draft]));
    renderView('/studia/schede/d1');
    await screen.findByRole('button', { name: 'Proponi alla comunità' });
    expect(get).not.toHaveBeenCalled();
  });
});
