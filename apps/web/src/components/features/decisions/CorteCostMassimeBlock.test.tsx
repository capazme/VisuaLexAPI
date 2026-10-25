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
// the line under the massime is the credits' entry (G-287), not the route's `attribuzione`
const CREDIT_LINE = 'Fonte: Corte costituzionale, dati aperti, CC BY-SA 3.0';
const COST_3 = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:costituzione~art3';

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

const page = (
  massime: CorteCostMassima[], totale = massime.length, pagina = 1,
  per_ruolo = { norma: totale, parametro: 0 },
): CorteCostMassimeAnswer => ({
  esito: 'risultati', urn: URN, pagina, per_pagina: 20, totale, per_ruolo, massime,
  fonte: { nome: 'Corte costituzionale — dati aperti', licenza: 'CC BY-SA 3.0', url: 'https://dati.cortecostituzionale.it/Scarica_i_dati/Scarica_i_dati' },
  attribuzione: ATTRIBUTION, aggiornato_al: '2026-10-19',
});

const show = () => render(<MemoryRouter><CorteCostMassimeBlock articleUrn={URN} /></MemoryRouter>);
const showConstitution = () =>
  render(<MemoryRouter><CorteCostMassimeBlock articleUrn={COST_3} constitution /></MemoryRouter>);

beforeEach(() => { service.mockReset(); });

describe('CorteCostMassimeBlock', () => {
  it('asks for the article as soon as it appears and shows each massima verbatim, with the licence line', async () => {
    service.mockResolvedValue(page([REAL]));
    show();
    expect(screen.getByRole('status')).toHaveTextContent('Ricerca nelle massime della Corte costituzionale');
    expect(await screen.findByText(REAL.testo)).toBeInTheDocument();
    expect(service).toHaveBeenCalledExactlyOnceWith(URN, 1, undefined);
    const credit = screen.getByRole('link', { name: CREDIT_LINE });
    expect(credit).toHaveAttribute('href', '/crediti#corte-costituzionale');
    expect(credit).toHaveAttribute('target', '_blank');
    expect(screen.queryByText(ATTRIBUTION)).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
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
    expect(screen.getByRole('link', { name: CREDIT_LINE })).toBeInTheDocument();
  });

  it('loads the next page on request', async () => {
    const first = Array.from({ length: 20 }, (_, i) => massima(String(1000 + i), 2020, 100 - i, `Massima ${i}.`));
    service.mockResolvedValueOnce(page(first, 21)).mockResolvedValueOnce(page([massima('9', 1990, 1, 'L’ultima.')], 21, 2));
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Mostra altre massime (1)' }));
    expect(await screen.findByText('L’ultima.')).toBeInTheDocument();
    expect(service).toHaveBeenLastCalledWith(URN, 2, undefined);
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

  it('on the Costituzione asks first for the massime at issue, and adds the others on «Anche come parametro» (G-289)', async () => {
    const atIssue = { ...REAL, numero: '1', testo: 'Norma oggetto.' };
    const asMeasure = { ...REAL, numero: '2', testo: 'Parametro.', ruoli: ['parametro' as const] };
    service.mockResolvedValueOnce(page([atIssue], 1, 1, { norma: 1, parametro: 17593 }))
      .mockResolvedValueOnce(page([asMeasure, atIssue], 17594, 1, { norma: 1, parametro: 17593 }))
      .mockResolvedValueOnce(page([atIssue], 1, 1, { norma: 1, parametro: 17593 }));
    showConstitution();
    expect(await screen.findByText('Norma oggetto.')).toBeInTheDocument();
    expect(service).toHaveBeenLastCalledWith(COST_3, 1, 'norma');
    expect(screen.getByText('1 massima in cui l’articolo è norma oggetto')).toBeInTheDocument();
    const toggle = screen.getByRole('checkbox', { name: 'Anche come parametro (17.593)' });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(await screen.findByText('Parametro.')).toBeInTheDocument();
    expect(service).toHaveBeenLastCalledWith(COST_3, 1, undefined);
    expect(screen.getByText('17.594 massime')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Anche come parametro (17.593)' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox'));
    expect(await screen.findByText('1 massima in cui l’articolo è norma oggetto')).toBeInTheDocument();
    expect(service).toHaveBeenLastCalledWith(COST_3, 1, 'norma');
  });

  it('keeps the list and the checkbox (and its focus) on screen while the other role is asked', async () => {
    let answer: (a: CorteCostMassimeAnswer) => void = () => {};
    service.mockResolvedValueOnce(page([REAL], 1, 1, { norma: 1, parametro: 3 }))
      .mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    showConstitution();
    expect(await screen.findByText(REAL.testo)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox'));
    const box = screen.getByRole('checkbox', { name: 'Anche come parametro (3)' });
    expect(box).toBeChecked();
    expect(box).toHaveFocus();
    expect(screen.getByText(REAL.testo).closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    answer(page([REAL, { ...REAL, numero: '2', testo: 'Parametro.' }], 4, 1, { norma: 1, parametro: 3 }));
    expect(await screen.findByText('Parametro.')).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByRole('checkbox')).toHaveFocus();
  });

  it('on the Costituzione says when no massima has the article at issue, and keeps the way to the others', async () => {
    service.mockResolvedValueOnce(page([], 0, 1, { norma: 0, parametro: 40 }))
      .mockResolvedValueOnce(page([REAL], 40, 1, { norma: 0, parametro: 40 }));
    showConstitution();
    expect(await screen.findByText('Nessuna massima della Corte costituzionale ha questo articolo come norma oggetto.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Anche come parametro (40)' }));
    expect(await screen.findByText(REAL.testo)).toBeInTheDocument();
  });

  it('on the Costituzione loads the next page in the same role', async () => {
    const first = Array.from({ length: 20 }, (_, i) => massima(String(1000 + i), 2020, 100 - i, `Massima ${i}.`));
    service.mockResolvedValueOnce(page(first, 21, 1, { norma: 21, parametro: 5 }))
      .mockResolvedValueOnce(page([massima('9', 1990, 1, 'L’ultima.')], 21, 2, { norma: 21, parametro: 5 }));
    showConstitution();
    await userEvent.click(await screen.findByRole('button', { name: 'Mostra altre massime (1)' }));
    expect(await screen.findByText('L’ultima.')).toBeInTheDocument();
    expect(service).toHaveBeenLastCalledWith(COST_3, 2, 'norma');
  });

  it('on the Costituzione offers no switch when no massima has it as a parameter', async () => {
    service.mockResolvedValueOnce(page([REAL], 1, 1, { norma: 1, parametro: 0 }));
    showConstitution();
    expect(await screen.findByText(REAL.testo)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
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
