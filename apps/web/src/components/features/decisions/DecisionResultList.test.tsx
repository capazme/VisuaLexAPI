import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { DecisionSearchHit, SearchDecisionsAnswer } from '../../../types/decisions';

vi.mock('../../../services/decisionSearchService');
import { searchDecisions } from '../../../services/decisionSearchService';
import { DecisionResultList } from './DecisionResultList';
import { clearDecisionSearchCache } from '../../../utils/decisionSearchCache';
import { CaseLawFiltersContext } from '../search/caseLaw/caseLawFiltersContext';
import { NO_FILTERS } from '../search/caseLaw/caseLawFilter';

const NORMA = { tipo_atto: 'codice civile', numero_articolo: '2043' };
const HIT: DecisionSearchHit = {
  identita: { corte: 'cassazione', archivio: 'civile', numero: 24908, anno: 2026 },
  attributi: { sezione: 'L', tipo: 'ordinanza', data_deposito: '2026-09-01' },
  trovata: 'indice',
  frammento: { testo: 'ex art. 2043 c.c.', evidenziati: [[3, 17]] },
};
type Page = Extract<SearchDecisionsAnswer, { esito: 'risultati' }>;
const PAGE: Page = { esito: 'risultati', totale: 1, pagina: 1, modo: 'indice', archivio: 'civile', archivio_dal: '2021-01-04', decisioni: [HIT] };
const PAGE_INDEX: Page = { ...PAGE, totale: 3904 };
const PAGE_TEXT: Page = { ...PAGE, totale: 312, modo: 'testo', decisioni: [{ ...HIT, trovata: 'testo' }] };

const searchMock = vi.mocked(searchDecisions);
const mockSearch = (answer: SearchDecisionsAnswer) => searchMock.mockResolvedValueOnce(answer);
const Wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const QUERY = { norma: NORMA, normaLabel: 'art. 2043 c.c.' };

beforeEach(() => searchMock.mockReset());

describe('DecisionResultList', () => {
  it('labels each row by how it was found', async () => {
    mockSearch({ esito: 'risultati', totale: 3904, pagina: 1, modo: 'indice', archivio: 'civile', archivio_dal: '2021-01-04', decisioni: [{ ...HIT, trovata: 'indice', frammento: null }] });
    render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    expect(await screen.findByText('norma citata (indice della Cassazione)')).toBeInTheDocument();
    expect(screen.getByText('3.904 decisioni nell’archivio pubblico della Cassazione (dal 4 gennaio 2021)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Indice della Cassazione' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches to the text and says so', async () => {
    mockSearch(PAGE_INDEX); mockSearch({ ...PAGE_TEXT, modo: 'testo' });
    render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    await userEvent.click(await screen.findByRole('button', { name: 'Nel testo' }));
    expect(searchMock).toHaveBeenLastCalledWith(expect.anything(), 1, 'testo');
    expect(await screen.findByText('menzionato nel testo')).toBeInTheDocument();
  });

  it('shows the count, the coverage and each row as «menzionato nel testo»', async () => {
    mockSearch({ esito: 'risultati', totale: 312, pagina: 1, modo: 'testo', archivio: 'civile', archivio_dal: '2021-01-04', decisioni: [{ ...HIT, trovata: 'testo' }] });
    render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    expect(await screen.findByText('312 decisioni nell’archivio pubblico della Cassazione (dal 4 gennaio 2021)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Cass\. civ\., sez\. lav\., n\. 24908\/2026/ })).toHaveAttribute('href', '/sentenze/cassazione-civile/24908/2026');
    expect(screen.getByText('menzionato nel testo')).toBeInTheDocument();
  });

  it('says the index cannot express an act searched in the text', async () => {
    mockSearch(PAGE_TEXT);
    render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    await screen.findByText('menzionato nel testo');
    expect(screen.getByRole('button', { name: 'Nel testo' })).toHaveAttribute('aria-pressed', 'true');
    const index = screen.getByRole('button', { name: 'Indice della Cassazione' });
    expect(index).toBeDisabled();
    expect(index).toHaveAttribute('title', 'L’indice della Cassazione non esprime questo atto');
    // the reason is also visible text, tied to the button
    expect(screen.getByText('L’indice della Cassazione non esprime questo atto')).toHaveAttribute('id', index.getAttribute('aria-describedby')!);
  });

  it('emphasises the matched words as text, never as HTML, past an astral character', async () => {
    const testo = '𝔄 ex art. 2043 c.c. <img src=x onerror=alert(1)>';
    mockSearch({ ...PAGE, decisioni: [{ ...HIT, frammento: { testo, evidenziati: [[5, 19]] } }] });
    const { container } = render(<Wrapper><DecisionResultList query={{ tema: 'x y' }} /></Wrapper>);
    await screen.findByText('art. 2043 c.c.', { selector: 'mark' });
    expect(container.querySelector('img')).toBeNull();
    expect(searchMock).toHaveBeenCalledWith({ norma: undefined, tema: 'x y', archivio: undefined }, 1, undefined);
  });

  it('says the act is not supported, and a source that is down, with «Riprova»', async () => {
    mockSearch({ esito: 'non_supportata' });
    const { unmount } = render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    expect(await screen.findByText('La ricerca nelle sentenze non è disponibile per questo atto.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Riprova' })).toBeNull();
    unmount();

    mockSearch({ esito: 'fonte_non_raggiungibile', fonte: 'cassazione' });
    mockSearch(PAGE);
    render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    expect(await screen.findByText('L’archivio della Cassazione non risponde in questo momento.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('link', { name: /n\. 24908\/2026/ })).toBeInTheDocument();
    expect(screen.queryByText('L’archivio della Cassazione non risponde in questo momento.')).toBeNull();
  });

  it('has its own line for an invalid request, an internal error, and a rejected call', async () => {
    mockSearch({ esito: 'richiesta_non_valida', errori: { pagina: 'La pagina va da 1 a 10' } });
    const first = render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    expect(await screen.findByText('La ricerca non è valida: controllala e riprova.')).toBeInTheDocument();
    expect(screen.queryByText(/pagina/)).toBeNull();
    first.unmount();
    mockSearch({ esito: 'errore_interno' });
    const second = render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    expect(await screen.findByText('La ricerca non è riuscita per un errore dell’applicazione.')).toBeInTheDocument();
    second.unmount();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    searchMock.mockRejectedValueOnce(new TypeError('network'));
    render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    expect(await screen.findByText('L’archivio della Cassazione non risponde in questo momento.')).toBeInTheDocument();
    logged.mockRestore();
  });

  it('says there is none in the last five years, never «nessuna decisione» alone', async () => {
    mockSearch({ ...PAGE, totale: 0, decisioni: [] });
    render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    expect(await screen.findByText('Nessuna decisione negli ultimi cinque anni dell’archivio pubblico della Cassazione.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Altri risultati' })).toBeNull();
  });

  it('appends the next page and stops at the tenth', async () => {
    const pageOf = (pagina: number): Page => ({
      ...PAGE, totale: 400, pagina,
      decisioni: [{ ...HIT, identita: { ...HIT.identita, numero: 1000 + pagina } }],
    });
    for (let p = 1; p <= 10; p++) mockSearch(pageOf(p));
    render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    for (let p = 2; p <= 10; p++) {
      await userEvent.click(await screen.findByRole('button', { name: 'Altri risultati' }));
      await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(p));
      expect(searchMock).toHaveBeenLastCalledWith(expect.anything(), p, 'indice');
      await screen.findByRole('link', { name: new RegExp(`n\\. ${1000 + p}/2026`) });
    }
    expect(screen.getAllByRole('link')).toHaveLength(10);
    expect(screen.queryByRole('button', { name: 'Altri risultati' })).toBeNull();
    expect(screen.getByText('Mostrate le prime 200: restringi la ricerca con un tema.')).toBeInTheDocument();
  });

  it('says «con altre parole» in the cap line of a topic', async () => {
    const pageOf = (pagina: number): Page => ({ ...PAGE, totale: 400, pagina, decisioni: [{ ...HIT, identita: { ...HIT.identita, numero: 2000 + pagina } }] });
    for (let p = 1; p <= 10; p++) mockSearch(pageOf(p));
    render(<Wrapper><DecisionResultList query={{ tema: 'colpa' }} /></Wrapper>);
    for (let p = 2; p <= 10; p++) {
      await userEvent.click(await screen.findByRole('button', { name: 'Altri risultati' }));
      await screen.findByRole('link', { name: new RegExp(`n\\. ${2000 + p}/2026`) });
    }
    expect(screen.getByText('Mostrate le prime 200: restringi la ricerca con altre parole.')).toBeInTheDocument();
  });

  it('keeps what it learned about an article while the query is a topic, and back', async () => {
    const NUMBERED = { tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', numero_articolo: '2' };
    const withArticle = { norma: NUMBERED, tema: 'colpa' };
    mockSearch({ ...PAGE_TEXT, archivio: null }); // the article: the route searches both
    const { rerender } = render(<Wrapper><DecisionResultList query={withArticle} /></Wrapper>);
    expect(await screen.findByRole('button', { name: 'Entrambi' })).toBeInTheDocument();
    mockSearch({ ...PAGE, archivio: 'civile' });
    rerender(<Wrapper><DecisionResultList query={{ tema: 'colpa' }} /></Wrapper>);
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(2));
    // the topic alone is searched in an archive of the reader's choosing
    mockSearch({ ...PAGE, archivio: 'penale' });
    await userEvent.click(await screen.findByRole('button', { name: 'Penale' }));
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(3));
    mockSearch({ ...PAGE_TEXT, archivio: 'penale' });
    rerender(<Wrapper><DecisionResultList query={withArticle} /></Wrapper>);
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(4));
    // asked with the picked archive, so it learns nothing new: «Entrambi» and the refused index
    // can only come from what the article taught it before
    expect(searchMock).toHaveBeenLastCalledWith({ norma: NUMBERED, tema: 'colpa', archivio: 'penale' }, 1, 'testo');
    expect(await screen.findByRole('button', { name: 'Entrambi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Indice della Cassazione' })).toBeDisabled();
  });

  it('changes the archive and starts again from page one', async () => {
    mockSearch(PAGE); mockSearch({ ...PAGE, archivio: 'penale' });
    render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    await userEvent.click(await screen.findByRole('button', { name: 'Penale' }));
    await waitFor(() => expect(searchMock).toHaveBeenLastCalledWith({ norma: NORMA, tema: undefined, archivio: 'penale' }, 1, 'indice'));
    expect(await screen.findByRole('button', { name: 'Penale' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the index refused after the reader clicks the text, and asks the text from then on', async () => {
    mockSearch(PAGE_TEXT); mockSearch({ ...PAGE_TEXT, pagina: 1 });
    render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    await screen.findByText('menzionato nel testo');
    await userEvent.click(screen.getByRole('button', { name: 'Nel testo' })); // already pressed: nothing
    expect(searchMock).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Penale' }));
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(2));
    expect(searchMock).toHaveBeenLastCalledWith(expect.anything(), 1, 'testo');
    expect(screen.getByRole('button', { name: 'Indice della Cassazione' })).toBeDisabled();
  });

  it('offers «Entrambi» only where the route can search both archives', async () => {
    // an article of a code: the route applies the code's archive
    mockSearch(PAGE);
    const code = render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    await screen.findByRole('link', { name: /n\. 24908\/2026/ });
    expect(screen.getByRole('button', { name: 'Civile' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Entrambi' })).toBeNull();
    code.unmount();
    // a numbered act answered with no archive: both are searched
    mockSearch({ ...PAGE_TEXT, archivio: null });
    const numbered = render(<Wrapper><DecisionResultList query={{ norma: { tipo_atto: 'decreto legislativo', numero_atto: '81', data: '2008', numero_articolo: '2' } }} /></Wrapper>);
    await screen.findByText('menzionato nel testo');
    expect(screen.getByRole('button', { name: 'Entrambi' })).toHaveAttribute('aria-pressed', 'true');
    numbered.unmount();
    // a topic
    mockSearch({ ...PAGE, archivio: null });
    render(<Wrapper><DecisionResultList query={{ tema: 'danno' }} /></Wrapper>);
    await screen.findByRole('link', { name: /n\. 24908\/2026/ });
    expect(screen.getByRole('button', { name: 'Entrambi' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores a pick equal to the archive shown', async () => {
    mockSearch(PAGE);
    render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    await userEvent.click(await screen.findByRole('button', { name: 'Civile' }));
    expect(searchMock).toHaveBeenCalledTimes(1);
  });

  it('stops where totale says, even when the pages return fewer records', async () => {
    const hitN = (n: number): DecisionSearchHit => ({ ...HIT, identita: { ...HIT.identita, numero: n } });
    mockSearch({ ...PAGE, totale: 45, pagina: 1, decisioni: Array.from({ length: 18 }, (_, i) => hitN(100 + i)) });
    mockSearch({ ...PAGE, totale: 45, pagina: 2, decisioni: Array.from({ length: 18 }, (_, i) => hitN(200 + i)) });
    mockSearch({ ...PAGE, totale: 45, pagina: 3, decisioni: Array.from({ length: 5 }, (_, i) => hitN(300 + i)) });
    render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    for (const p of [2, 3]) {
      await userEvent.click(await screen.findByRole('button', { name: 'Altri risultati' }));
      await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(p));
      await screen.findByRole('link', { name: new RegExp(`n\\. ${p * 100}/2026`) });
    }
    expect(screen.queryByRole('button', { name: 'Altri risultati' })).toBeNull();
    expect(searchMock).toHaveBeenCalledTimes(3);
  });

  it('never says «Mostrate le prime 200» when there are 200 or fewer', async () => {
    for (let p = 1; p <= 8; p++) mockSearch({ ...PAGE, totale: 150, pagina: p, decisioni: [{ ...HIT, identita: { ...HIT.identita, numero: 500 + p } }] });
    render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    for (let p = 2; p <= 8; p++) {
      await userEvent.click(await screen.findByRole('button', { name: 'Altri risultati' }));
      await screen.findByRole('link', { name: new RegExp(`n\\. ${500 + p}/2026`) });
    }
    expect(screen.queryByRole('button', { name: 'Altri risultati' })).toBeNull();
    expect(searchMock).toHaveBeenCalledTimes(8);
    expect(screen.queryByText(/Mostrate le prime/)).toBeNull();
  });

  it('lists a decision once when a later page repeats it', async () => {
    mockSearch({ ...PAGE, totale: 40, decisioni: [HIT] });
    mockSearch({ ...PAGE, totale: 40, pagina: 2, decisioni: [HIT, { ...HIT, identita: { ...HIT.identita, numero: 7 } }] });
    render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    await userEvent.click(await screen.findByRole('button', { name: 'Altri risultati' }));
    await screen.findByRole('link', { name: /n\. 7\/2026/ });
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('names the type and the deposit in agreement', async () => {
    mockSearch({ ...PAGE, decisioni: [{ ...HIT, attributi: { sezione: '1', tipo: 'decreto', data_deposito: '2026-09-08' } }] });
    render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    expect(await screen.findByText('Decreto depositato l\'8 settembre 2026')).toBeInTheDocument();
  });
});

describe('DecisionResultList — the section’s year control', () => {
  const OLD: DecisionSearchHit = { ...HIT, identita: { ...HIT.identita, numero: 500, anno: 2019 }, attributi: { data_deposito: '2019-02-02' } };

  it('asks the archive for the years, and lists what it answers', async () => {
    mockSearch({ ...PAGE, totale: 1, decisioni: [OLD] });
    render(<Wrapper><DecisionResultList query={QUERY} yearRange={{ from: 2019, to: 2019 }} /></Wrapper>);
    expect(await screen.findByRole('link', { name: /n\. 500\/2019/ })).toBeInTheDocument();
    expect(searchMock).toHaveBeenCalledWith(expect.anything(), 1, 'indice', { dal: 2019, al: 2019 });
    expect(screen.getByText('1 decisione nel 2019 nell’archivio pubblico della Cassazione (dal 4 gennaio 2021)')).toBeInTheDocument();
  });

  it('asks without a range as it always did, and with one bound alone for an open range', async () => {
    mockSearch(PAGE);
    const { unmount } = render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    await screen.findByRole('link', { name: /n\. 24908\/2026/ });
    expect(searchMock).toHaveBeenCalledWith(expect.anything(), 1, 'indice');
    unmount();
    mockSearch(PAGE);
    render(<Wrapper><DecisionResultList query={QUERY} yearRange={{ from: 2022 }} /></Wrapper>);
    await screen.findByRole('link', { name: /n\. 24908\/2026/ });
    expect(searchMock).toHaveBeenLastCalledWith(expect.anything(), 1, 'indice', { dal: 2022, al: undefined });
    expect(screen.getByText(/1 decisione dal 2022 nell’archivio/)).toBeInTheDocument();
  });

  it('reads a range typed the wrong way round the right way round', async () => {
    mockSearch(PAGE);
    render(<Wrapper><DecisionResultList query={QUERY} yearRange={{ from: 2026, to: 2022 }} /></Wrapper>);
    await screen.findByRole('link', { name: /n\. 24908\/2026/ });
    expect(searchMock).toHaveBeenLastCalledWith(expect.anything(), 1, 'indice', { dal: 2022, al: 2026 });
  });

  it('starts again from the first page when the range changes, and drops the pages of the old one', async () => {
    mockSearch({ ...PAGE, totale: 40, decisioni: [HIT] });
    mockSearch({ ...PAGE, totale: 1, decisioni: [OLD] });
    const view = render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    await screen.findByRole('link', { name: /n\. 24908\/2026/ });
    view.rerender(<Wrapper><DecisionResultList query={QUERY} yearRange={{ from: 2019, to: 2019 }} /></Wrapper>);
    await screen.findByRole('link', { name: /n\. 500\/2019/ });
    expect(screen.queryByRole('link', { name: /n\. 24908\/2026/ })).toBeNull();
    expect(searchMock).toHaveBeenLastCalledWith(expect.anything(), 1, 'indice', { dal: 2019, al: 2019 });
    expect(searchMock).toHaveBeenCalledTimes(2);
  });

  it('says so when no decision falls in the years, and when the route refuses them', async () => {
    mockSearch({ ...PAGE, totale: 0, decisioni: [] });
    const first = render(<Wrapper><DecisionResultList query={QUERY} yearRange={{ from: 2022, to: 2023 }} /></Wrapper>);
    expect(await screen.findByText('Nessuna decisione dal 2022 al 2023 nell’archivio pubblico della Cassazione.')).toBeInTheDocument();
    first.unmount();
    mockSearch({ esito: 'richiesta_non_valida', errori: { anno_dal: 'Atteso un anno da 1900 a 2026' } });
    render(<Wrapper><DecisionResultList query={QUERY} yearRange={{ from: 1850 }} /></Wrapper>);
    expect(await screen.findByText('Gli anni indicati non sono validi: vanno dal 1900 all’anno in corso.')).toBeInTheDocument();
  });

  describe('the chips', () => {
    const report = vi.fn();
    const wrap = (children: React.ReactNode) => (
      <CaseLawFiltersContext.Provider value={{ filters: NO_FILTERS, reportYears: report }}><Wrapper>{children}</Wrapper></CaseLawFiltersContext.Provider>
    );
    const lastReport = () => report.mock.calls.filter(([, counts]) => counts !== null).at(-1)?.[1];
    beforeEach(() => report.mockReset());

    it('take the archive\'s counts for every year, approximate in index mode', async () => {
      mockSearch({ ...PAGE, totale: 40, anni: [{ anno: 2026, n: 30 }, { anno: 2019, n: 10 }], decisioni: [HIT] });
      render(wrap(<DecisionResultList query={QUERY} />));
      await screen.findByRole('link', { name: /n\. 24908\/2026/ });
      expect(lastReport()).toEqual([{ year: 2026, n: 30, approx: true }, { year: 2019, n: 10, approx: true }]);
      expect(report).toHaveBeenCalledWith('cassazione', expect.anything());
    });

    it('are exact when the text was searched', async () => {
      mockSearch({ ...PAGE_TEXT, anni: [{ anno: 2026, n: 312 }] });
      render(wrap(<DecisionResultList query={QUERY} />));
      await screen.findByText('menzionato nel testo');
      expect(lastReport()).toEqual([{ year: 2026, n: 312 }]);
    });

    it('count the hits loaded when the archive sent no counts', async () => {
      mockSearch({ ...PAGE, totale: 2, decisioni: [HIT, OLD] });
      render(wrap(<DecisionResultList query={QUERY} />));
      await screen.findByRole('link', { name: /n\. 500\/2019/ });
      expect(lastReport()).toEqual([{ year: 2026, n: 1 }, { year: 2019, n: 1 }]);
    });
  });

  it('lists the hits newest first by deposit, whatever the order of the page', async () => {
    mockSearch({ ...PAGE, totale: 2, decisioni: [OLD, HIT] });
    render(<Wrapper><DecisionResultList query={QUERY} /></Wrapper>);
    await screen.findByRole('link', { name: /n\. 500\/2019/ });
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual([expect.stringContaining('24908/2026'), expect.stringContaining('500/2019')]);
  });
  describe('the oldest-first order', () => {
    const asc = { filters: { ...NO_FILTERS, order: 'asc' as const }, reportYears: () => {} };
    const render20 = (query = QUERY) => render(
      <CaseLawFiltersContext.Provider value={asc}><Wrapper><DecisionResultList query={query} /></Wrapper></CaseLawFiltersContext.Provider>,
    );

    it('keeps the archive\'s order while more pages exist, and says so', async () => {
      mockSearch({ ...PAGE, totale: 40, decisioni: [HIT, OLD] });
      render20();
      await screen.findByRole('link', { name: /n\. 500\/2019/ });
      expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual([expect.stringContaining('24908/2026'), expect.stringContaining('500/2019')]);
      expect(screen.getByText('Ordinate dalla più recente: l’ordine inverso vale quando tutte le decisioni sono caricate')).toBeInTheDocument();
    });

    it('reverses the list once every decision is loaded, and drops the line', async () => {
      mockSearch({ ...PAGE, totale: 2, decisioni: [HIT, OLD] });
      render20();
      await screen.findByRole('link', { name: /n\. 500\/2019/ });
      expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual([expect.stringContaining('500/2019'), expect.stringContaining('24908/2026')]);
      expect(screen.queryByText(/Ordinate dalla più recente/)).toBeNull();
    });
  });
});

beforeEach(() => clearDecisionSearchCache());
