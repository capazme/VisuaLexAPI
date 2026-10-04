import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const fetchDecision = vi.fn();
vi.mock('../../../services/decisionService', () => ({ fetchDecision: (...a: unknown[]) => fetchDecision(...a) }));

import { DecisionPage } from './DecisionPage';

function LocationProbe() {
  const l = useLocation();
  return <output data-testid="location">{l.pathname + l.search}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sentenze" element={<DecisionPage />} />
        <Route path="/sentenze/:corte/:numero/:anno" element={<><DecisionPage /><LocationProbe /></>} />
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

beforeEach(() => fetchDecision.mockReset());

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
    fireEvent.click(await screen.findByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText(/Sentenza n\. 10787\/2024/)).toBeInTheDocument();
    expect(fetchDecision).toHaveBeenCalledTimes(2);
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
});
