import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../../../services/studiaService', () => ({
  studiaService: { list: vi.fn(), get: vi.fn(), trash: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

import { studiaService } from '../../../services/studiaService';
import { appStore } from '../../../store/useAppStore';
import type { Scheda, StatoScheda } from '../../../types/studia';
import { MyCardsView } from './MyCardsView';

const list = vi.mocked(studiaService.list);
const get = vi.mocked(studiaService.get);
const trash = vi.mocked(studiaService.trash);

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
  list.mockResolvedValue(page(FIVE));
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

  it('invites to write the first card when there is none', async () => {
    list.mockResolvedValue(page([]));
    renderView();
    expect(await screen.findByText('Nessuna scheda ancora. Aprine una da un articolo con “+ Nuova scheda”, o chiedi a Claude di scriverne.')).toBeInTheDocument();
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

  it('asks for the cards Claude wrote and the user has yet to read', async () => {
    renderView();
    await screen.findAllByRole('link');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Scritte da Claude, da rileggere' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ origine: 'applicazione', stato: 'BOZZA_PERSONALE' })));
    expect(screen.getByRole('combobox', { name: 'Stato' })).toBeDisabled();
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
    list.mockResolvedValue(page([card('r1', { spiegazione: 'Perché la prestazione è corrispettiva.', stato: 'DA_RIVEDERE', origine: { clientName: 'Claude Code' } })]));
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
  const openConfirm = async () => {
    renderView('/studia/schede/r1');
    const detail = await screen.findByRole('article', { name: 'Scheda' });
    await userEvent.setup().click(within(detail).getByRole('button', { name: 'Elimina' }));
    return screen.findByRole('alertdialog');
  };

  it('asks first, saying where the card goes', async () => {
    const dialog = await openConfirm();
    expect(dialog).toHaveTextContent('La scheda va nel cestino per 30 giorni. Le altre schede non sono toccate.');
    expect(trash).not.toHaveBeenCalled();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(trash).not.toHaveBeenCalled();
  });

  it('moves the card to the trash, says so, and returns to the list', async () => {
    trash.mockResolvedValue({ trashId: 't1', moved: ['r1'], notFound: [], notDeletable: [] });
    const dialog = await openConfirm();
    list.mockResolvedValue(page(FIVE.filter((c) => c.id !== 'r1')));
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Elimina' }));
    expect(trash).toHaveBeenCalledWith(['r1']);
    expect(await screen.findByText('Scheda nel cestino')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/schede');
    await waitFor(() => expect(screen.queryByRole('link', { name: /Domanda r1\?/ })).not.toBeInTheDocument());
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('says plainly when the card can no longer be deleted, and stays on it', async () => {
    trash.mockResolvedValue({ moved: [], notFound: [], notDeletable: ['r1'] });
    const dialog = await openConfirm();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Elimina' }));
    expect(await screen.findByText(/non si può eliminare nello stato in cui si trova/)).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/schede/r1');
  });

  it('says plainly when the card is gone already', async () => {
    trash.mockResolvedValue({ moved: [], notFound: ['r1'], notDeletable: [] });
    const dialog = await openConfirm();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Elimina' }));
    expect(await screen.findByText(/La scheda non c’è più/)).toBeInTheDocument();
  });

  it('says what failed and what to do when the trash cannot be reached', async () => {
    trash.mockRejectedValue(new Error('down'));
    const dialog = await openConfirm();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Elimina' }));
    expect(await screen.findByText('Non sono riuscito a spostare la scheda nel cestino. Riprova.')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/schede/r1');
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
