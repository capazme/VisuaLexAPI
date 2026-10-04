import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

const fetchDecision = vi.fn();
vi.mock('../../../services/decisionService', () => ({ fetchDecision: (...a: unknown[]) => fetchDecision(...a) }));

import { DecisionPage } from './DecisionPage';

// `data-state` is what the address carries in the history entry: nothing, for this page. A span,
// not an <output>: that element has the role `status`, which the loading line of the page has too.
function LocationProbe() {
  const l = useLocation();
  return <span data-testid="location" data-state={JSON.stringify(l.state)}>{l.pathname + l.search}</span>;
}

// The reader going elsewhere while the page is open.
function GoTo({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>Vai a {to}</button>;
}

function renderAt(path: string, goTo?: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sentenze" element={<DecisionPage />} />
        <Route
          path="/sentenze/:corte/:numero/:anno"
          element={<><DecisionPage /><LocationProbe />{goTo && <GoTo to={goTo} />}</>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const found = {
  esito: 'trovata' as const,
  identita: { corte: 'cassazione' as const, archivio: 'penale' as const, numero: 10787, anno: 2024 },
  attributi: { sezione: '7', tipo: 'sentenza', data_deposito: '2024-03-12' },
  testo: { motivazione: 'RITENUTO IN FATTO\nil ricorrente' },
  fonte: { nome: 'Corte di cassazione — archivio pubblico SentenzeWeb (Italgiure)' },
  avvisi: [{ tipo: 'archivio_dedotto' as const, archivio: 'penale' as const, sezione: '7' }],
};

// as the route answers while Italgiure withholds the text (recorded on 2026-10-02)
const withheld = {
  esito: 'trovata' as const,
  identita: { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 10787, anno: 2024 },
  attributi: { sezione: '3', tipo: 'ordinanza', data_deposito: '2024-04-22', testo_assente: 'oscuramento' },
  testo: {},
  fonte: { nome: 'Corte di cassazione — archivio pubblico SentenzeWeb (Italgiure)' },
  avvisi: [{ tipo: 'testo_non_disponibile' as const }],
};

const consulta = {
  esito: 'trovata' as const,
  identita: { corte: 'corte_costituzionale' as const, numero: 1, anno: 2014 },
  attributi: { tipo: 'sentenza', data_decisione: '2013-12-04', data_deposito: '2014-01-13', ecli: 'ECLI:IT:COST:2014:1' },
  testo: { epigrafe: 'ha pronunciato la seguente', motivazione: 'Considerato in diritto', dispositivo: 'per questi motivi' },
  fonte: {
    nome: 'Corte costituzionale — dati aperti',
    licenza: 'CC BY-SA 3.0',
    url: 'https://www.cortecostituzionale.it/scheda-pronuncia/2014/1',
  },
  avvisi: [],
};

// Braces: a hook that returns a function has it called as its teardown, and `mockReset()` returns
// the mock, so an answer that never resolves would hang the hook.
beforeEach(() => {
  fetchDecision.mockReset();
});

describe('DecisionPage', () => {
  it('shows the decision and rewrites the address to its identity, without fetching twice', async () => {
    fetchDecision.mockResolvedValue(found);
    renderAt('/sentenze/cassazione/10787/2024?sezione=VII');
    expect(await screen.findByText(/Sez\. VII penale · Sentenza n\. 10787\/2024/)).toBeInTheDocument();
    expect(screen.getByText(/la Sez\. VII indicata è quella penale/)).toBeInTheDocument();
    expect(screen.getByText(/Fonte: Corte di cassazione/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/sentenze/cassazione-penale/10787/2024'));
    expect(fetchDecision).toHaveBeenCalledTimes(1);
    expect(fetchDecision).toHaveBeenCalledWith({ corte: 'cassazione', numero: 10787, anno: 2024, sezione: 'VII' });
  });

  it('copies the citation as lawyers write it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    fetchDecision.mockResolvedValue(found);
    renderAt('/sentenze/cassazione-penale/10787/2024');
    fireEvent.click(await screen.findByRole('button', { name: 'Copia citazione' }));
    expect(writeText).toHaveBeenCalledWith('Cass. pen., sez. VII, sent. dep. 12 marzo 2024, n. 10787');
    expect(await screen.findByText('Citazione copiata')).toBeInTheDocument();
  });

  it.each([
    ['there is no clipboard', () => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })],
    ['the clipboard refuses', () => Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true })],
  ])('says so, and logs why, when the citation cannot be copied: %s', async (_case, setUp) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    setUp();
    fetchDecision.mockResolvedValue(found);
    renderAt('/sentenze/cassazione-penale/10787/2024');
    fireEvent.click(await screen.findByRole('button', { name: 'Copia citazione' }));
    expect(await screen.findByText('Copia non riuscita')).toBeInTheDocument();
    expect(screen.queryByText('Citazione copiata')).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('«Apri sulla fonte» only where the source has a page for the decision, and no licence line', async () => {
    fetchDecision.mockResolvedValue(found);
    const cassazione = renderAt('/sentenze/cassazione-penale/10787/2024');
    await screen.findByRole('button', { name: 'Copia citazione' });
    expect(screen.queryByRole('link', { name: /Apri sulla fonte/ })).toBeNull();
    cassazione.unmount();

    fetchDecision.mockResolvedValue(consulta);
    renderAt('/sentenze/corte-costituzionale/1/2014');
    expect(await screen.findByRole('link', { name: /Apri sulla fonte/ }))
      .toHaveAttribute('href', 'https://www.cortecostituzionale.it/scheda-pronuncia/2014/1');
    // the owner, 2026-10-04: no licence line; fonte.licenza stays in the data
    expect(screen.getByText('Fonte: Corte costituzionale — dati aperti')).toBeInTheDocument();
    expect(screen.queryByText(/licenza|CC BY-SA/i)).toBeNull();
  });

  it('a decision without its text shows its particulars and why, and no text block', async () => {
    fetchDecision.mockResolvedValue(withheld);
    const { container } = renderAt('/sentenze/cassazione-civile/10787/2024');
    expect(await screen.findByText(/Sez\. III civile · Ordinanza n\. 10787\/2024/)).toBeInTheDocument();
    expect(screen.getByText(
      'Testo non disponibile presso la fonte: la Corte di cassazione lo indica come in fase di oscuramento dei dati personali.',
    )).toBeInTheDocument();
    expect(container.querySelector('.vlx-decision')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copia citazione' })).toBeInTheDocument();
  });

  it('quotes a cited section as text, never as markup', async () => {
    // the route never sends this (too long, and "<" is not a section's character): the page
    // holds on its own
    fetchDecision.mockResolvedValue({ ...found, avvisi: [{ tipo: 'sezione_non_riconosciuta', citata: '<img src=x onerror=alert(1)>' }] });
    const { container } = renderAt('/sentenze/cassazione-penale/10787/2024');
    expect(await screen.findByText('La sezione indicata («<img src=x onerror=alert(1)>») non è riconoscibile ed è stata ignorata.'))
      .toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('lets the reader choose between two homonyms', async () => {
    fetchDecision.mockResolvedValue({ esito: 'ambigua', candidati: [
      { identita: { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 }, attributi: { sezione: '3' } },
      { identita: { corte: 'cassazione', archivio: 'penale', numero: 10787, anno: 2024 }, attributi: { sezione: '7' } },
    ] });
    renderAt('/sentenze/cassazione/10787/2024');
    const links = await screen.findAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/sentenze/cassazione-civile/10787/2024', '/sentenze/cassazione-penale/10787/2024']);
  });

  it('says why a decision is missing and suggests the next year for a penal one', async () => {
    fetchDecision.mockResolvedValue({ esito: 'non_trovata', motivo: 'inesistente',
      suggerimento: { corte: 'cassazione', archivio: 'penale', numero: 1399, anno: 2000 } });
    renderAt('/sentenze/cassazione-penale/1399/1999');
    expect(await screen.findByText("La decisione n. 1399/1999 non è presente nell'archivio pubblico penale della Cassazione."))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: /n\. 1399\/2000/ })).toHaveAttribute('href', '/sentenze/cassazione-penale/1399/2000');
    expect(screen.getByRole('button', { name: 'Apri' })).toBeInTheDocument(); // the form, filled in
  });

  it('a source that does not answer offers Riprova and asks again', async () => {
    fetchDecision.mockResolvedValueOnce({ esito: 'fonte_non_raggiungibile', fonte: 'cassazione' }).mockResolvedValueOnce(found);
    renderAt('/sentenze/cassazione-penale/10787/2024');
    expect(await screen.findByText('La fonte non risponde in questo momento.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText(/Sentenza n\. 10787\/2024/)).toBeInTheDocument();
    expect(fetchDecision).toHaveBeenCalledTimes(2);
  });

  it('a limit of requests that is reached says so, and Riprova asks again', async () => {
    fetchDecision.mockResolvedValueOnce({ esito: 'fonte_non_raggiungibile', fonte: 'quota' }).mockResolvedValueOnce(found);
    renderAt('/sentenze/cassazione-penale/10787/2024');
    expect(await screen.findByText('Hai raggiunto il limite di richieste: riprova tra un minuto.')).toBeInTheDocument();
    expect(screen.queryByText(/La fonte non risponde/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText(/Sentenza n\. 10787\/2024/)).toBeInTheDocument();
    expect(fetchDecision).toHaveBeenCalledTimes(2);
  });

  it('a request that never reached the server says so, not that the source is silent, and logs why', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchDecision.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValueOnce(found);
    renderAt('/sentenze/cassazione-penale/10787/2024');
    expect(await screen.findByText('Il server non ha risposto: controlla la connessione e riprova.')).toBeInTheDocument();
    expect(screen.queryByText(/La fonte non risponde/)).toBeNull();
    expect(error).toHaveBeenCalledWith('fetch_decision failed', expect.objectContaining({ error: expect.any(Error) }));
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText(/Sentenza n\. 10787\/2024/)).toBeInTheDocument();
    expect(fetchDecision).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('a request the route refuses shows the form, filled in, with the route\'s reason on its field', async () => {
    fetchDecision.mockResolvedValue({ esito: 'richiesta_non_valida', errori: { numero: 'Il numero va da 1 a 999999' } });
    renderAt('/sentenze/cassazione-penale/10787/2024');
    const numero = await screen.findByRole('textbox', { name: 'Numero' });
    expect(numero).toHaveValue('10787');
    expect(numero).toBeInvalid();
    expect(numero).toHaveAccessibleDescription('Il numero va da 1 a 999999');
    expect(screen.getByRole('button', { name: 'Apri' })).toBeInTheDocument();
    expect(fetchDecision).toHaveBeenCalledTimes(1);
  });

  it('an unexpected failure is a generic error with Riprova, never "non trovata"', async () => {
    fetchDecision.mockResolvedValueOnce({ esito: 'errore_interno' }).mockResolvedValueOnce(found);
    renderAt('/sentenze/cassazione-penale/10787/2024');
    expect(await screen.findByText('Errore imprevisto: non è stato possibile caricare la decisione.')).toBeInTheDocument();
    expect(screen.queryByText(/non trovata|non è presente/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText(/Sentenza n\. 10787\/2024/)).toBeInTheDocument();
    expect(fetchDecision).toHaveBeenCalledTimes(2);
  });

  it('an address it cannot read shows the form and fetches nothing', async () => {
    renderAt('/sentenze/tar/12/2024');
    // named twice: in the notice and next to the form's field
    expect(await screen.findAllByText(/Organo non riconosciuto/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Apri' })).toBeInTheDocument();
    expect(fetchDecision).not.toHaveBeenCalled();
  });

  it('/sentenze is the lookup form', async () => {
    renderAt('/sentenze');
    expect(await screen.findByRole('heading', { name: 'Apri una sentenza' })).toBeInTheDocument();
  });

  it('keeps nothing in the history: the answer in memory serves the rewritten address, a reload asks again', async () => {
    fetchDecision.mockResolvedValue(found);
    const first = renderAt('/sentenze/cassazione/10787/2024?sezione=VII');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/sentenze/cassazione-penale/10787/2024'));
    expect(await screen.findByText(/Sez\. VII penale · Sentenza n\. 10787\/2024/)).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveAttribute('data-state', 'null'); // no answer carried in the entry
    expect(fetchDecision).toHaveBeenCalledTimes(1);
    first.unmount();

    // a reload, or a fresh visit of the same address: nothing was kept, so the route is asked
    renderAt('/sentenze/cassazione-penale/10787/2024');
    expect(await screen.findByText(/Sez\. VII penale · Sentenza n\. 10787\/2024/)).toBeInTheDocument();
    expect(fetchDecision).toHaveBeenCalledTimes(2);
  });

  it('ignores an answer that arrives after the reader asked for another decision', async () => {
    let answerFirst: (answer: unknown) => void = () => {};
    const other = {
      ...found,
      identita: { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 222, anno: 2023 },
      attributi: { sezione: '1', tipo: 'sentenza', data_deposito: '2023-05-02' },
      avvisi: [],
    };
    fetchDecision
      .mockImplementationOnce(() => new Promise((resolve) => { answerFirst = resolve; }))
      .mockResolvedValueOnce(other);
    renderAt('/sentenze/cassazione-penale/10787/2024', '/sentenze/cassazione-civile/222/2023');
    fireEvent.click(screen.getByRole('button', { name: /Vai a/ }));
    expect(await screen.findByText(/Sentenza n\. 222\/2023/)).toBeInTheDocument();

    // the first answer comes late: it answers a question nobody is asking any more
    await act(async () => { answerFirst(found); });
    expect(screen.getByText(/Sentenza n\. 222\/2023/)).toBeInTheDocument();
    expect(screen.queryByText(/n\. 10787\/2024/)).toBeNull();
    expect(screen.getByTestId('location').textContent).toBe('/sentenze/cassazione-civile/222/2023');
    expect(fetchDecision).toHaveBeenCalledTimes(2);
  });

  describe('headings: one h1 on every screen', () => {
    const PATH = '/sentenze/cassazione-penale/10787/2024';
    const retry = () => screen.findByRole('button', { name: 'Riprova' });
    const homonym = (archivio: 'civile' | 'penale') => ({
      identita: { corte: 'cassazione' as const, archivio, numero: 10787, anno: 2024 },
      attributi: {},
    });
    const SCREENS = [
      { name: 'the lookup form', path: '/sentenze', ready: () => screen.findByRole('heading', { name: 'Apri una sentenza' }) },
      { name: 'an address it cannot read', path: '/sentenze/tar/12/2024', ready: () => screen.findAllByText(/Organo non riconosciuto/) },
      { name: 'loading', answer: new Promise(() => {}), ready: () => screen.findByRole('status') },
      { name: 'a decision not found', answer: { esito: 'non_trovata', motivo: 'inesistente' }, ready: () => screen.findByText(/non è presente/) },
      { name: 'two candidates', answer: { esito: 'ambigua', candidati: [homonym('civile'), homonym('penale')] }, ready: () => screen.findAllByRole('link') },
      { name: 'a source that does not answer', answer: { esito: 'fonte_non_raggiungibile', fonte: 'cassazione' }, ready: retry },
      { name: 'an unexpected failure', answer: { esito: 'errore_interno' }, ready: retry },
      { name: 'a refused request', answer: { esito: 'richiesta_non_valida', errori: { numero: 'Numero non valido' } }, ready: () => screen.findByRole('textbox', { name: 'Numero' }) },
    ];
    const heading = () => screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent);

    it.each(SCREENS)('«Sentenze» is the h1 of $name', async ({ path = PATH, answer, ready }) => {
      if (answer instanceof Promise) fetchDecision.mockReturnValue(answer);
      else if (answer) fetchDecision.mockResolvedValue(answer);
      renderAt(path);
      await ready();
      expect(heading()).toEqual(['Sentenze']);
    });

    it("the decision's own heading is the h1 of the decision", async () => {
      fetchDecision.mockResolvedValue(found);
      renderAt(PATH);
      await screen.findByRole('button', { name: 'Copia citazione' });
      expect(heading()).toEqual(['Corte di cassazione · Sez. VII penale · Sentenza n. 10787/2024 · depositata il 12 marzo 2024']);
    });
  });

  it('announces the loading in a status that is not inside a busy container', () => {
    fetchDecision.mockReturnValue(new Promise(() => {}));
    renderAt('/sentenze/cassazione-penale/10787/2024');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Caricamento della decisione…');
    expect(status.closest('[aria-busy="true"]')).toBeNull();
  });

  it('keeps 44px touch targets on mobile on its buttons and on the links to choose from', async () => {
    const target = ['min-h-[44px]', 'md:min-h-0'];
    fetchDecision.mockResolvedValueOnce(found);
    const decision = renderAt('/sentenze/cassazione-penale/10787/2024');
    expect(await screen.findByRole('button', { name: 'Copia citazione' })).toHaveClass(...target);
    decision.unmount();

    fetchDecision.mockResolvedValueOnce({ esito: 'errore_interno' });
    const failure = renderAt('/sentenze/cassazione-penale/10787/2024');
    expect(await screen.findByRole('button', { name: 'Riprova' })).toHaveClass(...target);
    failure.unmount();

    fetchDecision.mockResolvedValueOnce({ esito: 'non_trovata', motivo: 'inesistente' });
    const missing = renderAt('/sentenze/cassazione-penale/10787/2024');
    expect(await screen.findByRole('button', { name: 'Apri' })).toHaveClass(...target);
    missing.unmount();

    fetchDecision.mockResolvedValueOnce({ esito: 'ambigua', candidati: [
      { identita: { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 }, attributi: {} },
      { identita: { corte: 'cassazione', archivio: 'penale', numero: 10787, anno: 2024 }, attributi: {} },
    ] });
    renderAt('/sentenze/cassazione/10787/2024');
    for (const link of await screen.findAllByRole('link')) expect(link).toHaveClass(...target);
  });

  it('draws its links readable on the dark page', async () => {
    fetchDecision.mockResolvedValueOnce(consulta);
    const decision = renderAt('/sentenze/corte-costituzionale/1/2014');
    expect(await screen.findByRole('link', { name: /Apri sulla fonte/ })).toHaveClass('text-primary-600', 'dark:text-primary-400');
    decision.unmount();

    fetchDecision.mockResolvedValueOnce({ esito: 'ambigua', candidati: [
      { identita: { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 }, attributi: {} },
      { identita: { corte: 'cassazione', archivio: 'penale', numero: 10787, anno: 2024 }, attributi: {} },
    ] });
    renderAt('/sentenze/cassazione/10787/2024');
    for (const link of await screen.findAllByRole('link')) expect(link).toHaveClass('text-primary-600', 'dark:text-primary-400');
  });
});
