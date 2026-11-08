import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RassegneSearchPage } from '../RassegneSearchPage';
import { clearRassegneCache } from '../useRassegne';
import { RassegneError } from '../../../../services/rassegneService';
import type { RassegnaRisultato, RassegneSearchResponse } from '../types';

const searchRassegne = vi.fn();
vi.mock('../../../../services/rassegneService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../services/rassegneService')>()),
  searchRassegne: (...args: unknown[]) => searchRassegne(...args),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

const triggerSearch = vi.fn();
vi.mock('../../../../store/useAppStore', () => ({
  useAppStore: (select: (state: { triggerSearch: typeof triggerSearch }) => unknown) => select({ triggerSearch }),
}));

const N = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:';
const CC_2043 = `${N}regio.decreto:1942-03-16;262:2~art2043`;
const L_241 = `${N}legge:1990-08-07;241`;

/** Invented passages: no text of the reviews enters the repository. */
function passo(id: string, anno: number, testo: string, archivio = 'civile'): RassegnaRisultato {
  return {
    id, anno, archivio,
    volume: { id: 900 + anno, numero: 1, titolo: `Massimario ${anno} ${archivio.toUpperCase()} Vol. 1` },
    parte: null,
    capitolo: { nome: 'CAPITOLO I', titolo: 'LA RESPONSABILITÀ' },
    sezione: { id: 1, numero: '2', titolo: 'Il danno.' },
    autori: ['Anna Rossi'],
    url: `https://example.invalid/rassegne/${id}`,
    testo,
    evidenziazioni: [],
    pronunce: [],
    fonte: 'Ufficio del Massimario',
    articoli: [
      { urn: CC_2043, citazione: 'art. 2043 cod. civ.' },
      { urn: L_241, citazione: 'legge n. 241 del 1990' },
    ],
  };
}

function answer(items: RassegnaRisultato[], extra: Partial<RassegneSearchResponse> = {}): RassegneSearchResponse {
  return {
    total: items.length, volumi: 63,
    archivi: [{ archivio: 'civile', passi: items.length }],
    items, next_cursor: null, ...extra,
  };
}

async function search(words: string) {
  const user = userEvent.setup();
  const field = screen.getByRole('searchbox', { name: 'Cerca nelle rassegne' });
  await user.clear(field);
  await user.type(field, words);
  await user.click(screen.getByRole('button', { name: 'Cerca' }));
  return user;
}

describe('RassegneSearchPage', () => {
  beforeEach(() => {
    clearRassegneCache();
    searchRassegne.mockReset();
    navigate.mockReset();
    triggerSearch.mockReset();
  });

  it('opens with the field focused and a line on what it does, asking nothing', () => {
    render(<RassegneSearchPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Rassegne' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Cerca nelle rassegne' })).toHaveFocus();
    expect(screen.getByText(/Ogni parola vale come inizio di parola/)).toBeInTheDocument();
    expect(searchRassegne).not.toHaveBeenCalled();
  });

  it('searches on submit and lists the passages with the words marked and their articles', async () => {
    searchRassegne.mockResolvedValue(answer([passo('a', 2024, 'Il danno da perdita di chance è risarcibile.')]));
    render(<RassegneSearchPage />);
    await search('perdita  chance, perdita');
    expect(searchRassegne).toHaveBeenCalledWith({ q: 'perdita chance' }); // each word once, as the API reads them
    const item = (await screen.findAllByRole('listitem'))[0];
    expect(screen.getByText('1 passo')).toBeInTheDocument();
    expect([...item.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['perdita', 'chance']);
    expect(within(item).getByText(/Rassegna civile 2024 · vol\. 1/)).toBeInTheDocument();
    expect(within(item).getByRole('link', { name: 'Apri sul portale del Massimario' })).toHaveAttribute('href', 'https://example.invalid/rassegne/a');
    // an article opens in the reader; an act without an article is plain text
    await userEvent.click(within(item).getByRole('button', { name: 'art. 2043 c.c.' }));
    expect(navigate).toHaveBeenCalledWith('/');
    expect(triggerSearch).toHaveBeenCalledWith(expect.objectContaining({ act_type: 'codice civile', article: '2043' }));
    expect(within(item).queryByRole('button', { name: 'legge n. 241 del 1990' })).toBeNull();
    expect(within(item).getByText('legge n. 241 del 1990')).toBeInTheDocument();
  });

  it('opens a long passage on the lines around the first word found, and shows it whole on request', async () => {
    const testo = `${'premessa '.repeat(40)}qui la clausola penale conta.`;
    searchRassegne.mockResolvedValue(answer([passo('a', 2024, testo)]));
    render(<RassegneSearchPage />);
    const user = await search('clausola');
    const item = (await screen.findAllByRole('listitem'))[0];
    const text = item.querySelector('p[id]')!;
    expect(text.textContent!.startsWith('… ')).toBe(true);
    expect(text.textContent!.length).toBeLessThan(testo.length);
    const toggle = within(item).getByRole('button', { name: 'Leggi tutto il passo' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(text.textContent).toBe(testo);
    expect(within(item).getByRole('button', { name: 'Mostra meno' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('refuses words past the limits without asking, and says why', async () => {
    render(<RassegneSearchPage />);
    await search('uno due tre quattro cinque sei sette otto nove');
    expect(screen.getByRole('alert')).toHaveTextContent('Al massimo 8 parole e 200 caratteri.');
    expect(screen.getByRole('searchbox')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await search('a b');
    expect(screen.getByText('Scrivi parole di almeno due lettere o cifre.')).toBeInTheDocument();
    expect(searchRassegne).not.toHaveBeenCalled();
  });

  it('says when nothing is found, when no store is built, and when the reviews cannot answer', async () => {
    searchRassegne.mockResolvedValueOnce(answer([], { archivi: [] }));
    render(<RassegneSearchPage />);
    await search('zzqx');
    expect(await screen.findByText('Nessun passo contiene tutte queste parole.')).toBeInTheDocument();

    searchRassegne.mockResolvedValueOnce(answer([], { archivi: [], volumi: 0 }));
    await search('danno');
    expect(await screen.findByText('Le rassegne non sono ancora caricate su questa installazione.')).toBeInTheDocument();

    searchRassegne.mockRejectedValueOnce(new RassegneError(503));
    await search('danno');
    expect(await screen.findByText('Le rassegne non sono disponibili al momento.')).toBeInTheDocument();
    searchRassegne.mockRejectedValueOnce(new RassegneError(429));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText(/Hai fatto molte ricerche in poco tempo/)).toBeInTheDocument();
    searchRassegne.mockResolvedValueOnce(answer([passo('a', 2024, 'Il danno.')]));
    await user.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText('1 passo')).toBeInTheDocument();
    expect(searchRassegne).toHaveBeenLastCalledWith({ q: 'danno' });
  });

  it('filters by archive with the counts of both, and loads more passages handing over the focus', async () => {
    const civile = passo('c1', 2024, 'Il danno civile.');
    const penale = passo('p1', 2023, 'Il danno penale.', 'penale');
    const archivi = [{ archivio: 'civile', passi: 3 }, { archivio: 'penale', passi: 1 }];
    searchRassegne.mockResolvedValueOnce(answer([civile, penale], { total: 4, archivi, next_cursor: '2' }));
    render(<RassegneSearchPage />);
    const user = await search('danno');
    expect(await screen.findByText('4 passi')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Archivio' });
    expect(within(group).getByRole('button', { name: 'Tutti 4' })).toHaveAttribute('aria-pressed', 'true');

    searchRassegne.mockResolvedValueOnce(answer([passo('c3', 2022, 'Altro danno.')]));
    await user.click(screen.getByRole('button', { name: 'Altri passi' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3));
    expect(searchRassegne).toHaveBeenLastCalledWith({ q: 'danno', cursor: '2' });
    expect(screen.getAllByRole('listitem')[2]).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Altri passi' })).toBeNull();

    // another archive keeps the list and the filter while it loads: the focus stays where it was
    let answerPenale: (value: RassegneSearchResponse) => void = () => {};
    searchRassegne.mockReturnValueOnce(new Promise<RassegneSearchResponse>((resolve) => { answerPenale = resolve; }));
    const penaleButton = within(group).getByRole('button', { name: 'Penale 1' });
    await user.click(penaleButton);
    expect(searchRassegne).toHaveBeenLastCalledWith({ q: 'danno', archivio: 'penale' });
    expect(screen.getByText('Aggiorno…')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(penaleButton).toHaveFocus();
    expect(penaleButton).toHaveAttribute('aria-pressed', 'true');
    answerPenale(answer([penale], { total: 1, archivi }));
    expect(await screen.findByText('1 passo')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(penaleButton).toHaveFocus();
  });

  it('finds the last search as it was on the way back from an article, and forgets it at logout', async () => {
    searchRassegne.mockResolvedValue(answer([passo('a', 2024, 'Il danno ingiusto.')]));
    const first = render(<RassegneSearchPage />);
    await search('ingiusto');
    await screen.findByText('1 passo');
    first.unmount();

    const back = render(<RassegneSearchPage />);
    expect(screen.getByRole('searchbox')).toHaveValue('ingiusto');
    expect(screen.getByText('1 passo')).toBeInTheDocument();
    expect(searchRassegne).toHaveBeenCalledTimes(1);
    back.unmount();

    clearRassegneCache(); // what the logout runs
    render(<RassegneSearchPage />);
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.queryByText('1 passo')).toBeNull();
  });

  it('never writes the words to the console when a search fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    searchRassegne.mockRejectedValueOnce(new RassegneError(503));
    render(<RassegneSearchPage />);
    await search('parolasegretissima');
    await screen.findByText('Le rassegne non sono disponibili al momento.');
    expect(JSON.stringify(error.mock.calls)).not.toContain('parolasegretissima');
    error.mockRestore();
  });
});
