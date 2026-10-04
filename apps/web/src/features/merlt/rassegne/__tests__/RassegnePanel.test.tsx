// apps/web/src/features/merlt/rassegne/__tests__/RassegnePanel.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RassegnePanel } from '../RassegnePanel';
import { _clearRassegneCacheForTests } from '../useRassegne';
import type { RassegnePasso, RassegneResponse } from '../types';

const fetchRassegne = vi.fn();
vi.mock('../rassegneApi', () => ({ fetchRassegne: (...args: unknown[]) => fetchRassegne(...args) }));

const URN = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043';

function passo(id: string, anno: number, testo = 'Secondo l\'art. 2043 c.c. il danno deve essere ingiusto.'): RassegnePasso {
  return {
    id, anno, archivio: 'civile',
    volume: { id: 96, numero: 1, titolo: `Massimario ${anno} CIVILE Vol. 1` },
    parte: { nome: 'PARTE PRIMA', titolo: 'I DIRITTI' },
    capitolo: { nome: 'CAPITOLO I', titolo: 'LA RESPONSABILITÀ' },
    sezione: { id: 9111, numero: '2', titolo: 'Il danno.' },
    autori: ['Anna Rossi'],
    url: 'https://www.portaledelmassimario.ipzs.it/frontoffice/rassegneAnnuali/96/dettaglio.do#9111',
    testo,
    evidenziazioni: testo.includes('art. 2043 c.c.')
      ? [{ start: testo.indexOf('art. 2043 c.c.'), end: testo.indexOf('art. 2043 c.c.') + 14, citazione: 'art. 2043 c.c.', comma: null }]
      : [],
    pronunce: [{ key: 'cassazione:civile:1234:2024', label: 'Sez. U, n. 1234/2024 · Rv. 670001-01', corte: 'cassazione',
                 archivio: 'civile', numero: 1234, anno: 2024, sezione: 'U', rv: ['670001-01'] }],
    fonte: 'Ufficio del Massimario',
  };
}

const SUMMARY: RassegneResponse = {
  urn: URN, total: 3, anni: [{ anno: 2024, passi: 2 }, { anno: 2016, passi: 1 }], archivi: ['civile'],
  anno: 2024, items: [passo('a', 2024)], next_cursor: '1',
};

function renderPanel() {
  return render(<MemoryRouter><RassegnePanel articleUrn={URN} /></MemoryRouter>);
}

async function openPanel() {
  const row = await screen.findByRole('button', { name: /Espandi le rassegne della Cassazione/ });
  fireEvent.click(row);
}

describe('RassegnePanel', () => {
  beforeEach(() => {
    _clearRassegneCacheForTests();
    fetchRassegne.mockReset();
  });

  it('renders nothing when no paragraph cites the article', async () => {
    fetchRassegne.mockResolvedValue({ ...SUMMARY, total: 0, anni: [], items: [], anno: null, next_cursor: null });
    const { container } = renderPanel();
    await waitFor(() => expect(fetchRassegne).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('is a closed row with the count and the years', async () => {
    fetchRassegne.mockResolvedValue(SUMMARY);
    renderPanel();
    const row = await screen.findByRole('button', { name: /Espandi le rassegne della Cassazione/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Nelle rassegne della Cassazione')).toBeInTheDocument();
    expect(screen.getByText('3 passi, 2016–2024')).toBeInTheDocument();
    expect(screen.queryByText("Rassegna dell'anno 2024")).not.toBeInTheDocument();
  });

  it('opens with the keyboard on the newest year', async () => {
    fetchRassegne.mockResolvedValue(SUMMARY);
    renderPanel();
    const row = await screen.findByRole('button', { name: /Espandi le rassegne della Cassazione/ });
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(await screen.findByText("Rassegna dell'anno 2024")).toBeInTheDocument();
    expect(screen.getByText(/Rassegna civile 2024 · vol\. 1 › CAPITOLO I › § 2 Il danno\./)).toBeInTheDocument();
    expect(screen.getByText('di Anna Rossi')).toBeInTheDocument();
    const mark = screen.getByText('art. 2043 c.c.');
    expect(mark.tagName).toBe('MARK');
  });

  it('links a decision with an identity to its page', async () => {
    fetchRassegne.mockResolvedValue(SUMMARY);
    renderPanel();
    await openPanel();
    const chip = await screen.findByText('Sez. U, n. 1234/2024 · Rv. 670001-01');
    expect(chip.closest('a')).toHaveAttribute('href', '/sentenze/cassazione-civile/1234/2024');
  });

  it('leaves a decision without a year a plain label', async () => {
    const withoutYear = {
      ...passo('a', 2024),
      pronunce: [{ key: null, label: 'Sez. U, n. 1234 · Rv. 670001-01', corte: 'cassazione', archivio: 'civile',
                   numero: 1234, anno: null, sezione: 'U', rv: ['670001-01'] }],
    };
    fetchRassegne.mockResolvedValue({ ...SUMMARY, items: [withoutYear] });
    renderPanel();
    await openPanel();
    const chip = await screen.findByText('Sez. U, n. 1234 · Rv. 670001-01');
    expect(chip.closest('a')).toBeNull();
  });

  it('credits the source and links the portal', async () => {
    fetchRassegne.mockResolvedValue(SUMMARY);
    renderPanel();
    await openPanel();
    expect(await screen.findByText(/Fonte: Ufficio del Massimario della Corte di cassazione/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Apri sul portale del Massimario' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('loads more paragraphs and other years on demand', async () => {
    fetchRassegne
      .mockResolvedValueOnce(SUMMARY)
      .mockResolvedValueOnce({ ...SUMMARY, items: [passo('b', 2024, 'Un secondo passo.')], next_cursor: null })
      .mockResolvedValueOnce({ ...SUMMARY, anno: 2016, items: [passo('c', 2016, 'Un passo del 2016.')], next_cursor: null });
    renderPanel();
    await openPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Altri passi' }));
    expect(await screen.findByText('Un secondo passo.')).toBeInTheDocument();
    expect(fetchRassegne).toHaveBeenLastCalledWith({ urn: URN, anno: 2024, cursor: '1' });
    fireEvent.click(screen.getByRole('button', { name: /Rassegna dell'anno 2016/ }));
    expect(await screen.findByText('Un passo del 2016.')).toBeInTheDocument();
    expect(fetchRassegne).toHaveBeenLastCalledWith({ urn: URN, anno: 2016 });
  });

  it('renders hostile text as text', async () => {
    fetchRassegne.mockResolvedValue({ ...SUMMARY, items: [passo('x', 2024, '<img src=x onerror="alert(1)"> testo')] });
    const { container } = renderPanel();
    await openPanel();
    expect(await screen.findByText(/<img src=x onerror="alert\(1\)"> testo/)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('says so when MERL-T is unavailable, and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchRassegne.mockRejectedValue(new Error('503'));
    renderPanel();
    expect(await screen.findByText('Rassegne non disponibili ora.')).toBeInTheDocument();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('offers the civile/penale filter only when both are present', async () => {
    fetchRassegne.mockResolvedValue({ ...SUMMARY, archivi: ['civile', 'penale'] });
    renderPanel();
    await openPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Penale' }));
    await waitFor(() => expect(fetchRassegne).toHaveBeenLastCalledWith({ urn: URN, archivio: 'penale' }));
  });

  it('keeps the panel and the focus while another archive loads', async () => {
    let resolvePenale: (value: RassegneResponse) => void = () => {};
    fetchRassegne
      .mockResolvedValueOnce({ ...SUMMARY, archivi: ['civile', 'penale'] })
      .mockImplementationOnce(() => new Promise<RassegneResponse>((resolve) => { resolvePenale = resolve; }));
    renderPanel();
    await openPanel();
    const penale = await screen.findByRole('button', { name: 'Penale' });
    penale.focus();
    fireEvent.click(penale);
    expect(screen.getByText('Nelle rassegne della Cassazione')).toBeInTheDocument();
    expect(document.activeElement).toBe(penale);
    resolvePenale({ ...SUMMARY, archivi: ['civile', 'penale'], items: [passo('p', 2024, 'Un passo penale.')] });
    expect(await screen.findByText('Un passo penale.')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Penale' }));
  });

  it('a failed archive keeps the filter, so the reader can go back', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchRassegne
      .mockResolvedValueOnce({ ...SUMMARY, archivi: ['civile', 'penale'] })
      .mockRejectedValueOnce(new Error('503'));
    renderPanel();
    await openPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Civile' }));
    expect(await screen.findByText('Rassegne non disponibili ora.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tutte' }));
    await waitFor(() => expect(screen.queryByText('Rassegne non disponibili ora.')).not.toBeInTheDocument());
    expect(screen.getByText("Rassegna dell'anno 2024")).toBeInTheDocument();
    error.mockRestore();
  });

  it('another article starts closed and unfiltered', async () => {
    const OTHER = URN.replace('art2043', 'art2051');
    fetchRassegne.mockResolvedValue({ ...SUMMARY, archivi: ['civile', 'penale'] });
    const { rerender } = renderPanel();
    await openPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Penale' }));
    rerender(<MemoryRouter><RassegnePanel articleUrn={OTHER} /></MemoryRouter>);
    await waitFor(() => expect(fetchRassegne).toHaveBeenLastCalledWith({ urn: OTHER }));
    expect(await screen.findByRole('button', { name: /Espandi le rassegne della Cassazione/ }))
      .toHaveAttribute('aria-expanded', 'false');
  });
});
