import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
    expect(await screen.findByText('Nessuna scheda da validare in questa materia')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approvata' })).toBeNull();
  });

  it('says so when the queue is empty from the start', async () => {
    queue.mockResolvedValue({ cards: [] });
    render(<ValidationQueueView />);
    expect(await screen.findByText('Nessuna scheda da validare in questa materia')).toBeInTheDocument();
  });

  it('says the user is no longer a validator, and stops, on a 403 from the queue', async () => {
    queue.mockRejectedValue(rejection(403));
    render(<ValidationQueueView />);
    expect(await screen.findByText('Non sei più tra i validatori')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approvata' })).toBeNull();
    expect(queue).toHaveBeenCalledTimes(1);
  });

  it('offers to try again when the queue cannot be read', async () => {
    queue.mockRejectedValueOnce(rejection(500));
    render(<ValidationQueueView />);
    expect(await screen.findByText('Non riesco a leggere le schede da validare.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText('Domanda c1?')).toBeInTheDocument();
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
