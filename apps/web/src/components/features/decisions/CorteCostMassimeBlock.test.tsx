import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { CorteCostMassima, CorteCostMassimeAnswer } from '../../../types/decisions';

vi.mock('../../../services/corteCostMassimeService');
vi.mock('../../../utils/decisionFetchCache', () => ({
  fetchDecisionCached: () => Promise.resolve({ esito: 'non_trovata', motivo: 'inesistente' }),
}));

import { searchCorteCostMassime } from '../../../services/corteCostMassimeService';
import { CorteCostMassimeBlock } from './CorteCostMassimeBlock';

const service = vi.mocked(searchCorteCostMassime);
const URN = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1930-10-19;1398:1~art131bis';
const ATTRIBUTION = 'Massime: Corte costituzionale — dati aperti, CC BY-SA 3.0';

// a short real massima (Corte costituzionale — dati aperti, CC BY-SA 3.0), as the route gives it
const massima = (numero: string, anno: number, n: number, testo: string): CorteCostMassima => ({
  numero,
  titolo: 'Reati e pene - Causa di non punibilità per particolare tenuità del fatto',
  testo,
  ruoli: ['norma'],
  pronuncia: {
    identita: { corte: 'corte_costituzionale', numero: n, anno },
    tipo: 'sentenza', data_decisione: `${anno - 1}-11-20`, data_deposito: `${anno}-01-22`,
    url: `https://www.cortecostituzionale.it/scheda-pronuncia/${anno}/${n}`,
  },
});
const REAL = massima('47182', 2026, 5,
  'Va riconosciuta l’ampia discrezionalità del legislatore nell’individuazione dell’ambito oggettivo della causa di non punibilità di cui all’art. 131-bis cod. pen., rimanendo salvo il limite della manifesta irragionevolezza. (Precedenti: S. 156/2025 - mass. 43414; S. 207/2017 - mass. 41153).');

const page = (massime: CorteCostMassima[], totale = massime.length, pagina = 1): CorteCostMassimeAnswer => ({
  esito: 'risultati', urn: URN, pagina, per_pagina: 20, totale, per_ruolo: { norma: totale, parametro: 0 }, massime,
  fonte: { nome: 'Corte costituzionale — dati aperti', licenza: 'CC BY-SA 3.0', url: 'https://dati.cortecostituzionale.it/Scarica_i_dati/Scarica_i_dati' },
  attribuzione: ATTRIBUTION, aggiornato_al: '2026-10-19',
});

const show = () => render(<MemoryRouter><CorteCostMassimeBlock articleUrn={URN} /></MemoryRouter>);

beforeEach(() => { service.mockReset(); });

describe('CorteCostMassimeBlock', () => {
  it('asks for the article as soon as it appears and shows each massima verbatim, with the licence line', async () => {
    service.mockResolvedValue(page([REAL]));
    show();
    expect(screen.getByRole('status')).toHaveTextContent('Ricerca nelle massime della Corte costituzionale');
    expect(await screen.findByText(REAL.testo)).toBeInTheDocument();
    expect(service).toHaveBeenCalledExactlyOnceWith(URN);
    const credit = screen.getByRole('link', { name: ATTRIBUTION });
    expect(credit).toHaveAttribute('href', 'https://dati.cortecostituzionale.it/Scarica_i_dati/Scarica_i_dati');
    expect(screen.getByText('1 massima')).toBeInTheDocument();
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Sentenza')).toBeInTheDocument();
    expect(within(row).getByText('Norma oggetto')).toBeInTheDocument();
    expect(within(row).getByText('mass. 47182')).toBeInTheDocument();
  });

  it('says when no massima names the article, and still credits the source', async () => {
    service.mockResolvedValue(page([]));
    show();
    expect(await screen.findByText('Nessuna massima della Corte costituzionale nomina questo articolo.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: ATTRIBUTION })).toBeInTheDocument();
  });

  it('loads the next page on request', async () => {
    const first = Array.from({ length: 20 }, (_, i) => massima(String(1000 + i), 2020, 100 - i, `Massima ${i}.`));
    service.mockResolvedValueOnce(page(first, 21)).mockResolvedValueOnce(page([massima('9', 1990, 1, 'L’ultima.')], 21, 2));
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Mostra altre massime (1)' }));
    expect(await screen.findByText('L’ultima.')).toBeInTheDocument();
    expect(service).toHaveBeenLastCalledWith(URN, 2);
    expect(screen.queryByRole('button', { name: /Mostra altre massime/ })).toBeNull();
  });

  it('drops the rows a later page repeats after the index was rebuilt, and says when a page fails', async () => {
    const first = Array.from({ length: 20 }, (_, i) => massima(String(1000 + i), 2020, 100 - i, `Massima ${i}.`));
    service.mockResolvedValueOnce(page(first, 22))
      .mockResolvedValueOnce({ esito: 'fonte_non_raggiungibile', fonte: 'corte_costituzionale' })
      .mockResolvedValueOnce(page([first[19], massima('9', 1990, 1, 'L’ultima.')], 22, 2));
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Mostra altre massime (2)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Le altre massime non sono arrivate');
    await userEvent.click(screen.getByRole('button', { name: 'Mostra altre massime (2)' }));
    expect(await screen.findByText('L’ultima.')).toBeInTheDocument();
    expect(screen.getAllByText('Massima 19.')).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says the index is being prepared, and asks again on «Riprova»', async () => {
    service.mockResolvedValueOnce({ esito: 'fonte_non_raggiungibile', fonte: 'corte_costituzionale', in_preparazione: true })
      .mockResolvedValueOnce(page([REAL]));
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('si stanno preparando');
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText(REAL.testo)).toBeInTheDocument();
    expect(service).toHaveBeenCalledTimes(2);
  });

  it('says the source is unreachable when no answer arrives', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    service.mockRejectedValue(new Error('offline'));
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('non sono raggiungibili');
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
