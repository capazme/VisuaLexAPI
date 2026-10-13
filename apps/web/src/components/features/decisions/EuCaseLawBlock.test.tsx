import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { EuCaseLawAnswer, EuCaseLawDecision } from '../../../types/decisions';
import { appStore } from '../../../store/useAppStore';

vi.mock('../../../services/euCaseLawService');
import { searchEuCaseLaw } from '../../../services/euCaseLawService';
import { EuCaseLawBlock } from './EuCaseLawBlock';
import { CaseLawFiltersContext } from '../search/caseLaw/caseLawFiltersContext';
import { NO_FILTERS, type CaseLawFilters } from '../search/caseLaw/caseLawFilter';

const service = vi.mocked(searchEuCaseLaw);
const GDPR = { tipo_atto: 'regolamento ue', data: '2016', numero_atto: '679', numero_articolo: '6' };

const judgment: EuCaseLawDecision = {
  corte: 'corte_giustizia_ue', causa: 'C-97/23', ecli: 'ECLI:EU:C:2024:1000', data: '2024-12-05', tipo: 'JUDG',
  celex: '62023CJ0097', identita: { corte: 'corte_giustizia_ue', numero: 97, anno: 2023 },
};
const opinion: EuCaseLawDecision = {
  ...judgment, ecli: 'ECLI:EU:C:2024:500', data: '2024-06-06', tipo: 'OPIN_AG', celex: '62023CC0097',
};
const order: EuCaseLawDecision = {
  corte: 'corte_giustizia_ue', causa: 'C-123/22', ecli: null, data: '2023-03-01', tipo: 'ORDER',
  celex: '62022CO0123', identita: { corte: 'corte_giustizia_ue', numero: 123, anno: 2022 },
};
const general: EuCaseLawDecision = {
  corte: 'tribunale_ue', causa: 'T-12/20', ecli: null, data: '2021-05-05', tipo: 'JUDG',
  celex: '62020TJ0012', identita: { corte: 'tribunale_ue', numero: 12, anno: 2020 },
};
const found = (decisioni: EuCaseLawDecision[], troncato = false): EuCaseLawAnswer =>
  ({ esito: 'risultati', celex: '32016R0679', articolo: '6', totale: decisioni.length, troncato, decisioni });

const report = vi.fn();
function show(norma = GDPR, filters: CaseLawFilters = NO_FILTERS, extra: { besideId?: string } = {}) {
  return render(
    <CaseLawFiltersContext.Provider value={{ filters, reportYears: report }}>
      <MemoryRouter><EuCaseLawBlock norma={norma} {...extra} /></MemoryRouter>
    </CaseLawFiltersContext.Provider>,
  );
}
const reported = () => report.mock.calls.filter(([, counts]) => counts !== null).at(-1)?.[1];

beforeEach(() => { service.mockReset(); report.mockReset(); });

describe('EuCaseLawBlock', () => {
  it('asks for the act\'s CELEX and the article as soon as it appears, once', async () => {
    service.mockResolvedValue(found([judgment]));
    const view = show();
    expect(screen.getByRole('status')).toHaveTextContent('Ricerca negli indici dell’Unione europea');
    await screen.findByText('Corte giust. UE, C-97/23');
    expect(service).toHaveBeenCalledExactlyOnceWith({ celex: '32016R0679', articolo: '6' });
    view.unmount();
    show();
    await screen.findByText('Corte giust. UE, C-97/23');
    expect(service).toHaveBeenCalledTimes(1);
  });

  it('draws a judgment as a row: its estremi as a link that opens beside, the day, the type, the ECLI', async () => {
    service.mockResolvedValue(found([general, judgment]));
    show();
    const link = (await screen.findByText('Corte giust. UE, C-97/23')).closest('a')!;
    expect(link).toHaveAttribute('href', '/sentenze/corte-giustizia-ue/97/2023');
    expect(link).not.toHaveAttribute('target');
    expect(screen.getByText('5 dicembre 2024')).toHaveAttribute('datetime', '2024-12-05');
    expect(screen.getByText('ECLI:EU:C:2024:1000')).toBeInTheDocument();
    expect(screen.getAllByText('Sentenza')).toHaveLength(2);
    expect(screen.getByText('Trib. UE, T-12/20').closest('a')).toHaveAttribute('href', '/sentenze/tribunale-ue/12/2020');
    // newest first
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('C-97/23');
  });

  it('opens a judgment beside the article and records the way back', async () => {
    service.mockResolvedValue(found([judgment]));
    const open = vi.fn(() => 'tab');
    const push = vi.fn();
    const saved = appStore.getState();
    appStore.setState({ openDecision: open, pushReadingBack: push, readingBackStack: [] } as never);
    const back = { tabId: 't1', blockId: 'b1', articleId: 'a1', label: 'art. 6 GDPR' };
    render(<MemoryRouter initialEntries={['/']}><EuCaseLawBlock norma={GDPR} besideId="t1" backEntry={back} /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Corte giust. UE, C-97/23'));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ corte: 'corte_giustizia_ue', numero: 97, anno: 2023 }), { fromLink: true, besideId: 't1' });
    expect(push).toHaveBeenCalledExactlyOnceWith(back);
    appStore.setState({ openDecision: saved.openDecision, pushReadingBack: saved.pushReadingBack } as never);
  });

  it('opens an order on EUR-Lex by its CELEX, in a new tab, and says so', async () => {
    service.mockResolvedValue(found([judgment, order]));
    show();
    const link = (await screen.findByText(/Corte giust\. UE, C-123\/22/)).closest('a')!;
    expect(link).toHaveAttribute('href', 'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:62022CO0123');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('su EUR-Lex');
    expect(screen.getByText('Ordinanza')).toBeInTheDocument();
  });

  it('hides the Advocates General\'s opinions until asked, and counts them in the button', async () => {
    service.mockResolvedValue(found([judgment, opinion]));
    show();
    await screen.findByText('Corte giust. UE, C-97/23');
    expect(screen.queryByText('Conclusioni AG')).toBeNull();
    expect(screen.getByText('1 decisione')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Conclusioni dell’Avvocato generale (1)' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const badge = screen.getByText('Conclusioni AG');
    expect(badge).toBeInTheDocument();
    expect(badge.closest('li')!.querySelector('a')).toHaveAttribute('href', 'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:62023CC0097');
    expect(screen.getByText('2 decisioni')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByText('Conclusioni AG')).toBeNull();
  });

  it('offers no toggle when there is no opinion', async () => {
    service.mockResolvedValue(found([judgment]));
    show();
    await screen.findByText('Corte giust. UE, C-97/23');
    expect(screen.queryByRole('button', { name: /Conclusioni/ })).toBeNull();
  });

  it('says the list may be incomplete, links InfoCuria, and credits the source', async () => {
    service.mockResolvedValue(found([judgment]));
    show();
    await screen.findByText('Corte giust. UE, C-97/23');
    expect(screen.getByText(/Dagli indici dell’Unione europea: l’elenco può essere incompleto/)).toBeInTheDocument();
    const info = screen.getByRole('link', { name: 'Cerca su InfoCuria' });
    expect(info).toHaveAttribute('href', 'https://curia.europa.eu/juris/recherche.jsf?language=it');
    expect(info).toHaveAttribute('target', '_blank');
    expect(info).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Fonte: EUR-Lex / Ufficio delle pubblicazioni dell’UE')).toBeInTheDocument();
  });

  it('says so when the query stopped at its row limit', async () => {
    service.mockResolvedValue(found([judgment], true));
    show();
    expect(await screen.findByText(/L’elenco si ferma alle 500 decisioni più recenti/)).toBeInTheDocument();
  });

  it('says there is none indexed, still with the completeness and source lines', async () => {
    service.mockResolvedValue(found([]));
    show();
    expect(await screen.findByText('Nessuna decisione indicizzata cita questo articolo.')).toBeInTheDocument();
    expect(screen.getByText(/l’elenco può essere incompleto/)).toBeInTheDocument();
    expect(screen.getByText(/Fonte: EUR-Lex/)).toBeInTheDocument();
  });

  it('says when only opinions are indexed', async () => {
    service.mockResolvedValue(found([opinion]));
    show();
    expect(await screen.findByText(/Nessuna sentenza o ordinanza indicizzata cita questo articolo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conclusioni dell’Avvocato generale (1)' })).toBeInTheDocument();
  });

  it('lists decisions for regulations and directives only: a Treaty asks nothing and says why', () => {
    show({ ...GDPR, tipo_atto: 'tfue', data: '', numero_atto: undefined as never, numero_articolo: '267' });
    expect(screen.getByText('Le decisioni della Corte di giustizia sono elencate per i regolamenti e le direttive, non per i Trattati.')).toBeInTheDocument();
    expect(service).not.toHaveBeenCalled();
  });

  it('does not say «not the Treaties» about a regulation or a directive whose article it cannot search', () => {
    show({ ...GDPR, tipo_atto: 'direttiva ue', numero_articolo: '6 bis' });
    expect(screen.getByText('Le decisioni dell’Unione si cercano per articoli con un numero semplice: per questo articolo non c’è una ricerca negli indici.')).toBeInTheDocument();
    expect(screen.queryByText(/non per i Trattati/)).toBeNull();
    expect(service).not.toHaveBeenCalled();
  });

  it('says the route does not list the act when it answers so, with no «Riprova»', async () => {
    service.mockResolvedValue({ esito: 'non_supportata' });
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('non per i Trattati');
    expect(screen.queryByRole('button', { name: 'Riprova' })).toBeNull();
  });

  it('says the source does not answer, and asks again with «Riprova»', async () => {
    service.mockResolvedValueOnce({ esito: 'fonte_non_raggiungibile', fonte: 'curia' });
    service.mockResolvedValueOnce(found([judgment]));
    show();
    expect(await screen.findByText('Gli indici dell’Unione europea non rispondono in questo momento.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText('Corte giust. UE, C-97/23')).toBeInTheDocument();
    expect(screen.queryByText(/non rispondono/)).toBeNull();
    expect(service).toHaveBeenCalledTimes(2);
  });

  it('reads a call that never got an answer as a source that does not answer', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    service.mockRejectedValueOnce(new TypeError('network'));
    show();
    expect(await screen.findByText('Gli indici dell’Unione europea non rispondono in questo momento.')).toBeInTheDocument();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('asks again for another article', async () => {
    service.mockResolvedValue(found([judgment]));
    const view = show();
    await screen.findByText('Corte giust. UE, C-97/23');
    view.rerender(
      <CaseLawFiltersContext.Provider value={{ filters: NO_FILTERS, reportYears: report }}>
        <MemoryRouter><EuCaseLawBlock norma={{ ...GDPR, numero_articolo: '17' }} /></MemoryRouter>
      </CaseLawFiltersContext.Provider>,
    );
    await vi.waitFor(() => expect(service).toHaveBeenLastCalledWith({ celex: '32016R0679', articolo: '17' }));
  });
});

describe('EuCaseLawBlock — the section\'s controls', () => {
  it('reports its years with their counts to the chips, opinions only once shown', async () => {
    service.mockResolvedValue(found([judgment, opinion, order, general]));
    show();
    await screen.findByText('Corte giust. UE, C-97/23');
    expect(reported()).toEqual([{ year: 2024, n: 1 }, { year: 2023, n: 1 }, { year: 2021, n: 1 }]);
    await userEvent.click(screen.getByRole('button', { name: /Conclusioni dell’Avvocato generale/ }));
    expect(reported()).toEqual([{ year: 2024, n: 2 }, { year: 2023, n: 1 }, { year: 2021, n: 1 }]);
    expect(report).toHaveBeenCalledWith('eu', expect.anything());
  });

  it('keeps the decisions whose day is in the range, and says how many', async () => {
    service.mockResolvedValue(found([judgment, order, general]));
    show(GDPR, { ...NO_FILTERS, range: { from: 2023, to: 2024 } });
    await screen.findByText('Corte giust. UE, C-97/23');
    expect(screen.getByText(/Corte giust\. UE, C-123\/22/)).toBeInTheDocument();
    expect(screen.queryByText('Trib. UE, T-12/20')).toBeNull();
    expect(screen.getByText('2 di 3 decisioni')).toBeInTheDocument();
  });

  it('narrows by a word, ignoring accents, over the label, the type and the ECLI', async () => {
    service.mockResolvedValue(found([judgment, order]));
    show(GDPR, { ...NO_FILTERS, text: 'ordinanza' });
    await screen.findByText(/Corte giust\. UE, C-123\/22/);
    expect(screen.queryByText('Corte giust. UE, C-97/23')).toBeNull();
    expect(screen.getByText('1 di 2 decisioni')).toBeInTheDocument();
  });

  it('says when the filters leave none', async () => {
    service.mockResolvedValue(found([judgment]));
    show(GDPR, { ...NO_FILTERS, range: { from: 2000, to: 2001 } });
    expect(await screen.findByText('Nessuna decisione corrisponde ai filtri selezionati.')).toBeInTheDocument();
    expect(screen.getByText('0 di 1 decisioni')).toBeInTheDocument();
  });

  it('reverses the order, and holds the archive\'s while the list stops at its limit', async () => {
    service.mockResolvedValueOnce(found([judgment, order, general]));
    const first = show(GDPR, { ...NO_FILTERS, order: 'asc' });
    await screen.findByText('Trib. UE, T-12/20');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('T-12/20'), expect.stringContaining('C-123/22'), expect.stringContaining('C-97/23'),
    ]);
    expect(screen.queryByText(/Ordinate dalla più recente/)).toBeNull();
    first.unmount();
    service.mockResolvedValueOnce(found([judgment, order, general], true));
    show({ ...GDPR, numero_articolo: '7' }, { ...NO_FILTERS, order: 'asc' });
    await screen.findByText('Trib. UE, T-12/20');
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('C-97/23');
    expect(screen.getByText('Ordinate dalla più recente: l’ordine inverso vale quando l’elenco è completo')).toBeInTheDocument();
  });

  it('puts 44 px targets on the toggle and the link of a row', async () => {
    service.mockResolvedValue(found([judgment, opinion]));
    show();
    await screen.findByText('Corte giust. UE, C-97/23');
    expect(screen.getByRole('button', { name: /Conclusioni/ })).toHaveClass('min-h-[44px]');
    expect(screen.getByText('Corte giust. UE, C-97/23').closest('a')).toHaveClass('min-h-[44px]');
  });
});
