import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';

vi.mock('../../../services/studiaService', () => ({
  studiaService: { queue: vi.fn(), vote: vi.fn() },
}));
vi.mock('../../../utils/articleFetchCache', () => ({ fetchArticleForNorma: vi.fn() }));

import { studiaService } from '../../../services/studiaService';
import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { fixtureText } from '../../../utils/__fixtures__/articleTexts';
import type { Scheda } from '../../../types/studia';
import { ValidationQueueView } from './ValidationQueueView';

const queue = vi.mocked(studiaService.queue);
const vote = vi.mocked(studiaService.vote);
const fetchArticle = vi.mocked(fetchArticleForNorma);

const CIVILE_URN = 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453';
const LEGGE_URN = 'urn:nir:stato:legge:1990-08-07;241~art2';
const RAW = fixtureText('nrm-cc-1453');
const STORAGE_KEY = 'visualex.studia.valida.materia';

const card = (id: string, extra: Partial<Scheda> = {}): Scheda => ({
  id, materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione per inadempimento', tipo: 'ISTITUTO_DEFINIZIONE',
  domanda: `Domanda ${id}?`, risposta: `Risposta ${id}.`, spiegazione: null, stato: 'PROPOSTA_COMMUNITY',
  createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z', origine: null,
  ancore: [{ normaKey: 'codice_civile', articleId: 'art_1453', urn: CIVILE_URN, isPrimary: true }],
  ...extra,
});

/** jsdom has no viewport: the phone's layout is the default, the desktop's is chosen here. */
function setDesktop(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** The project's setup ships a partial localStorage mock: a working in-memory one is installed here. */
function installMemoryStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
  } as Storage);
}

const rejection = (status: number) => Object.assign(new Error(`status ${status}`), { status });

beforeEach(() => {
  setDesktop(true);
  installMemoryStorage();
  queue.mockReset();
  vote.mockReset();
  fetchArticle.mockReset();
  queue.mockResolvedValue({ cards: [card('c1'), card('c2')] });
  vote.mockResolvedValue({ stato: 'PROPOSTA_COMMUNITY' });
  fetchArticle.mockResolvedValue({ article_text: RAW, norma_data: { tipo_atto: 'codice civile', data: '1942-03-16', numero_articolo: '1453' } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setDesktop(false);
});

describe('«Da validare», the card and its article', () => {
  it('shows the first card with its anchors and the primary article beside it', async () => {
    const second = card('c1', {
      spiegazione: 'Perché la controparte possa sciogliersi.',
      ancore: [
        { normaKey: 'codice_civile', articleId: 'art_1453', urn: CIVILE_URN, isPrimary: true },
        { normaKey: 'l_241_1990', articleId: 'art_2', urn: LEGGE_URN, isPrimary: false },
      ],
    });
    queue.mockResolvedValue({ cards: [second, card('c2')] });
    render(<ValidationQueueView />);

    expect(await screen.findByRole('heading', { name: 'Risoluzione per inadempimento · art. 1453 c.c.' })).toBeInTheDocument();
    expect(screen.getByText('Domanda c1?')).toBeInTheDocument();
    expect(screen.getByText('Risposta c1.')).toBeInTheDocument();
    expect(screen.getByText('Perché la controparte possa sciogliersi.')).toBeInTheDocument();
    expect(screen.getByText('art. 2, l. 7 agosto 1990, n. 241')).toBeInTheDocument();
    expect(screen.queryByText('Domanda c2?')).toBeNull();

    // The article of the primary anchor, read from the address the anchor holds.
    expect(await screen.findByText(/Nei contratti con prestazioni corrispettive/)).toBeInTheDocument();
    expect(fetchArticle).toHaveBeenCalledTimes(1);
    expect(fetchArticle).toHaveBeenCalledWith(expect.objectContaining({ tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1453' }));
    // Read-only: no sign to annotate, no note to add.
    expect(screen.queryByRole('button', { name: /Aggiungi nota/ })).toBeNull();
    expect(queue).toHaveBeenCalledWith({ limit: 10 });
  });

  it('puts the article in a collapsed section under the card on a phone, and reads it only once opened', async () => {
    setDesktop(false);
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    const toggle = screen.getByRole('button', { name: 'Testo dell’articolo' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(fetchArticle).not.toHaveBeenCalled();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText(/Nei contratti con prestazioni corrispettive/)).toBeInTheDocument();
    expect(fetchArticle).toHaveBeenCalledTimes(1);
  });

  it('shows the citation and a short note when the anchor’s address cannot be turned into an article', async () => {
    const lost = 'urn:nir:stato:regio.decreto:1942-03-16;262~art1218';
    queue.mockResolvedValue({ cards: [card('c1', { ancore: [{ normaKey: 'x', articleId: 'y', urn: lost, isPrimary: true }] })] });
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    expect(screen.getByText('Il testo di questo articolo non si può aprire qui.')).toBeInTheDocument();
    expect(screen.getByText(lost)).toBeInTheDocument();
    expect(fetchArticle).not.toHaveBeenCalled();
  });

  it('says the text could not be read, with a way to try again', async () => {
    fetchArticle.mockRejectedValueOnce(new Error('Testo non disponibile'));
    render(<ValidationQueueView />);
    expect(await screen.findByText('Testo non disponibile')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText(/Nei contratti con prestazioni corrispettive/)).toBeInTheDocument();
  });

  it('renders the stored text as text, never as markup', async () => {
    queue.mockResolvedValue({ cards: [card('c1', { domanda: '<img src=x onerror=alert(1)>', risposta: '<b>grassetto</b>' })] });
    const { container } = render(<ValidationQueueView />);
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.getByText('<b>grassetto</b>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });
});

describe('«Da validare», voting', () => {
  it('sends «Approvata» at once and shows the next card', async () => {
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    await userEvent.click(screen.getByRole('button', { name: 'Approvata' }));
    expect(vote).toHaveBeenCalledWith('c1', 'APPROVATA', undefined);
    expect(await screen.findByText('Domanda c2?')).toBeInTheDocument();
    expect(screen.queryByText('Domanda c1?')).toBeNull();
  });

  it.each([
    ['Migliorabile', 'MIGLIORABILE'],
    ['Errata', 'ERRATA'],
  ] as const)('«%s» asks for the reason first, then sends it', async (label, giudizio) => {
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    await userEvent.click(screen.getByRole('button', { name: label }));
    expect(vote).not.toHaveBeenCalled();

    const reason = screen.getByRole('textbox', { name: 'Scrivi il motivo' });
    const send = screen.getByRole('button', { name: 'Invia' });
    expect(send).toBeDisabled();
    await userEvent.type(reason, '   ');
    expect(send).toBeDisabled();
    await userEvent.clear(reason);
    await userEvent.type(reason, 'La risposta non cita la diffida.');
    expect(screen.getByText('32 / 2000')).toBeInTheDocument();
    expect(reason).toHaveAttribute('maxLength', '2000');
    await userEvent.click(send);

    expect(vote).toHaveBeenCalledWith('c1', giudizio, 'La risposta non cita la diffida.');
    expect(await screen.findByText('Domanda c2?')).toBeInTheDocument();
    // The next card starts with no reason field open.
    expect(screen.queryByRole('textbox', { name: 'Scrivi il motivo' })).toBeNull();
  });

  it('lets the validator take the reason field back without voting', async () => {
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    await userEvent.click(screen.getByRole('button', { name: 'Errata' }));
    await userEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.queryByRole('textbox', { name: 'Scrivi il motivo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Approvata' })).toBeInTheDocument();
    expect(vote).not.toHaveBeenCalled();
  });

  it('keeps the card and says so when the vote could not be sent', async () => {
    vote.mockRejectedValueOnce(rejection(500));
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    await userEvent.click(screen.getByRole('button', { name: 'Approvata' }));
    expect(await screen.findByText('Non sono riuscito a registrare il voto. Riprova.')).toBeInTheDocument();
    expect(screen.getByText('Domanda c1?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approvata' }));
    expect(await screen.findByText('Domanda c2?')).toBeInTheDocument();
  });

  it.each([
    [404, 'La scheda non è più in coda: passo alla prossima.'],
    [409, 'Hai già votato questa scheda: passo alla prossima.'],
  ])('skips to the next card with a short word on a %i', async (status, message) => {
    vote.mockRejectedValueOnce(rejection(status));
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    await userEvent.click(screen.getByRole('button', { name: 'Approvata' }));
    expect(await screen.findByText('Domanda c2?')).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('stops when a vote is refused because the user is no longer a validator', async () => {
    vote.mockRejectedValueOnce(rejection(403));
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    await userEvent.click(screen.getByRole('button', { name: 'Approvata' }));
    expect(await screen.findByText('Non sei più tra i validatori')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approvata' })).toBeNull();
    expect(screen.queryByText('Domanda c2?')).toBeNull();
  });
});

describe('«Da validare», the keyboard and the vote bar', () => {
  it('keeps the vote bar pinned to the bottom at every width, with its own background', async () => {
    for (const desktop of [true, false]) {
      setDesktop(desktop);
      const { unmount } = render(<ValidationQueueView />);
      await screen.findByText('Domanda c1?');
      const bar = screen.getByRole('group', { name: 'Il tuo giudizio' }).parentElement!;
      expect(bar).toHaveClass('sticky', 'bottom-0', 'border-t', 'bg-slate-50');
      expect(bar.className).not.toMatch(/\bmd:(static|bg-transparent|border-t-0)\b/);
      unmount();
    }
  });

  it('moves the keyboard to the next card’s heading after a vote', async () => {
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    const approve = screen.getByRole('button', { name: 'Approvata' });
    approve.focus();
    await userEvent.click(approve);
    await screen.findByText('Domanda c2?');
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveAttribute('tabindex', '-1');
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('moves the keyboard after a vote with a reason as well', async () => {
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    await userEvent.click(screen.getByRole('button', { name: 'Errata' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Scrivi il motivo' }), 'No.');
    await userEvent.click(screen.getByRole('button', { name: 'Invia' }));
    await screen.findByText('Domanda c2?');
    await waitFor(() => expect(screen.getByRole('heading', { level: 3 })).toHaveFocus());
  });

  it('does not take the keyboard away when the card is not left (the vote failed) or on the first card', async () => {
    vote.mockRejectedValueOnce(rejection(500));
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    expect(screen.getByRole('heading', { level: 3 })).not.toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Approvata' }));
    await screen.findByText('Non sono riuscito a registrare il voto. Riprova.');
    expect(screen.getByRole('heading', { level: 3 })).not.toHaveFocus();
  });
});

describe('«Da validare», the queue', () => {
  it('reads the queue again when it runs low, without showing the same card twice', async () => {
    queue.mockResolvedValueOnce({ cards: [card('c1'), card('c2')] });
    queue.mockResolvedValueOnce({ cards: [card('c2'), card('c3')] });
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    expect(queue).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Approvata' }));
    await screen.findByText('Domanda c2?');
    await waitFor(() => expect(queue).toHaveBeenCalledTimes(2));

    await userEvent.click(screen.getByRole('button', { name: 'Approvata' }));
    expect(await screen.findByText('Domanda c3?')).toBeInTheDocument();
    expect(vote.mock.calls.map((call) => call[0])).toEqual(['c1', 'c2']);
  });

  it('says there is nothing left once the last card is voted and the queue has no more', async () => {
    queue.mockResolvedValueOnce({ cards: [card('c1')] });
    queue.mockResolvedValueOnce({ cards: [] });
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    await userEvent.click(screen.getByRole('button', { name: 'Approvata' }));
    expect(await screen.findByText('Nessuna scheda da validare')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approvata' })).toBeNull();
  });

  it('says so when the queue is empty from the start', async () => {
    queue.mockResolvedValue({ cards: [] });
    render(<ValidationQueueView />);
    expect(await screen.findByText('Nessuna scheda da validare')).toBeInTheDocument();
  });

  it('names the subject when one is chosen and nothing is left in it', async () => {
    localStorage.setItem(STORAGE_KEY, 'DIRITTO_PENALE');
    queue.mockResolvedValue({ cards: [] });
    render(<ValidationQueueView />);
    expect(await screen.findByText('Nessuna scheda da validare in questa materia')).toBeInTheDocument();
  });

  it('tells someone who never was a validator that the section is theirs only', async () => {
    queue.mockRejectedValue(rejection(403));
    render(
      <MemoryRouter initialEntries={['/studia/valida']}>
        <Routes>
          <Route path="/studia" element={<Outlet context={{ validator: false }} />}>
            <Route path="valida" element={<ValidationQueueView />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Questa sezione è riservata ai validatori di VisuaLex Gymnasium')).toBeInTheDocument();
    expect(screen.queryByText('Non sei più tra i validatori')).toBeNull();
    // The account already said so: no request the server would refuse.
    expect(queue).not.toHaveBeenCalled();
  });

  it('reads the queue when the account could not be read, and lets the server decide', async () => {
    const area = (
      <MemoryRouter initialEntries={['/studia/valida']}>
        <Routes>
          <Route path="/studia" element={<Outlet context={{ validator: null }} />}>
            <Route path="valida" element={<ValidationQueueView />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    // A validator whose /auth/me failed still gets the cards.
    const first = render(area);
    expect(await screen.findByText('Domanda c1?')).toBeInTheDocument();
    first.unmount();

    // Someone who is not one gets the server's refusal, worded as before the account was asked.
    queue.mockRejectedValue(rejection(403));
    render(area);
    expect(await screen.findByText('Questa sezione è riservata ai validatori di VisuaLex Gymnasium')).toBeInTheDocument();
    expect(queue).toHaveBeenCalledTimes(2);
  });

  it('waits for the account before reading the queue, and reads it for a validator', async () => {
    const area = (validator: boolean | undefined) => (
      <MemoryRouter initialEntries={['/studia/valida']}>
        <Routes>
          <Route path="/studia" element={<Outlet context={{ validator }} />}>
            <Route path="valida" element={<ValidationQueueView />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    const { rerender } = render(area(undefined));
    expect(screen.getByText('Carico le schede…')).toBeInTheDocument();
    await act(async () => {});
    expect(queue).not.toHaveBeenCalled();

    rerender(area(true));
    expect(await screen.findByText('Domanda c1?')).toBeInTheDocument();
    expect(queue).toHaveBeenCalledTimes(1);
  });

  it('says the user is no longer a validator, and stops, on a 403 from the queue', async () => {
    queue.mockRejectedValue(rejection(403));
    render(<ValidationQueueView />);
    expect(await screen.findByText('Non sei più tra i validatori')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approvata' })).toBeNull();
    expect(queue).toHaveBeenCalledTimes(1);
  });

  it('keeps the cards in hand, and says in the console, when a background refill fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    queue.mockResolvedValueOnce({ cards: [card('c1'), card('c2')] });
    queue.mockRejectedValueOnce(rejection(500));
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    await userEvent.click(screen.getByRole('button', { name: 'Approvata' }));
    expect(await screen.findByText('Domanda c2?')).toBeInTheDocument();
    await waitFor(() => expect(warn).toHaveBeenCalledWith('[useValidationQueue] reading the queue failed', expect.any(Error)));
    expect(screen.getByRole('button', { name: 'Approvata' })).toBeInTheDocument();
    warn.mockRestore();
  });

  it('offers to try again when the queue cannot be read', async () => {
    queue.mockRejectedValueOnce(rejection(500));
    render(<ValidationQueueView />);
    expect(await screen.findByText('Non riesco a leggere le schede da validare.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText('Domanda c1?')).toBeInTheDocument();
  });
});

describe('«Da validare», a subject change while a vote is on its way', () => {
  const PENALE = card('p1', { materia: 'DIRITTO_PENALE' });
  const answerByMateria = () =>
    queue.mockImplementation(async (params) => ({ cards: params?.materia === 'DIRITTO_PENALE' ? [PENALE] : [card('c1'), card('c2')] }));
  const deferred = () => {
    let resolve!: (value: { stato: 'PROPOSTA_COMMUNITY' }) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<{ stato: 'PROPOSTA_COMMUNITY' }>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it('says the points of the vote on its message, whatever the verdict (G1c)', async () => {
    answerByMateria();
    const livello = { livello: 1, totale: 20, nelLivello: 20, perIlProssimo: 100, oggi: 20 };
    vote.mockResolvedValueOnce({ stato: 'PROPOSTA_COMMUNITY', xp: { crediti: [{ missione: 'convalida', punti: 20 }], livello, nuovoLivello: false } });
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    await userEvent.click(screen.getByRole('button', { name: 'Approvata' }));
    expect(await screen.findByText('Voto registrato · +20 XP')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('visualex.studia.visto')!)).toMatchObject({ xp: 20 });
    localStorage.removeItem('visualex.studia.visto');
  });

  it('says no points for a vote that earned none, nor for a vote refused (409)', async () => {
    answerByMateria();
    const livello = { livello: 1, totale: 20, nelLivello: 20, perIlProssimo: 100, oggi: 20 };
    vote.mockResolvedValueOnce({ stato: 'PROPOSTA_COMMUNITY', xp: { crediti: [], livello, nuovoLivello: false } });
    vote.mockRejectedValueOnce({ status: 409 });
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    await userEvent.click(screen.getByRole('button', { name: 'Approvata' }));
    expect(await screen.findByText('Voto registrato')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Approvata' }));
    expect(await screen.findByText('Hai già votato questa scheda: passo alla prossima.')).toBeInTheDocument();
    expect(screen.queryByText(/XP/)).toBeNull();
    localStorage.removeItem('visualex.studia.visto');
  });

  it('keeps showing the new subject’s card, never stuck on «Carico le schede…», once the vote resolves', async () => {
    answerByMateria();
    const pending = deferred();
    vote.mockReturnValueOnce(pending.promise);
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    await userEvent.click(screen.getByRole('button', { name: 'Approvata' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Materia' }), 'Diritto penale');
    expect(await screen.findByText('Domanda p1?')).toBeInTheDocument();
    const readings = queue.mock.calls.length;

    await act(async () => pending.resolve({ stato: 'PROPOSTA_COMMUNITY' }));
    expect(await screen.findByText('Voto registrato')).toBeInTheDocument();
    expect(screen.getByText('Domanda p1?')).toBeInTheDocument();
    expect(screen.queryByText('Carico le schede…')).toBeNull();
    // The old subject is not read again for the vote that finished.
    expect(queue).toHaveBeenCalledTimes(readings);
  });

  it('stops the new subject’s queue as well when that vote is refused because the user is no longer a validator', async () => {
    answerByMateria();
    const pending = deferred();
    vote.mockReturnValueOnce(pending.promise);
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    await userEvent.click(screen.getByRole('button', { name: 'Approvata' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Materia' }), 'Diritto penale');
    await screen.findByText('Domanda p1?');

    await act(async () => pending.reject(rejection(403)));
    expect(await screen.findByText('Non sei più tra i validatori')).toBeInTheDocument();
    expect(screen.queryByText('Carico le schede…')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approvata' })).toBeNull();
  });

  it('skips a card gone (404) in the same way', async () => {
    answerByMateria();
    const pending = deferred();
    vote.mockReturnValueOnce(pending.promise);
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    await userEvent.click(screen.getByRole('button', { name: 'Approvata' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Materia' }), 'Diritto penale');
    await screen.findByText('Domanda p1?');

    await act(async () => pending.reject(rejection(404)));
    expect(await screen.findByText('La scheda non è più in coda: passo alla prossima.')).toBeInTheDocument();
    expect(screen.getByText('Domanda p1?')).toBeInTheDocument();
  });
});

describe('«Da validare», the subject filter', () => {
  it('offers all subjects and the five, and reads the queue of the one chosen', async () => {
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    const select = screen.getByRole('combobox', { name: 'Materia' });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Tutte le materie', 'Diritto civile', 'Diritto penale', 'Diritto amministrativo', 'Diritto processuale civile', 'Diritto processuale penale',
    ]);

    queue.mockResolvedValue({ cards: [card('p1', { materia: 'DIRITTO_PENALE' })] });
    await userEvent.selectOptions(select, 'Diritto penale');
    expect(await screen.findByText('Domanda p1?')).toBeInTheDocument();
    expect(queue).toHaveBeenLastCalledWith({ materia: 'DIRITTO_PENALE', limit: 10 });
    expect(screen.queryByText('Domanda c1?')).toBeNull();
  });

  it('remembers the subject and uses it on the next visit', async () => {
    const first = render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Materia' }), 'Diritto penale');
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('DIRITTO_PENALE'));
    first.unmount();

    queue.mockClear();
    render(<ValidationQueueView />);
    await waitFor(() => expect(queue).toHaveBeenCalledWith({ materia: 'DIRITTO_PENALE', limit: 10 }));
    expect(screen.getByRole('combobox', { name: 'Materia' })).toHaveValue('DIRITTO_PENALE');
  });

  it('forgets a stored value that is no subject, and clears the memory on «Tutte le materie»', async () => {
    localStorage.setItem(STORAGE_KEY, 'ALTRO');
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    expect(queue).toHaveBeenCalledWith({ limit: 10 });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Materia' }), 'Diritto civile');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Materia' }), 'Tutte le materie');
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBeNull());
  });

  it('works when the browser refuses its storage', async () => {
    const denied = () => {
      throw new Error('denied');
    };
    vi.stubGlobal('localStorage', { getItem: denied, setItem: denied, removeItem: denied, clear: denied, length: 0, key: denied } as Storage);
    render(<ValidationQueueView />);
    await screen.findByText('Domanda c1?');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Materia' }), 'Diritto penale');
    await waitFor(() => expect(queue).toHaveBeenLastCalledWith({ materia: 'DIRITTO_PENALE', limit: 10 }));
  });
});
