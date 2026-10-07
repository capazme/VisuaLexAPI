import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { DecisionSearchHit, SearchDecisionsAnswer } from '../../../types/decisions';

vi.mock('../../../services/decisionSearchService');
import { searchDecisions } from '../../../services/decisionSearchService';
import { DecisionResultList } from './DecisionResultList';

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

  it('changes the archive, starts again from page one and tells the owner', async () => {
    const onArchiveChange = vi.fn();
    mockSearch(PAGE); mockSearch({ ...PAGE, archivio: 'penale' });
    render(<Wrapper><DecisionResultList query={QUERY} onArchiveChange={onArchiveChange} /></Wrapper>);
    await userEvent.click(await screen.findByRole('button', { name: 'Penale' }));
    expect(onArchiveChange).toHaveBeenCalledWith('penale');
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
