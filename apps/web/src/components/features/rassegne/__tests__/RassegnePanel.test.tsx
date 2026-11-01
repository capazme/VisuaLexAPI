import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RassegnePanel } from '../RassegnePanel';
import { clearRassegneCache } from '../useRassegne';
import { CaseLawFiltersContext } from '../../search/caseLaw/caseLawFiltersContext';
import { NO_FILTERS } from '../../search/caseLaw/caseLawFilter';
import { RassegneError } from '../../../../services/rassegneService';
import type { RassegnePasso, RassegneResponse } from '../types';

const fetchRassegne = vi.fn();
const readArticleReference = vi.fn();
vi.mock('../../../../services/rassegneService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../services/rassegneService')>()),
  fetchRassegne: (...args: unknown[]) => fetchRassegne(...args),
  readArticleReference: (...args: unknown[]) => readArticleReference(...args),
}));

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
    pronunce: [{ key: 'cassazione:civile:1234:2024', corte: 'cassazione',
                 archivio: 'civile', numero: 1234, anno: 2024, sezione: 'U', rv: ['670001-01'] }],
    fonte: 'Ufficio del Massimario',
  };
}

const SUMMARY: RassegneResponse = {
  urn: URN, total: 3, anni: [{ anno: 2024, passi: 2 }, { anno: 2016, passi: 1 }], archivi: ['civile'],
  anno: 2024, items: [passo('a', 2024)], next_cursor: '1',
};

const reportYears = vi.fn();

function renderPanel(text = '') {
  const filters = { filters: { ...NO_FILTERS, text }, reportYears };
  return render(
    <MemoryRouter>
      <CaseLawFiltersContext.Provider value={filters}><RassegnePanel articleUrn={URN} /></CaseLawFiltersContext.Provider>
    </MemoryRouter>,
  );
}

async function openPanel() {
  const row = await screen.findByRole('button', { name: /Nelle rassegne della Cassazione/ });
  fireEvent.click(row);
}

describe('RassegnePanel', () => {
  beforeEach(() => {
    clearRassegneCache();
    fetchRassegne.mockReset();
    readArticleReference.mockReset();
    reportYears.mockReset();
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
    const row = await screen.findByRole('button', { name: /Nelle rassegne della Cassazione/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Nelle rassegne della Cassazione')).toBeInTheDocument();
    expect(screen.getByText('3 passi, 2016–2024')).toBeInTheDocument();
    expect(screen.queryByText("Rassegna dell'anno 2024")).not.toBeInTheDocument();
  });

  it('opens with the keyboard on the newest year', async () => {
    fetchRassegne.mockResolvedValue(SUMMARY);
    renderPanel();
    const row = await screen.findByRole('button', { name: /Nelle rassegne della Cassazione/ });
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText("Rassegna dell'anno 2024")).toBeInTheDocument();
    expect(screen.getByText(/Rassegna civile 2024 · vol\. 1 › CAPITOLO I › § 2 Il danno\./)).toBeInTheDocument();
    expect(screen.getByText('di Anna Rossi')).toBeInTheDocument();
    const mark = screen.getByText('art. 2043 c.c.');
    expect(mark.tagName).toBe('MARK');
  });

  it('links a decision with an identity to its address, labelled in the source convention, not by the stored copy', async () => {
    fetchRassegne.mockResolvedValue(SUMMARY);
    renderPanel();
    await openPanel();
    const chip = await screen.findByText('Cass. civ., sez. un., n. 1234/2024 · Rv. 670001-01');
    expect(chip.closest('a')).toHaveAttribute('href', '/sentenze/cassazione-civile/1234/2024');
  });

  it('leaves a decision without a year a plain label', async () => {
    const withoutYear = {
      ...passo('a', 2024),
      pronunce: [{ key: null, corte: 'cassazione', archivio: 'civile',
                   numero: 1234, anno: null, sezione: 'U', rv: ['670001-01'] }],
    };
    fetchRassegne.mockResolvedValue({ ...SUMMARY, items: [withoutYear] });
    renderPanel();
    await openPanel();
    const chip = await screen.findByText('Cass. civ., sez. un., n. 1234 · Rv. 670001-01');
    expect(chip.closest('a')).toBeNull();
  });

  it('draws a passage as the section’s row: its source, the text cut at three lines, «Mostra tutto» when it is long', async () => {
    const long = `Secondo l'art. 2043 c.c. ${'il danno deve essere ingiusto '.repeat(20)}`;
    fetchRassegne.mockResolvedValue({ ...SUMMARY, items: [passo('a', 2024, long)] });
    renderPanel();
    await openPanel();
    expect(await screen.findByText('Massimario')).toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'Mostra tutto' });
    const text = document.getElementById(more.getAttribute('aria-controls')!)!;
    expect(text).toHaveClass('line-clamp-3');
    fireEvent.click(more);
    expect(text).not.toHaveClass('line-clamp-3');
    expect(screen.getByRole('button', { name: 'Mostra meno' })).toBeInTheDocument();
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

  it('renders nothing, and logs nothing, when the API has no such route (an older one, during a deploy)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchRassegne.mockRejectedValue(new RassegneError(404));
    const { container } = renderPanel();
    await waitFor(() => expect(fetchRassegne).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it.each([
    ['the store cannot be read', new RassegneError(503)],
    ['the network fails', new RassegneError(undefined)],
  ])('when %s, the panel\u2019s row says so quietly, with nothing to open', async (_, failure) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchRassegne.mockRejectedValue(failure);
    const { container } = renderPanel();
    expect(await screen.findByText('Non disponibili al momento')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nelle rassegne della Cassazione' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/passi/)).not.toBeInTheDocument();
    expect(container.querySelector('[class*="amber"]')).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('a year that fails to load says so quietly, inside it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchRassegne
      .mockResolvedValueOnce(SUMMARY)
      .mockRejectedValueOnce(new RassegneError(503));
    renderPanel();
    await openPanel();
    fireEvent.click(await screen.findByRole('button', { name: /Rassegna dell'anno 2016/ }));
    expect(await screen.findByText('Le rassegne non sono disponibili al momento.')).toBeInTheDocument();
    expect(screen.getByText("Rassegna dell'anno 2024")).toBeInTheDocument();
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
    expect(await screen.findByText('Le rassegne non sono disponibili al momento.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tutte' }));
    await waitFor(() => expect(screen.queryByText('Le rassegne non sono disponibili al momento.')).not.toBeInTheDocument());
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
    expect(await screen.findByRole('button', { name: /Nelle rassegne della Cassazione/ }))
      .toHaveAttribute('aria-expanded', 'false');
  });

  it('sends the section’s text filter to the store, after a pause, and shows its passages as they come', async () => {
    fetchRassegne.mockImplementation(async (query: { q?: string }) => (query.q
      ? { ...SUMMARY, total: 1, anni: [{ anno: 2016, passi: 1 }], anno: 2016, items: [passo('k', 2016, 'Un passo senza la parola.')], next_cursor: null }
      : SUMMARY));
    renderPanel('Danno, ingiusto: a');
    await openPanel();
    // the article's own count stays on the row; the search's count is said inside
    expect(screen.getByText('3 passi, 2016–2024')).toBeInTheDocument();
    await waitFor(() => expect(fetchRassegne).toHaveBeenCalledWith({ urn: URN, q: 'Danno ingiusto' }));
    expect(await screen.findByText('1 passo con le parole cercate.')).toBeInTheDocument();
    // the store searched the words: its passage is not filtered again by the text
    expect(screen.getByText('Un passo senza la parola.')).toBeInTheDocument();
    expect(screen.queryByText("Rassegna dell'anno 2024")).toBeNull();
  });

  it('says when no passage holds the words, and keeps the row', async () => {
    fetchRassegne.mockImplementation(async (query: { q?: string }) => (query.q
      ? { ...SUMMARY, total: 0, anni: [], anno: null, items: [], next_cursor: null }
      : SUMMARY));
    renderPanel('inesistente');
    await openPanel();
    expect(await screen.findByText('Nessun passo con le parole cercate.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nelle rassegne della Cassazione/ })).toBeInTheDocument();
  });

  it('asks the store once the words have stayed still, not at every key', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchRassegne.mockResolvedValue(SUMMARY);
      const filtersOf = (text: string) => ({ filters: { ...NO_FILTERS, text }, reportYears });
      const view = (text: string) => (
        <MemoryRouter>
          <CaseLawFiltersContext.Provider value={filtersOf(text)}><RassegnePanel articleUrn={URN} /></CaseLawFiltersContext.Provider>
        </MemoryRouter>
      );
      const { rerender } = render(view(''));
      await waitFor(() => expect(fetchRassegne).toHaveBeenCalledTimes(1));
      rerender(view('dan'));
      await act(async () => { vi.advanceTimersByTime(200); });
      rerender(view('danno'));
      await act(async () => { vi.advanceTimersByTime(200); });
      expect(fetchRassegne).toHaveBeenCalledTimes(1); // still typing: nothing asked
      await act(async () => { vi.advanceTimersByTime(200); });
      await waitFor(() => expect(fetchRassegne).toHaveBeenCalledTimes(2));
      expect(fetchRassegne).toHaveBeenLastCalledWith({ urn: URN, q: 'danno' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks nothing of the store for more than eight words, and says the filter is on the passages loaded', async () => {
    fetchRassegne.mockResolvedValue(SUMMARY);
    renderPanel('uno due tre quattro cinque sei sette otto nove');
    await openPanel();
    expect(await screen.findByText(/si cercano al massimo 8 parole/)).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(fetchRassegne.mock.calls.every(([query]) => !('q' in query))).toBe(true);
  });

  it('never writes the words searched in the browser’s console', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchRassegne.mockImplementation(async (query: { q?: string }) => {
      if (query.q) throw new RassegneError(503);
      return SUMMARY;
    });
    renderPanel('segretissimo');
    await openPanel();
    expect(await screen.findByText('Le rassegne non sono disponibili al momento.')).toBeInTheDocument();
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain('segretissimo');
    error.mockRestore();
  });

  it('shows another article’s passages by its reference, and goes back', async () => {
    const OTHER = URN.replace('art2043', 'art1218');
    readArticleReference.mockResolvedValue({ esito: 'articolo', urn: OTHER, label: 'art. 1218 c.c.' });
    const base = passo('o', 2020, 'Un passo sull\'inadempimento.');
    const cites1999 = { ...base, pronunce: [{ ...base.pronunce[0], key: 'cassazione:civile:1:1999', numero: 1, anno: 1999 }] };
    fetchRassegne.mockImplementation(async (query: { urn: string }) => (query.urn === OTHER
      ? { ...SUMMARY, urn: OTHER, total: 1, anni: [{ anno: 2020, passi: 1 }], anno: 2020, items: [cites1999], next_cursor: null }
      : SUMMARY));
    renderPanel();
    await openPanel();
    await userEvent.type(screen.getByRole('textbox', { name: 'Rassegne di un altro articolo' }), 'art 1218 cc');
    await userEvent.click(screen.getByRole('button', { name: 'Cerca' }));
    expect(readArticleReference).toHaveBeenCalledWith('art 1218 cc');
    expect(await screen.findByText('Un passo sull\'inadempimento.')).toBeInTheDocument();
    expect(screen.getByText('art. 1218 c.c.')).toBeInTheDocument();
    expect(fetchRassegne).toHaveBeenCalledWith({ urn: OTHER });
    // another article's passages do not count in the section's year chips, which serve the article's blocks
    const reported = reportYears.mock.calls.filter(([, counts]) => counts && counts.length > 0).map(([, counts]) => counts);
    expect(reported.flat().some((c: { year: number }) => c.year === 1999)).toBe(false);
    // the form went away: the focus is on the way back, and comes back to the form
    expect(screen.getByRole('button', { name: 'Torna all’articolo' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Torna all’articolo' }));
    expect(await screen.findByText("Rassegna dell'anno 2024")).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Rassegne di un altro articolo' })).toHaveFocus();
    expect(screen.queryByText('Un passo sull\'inadempimento.')).toBeNull();
  });

  it('says when another article has no passage', async () => {
    const OTHER = URN.replace('art2043', 'art1');
    readArticleReference.mockResolvedValue({ esito: 'articolo', urn: OTHER, label: 'art. 1 c.c.' });
    fetchRassegne.mockImplementation(async (query: { urn: string }) => (query.urn === OTHER
      ? { ...SUMMARY, urn: OTHER, total: 0, anni: [], anno: null, items: [], next_cursor: null }
      : SUMMARY));
    renderPanel();
    await openPanel();
    await userEvent.type(screen.getByRole('textbox', { name: 'Rassegne di un altro articolo' }), 'art 1 cc');
    await userEvent.click(screen.getByRole('button', { name: 'Cerca' }));
    expect(await screen.findByText('Nessun passo delle rassegne cita art. 1 c.c..')).toBeInTheDocument();
  });

  it.each([
    [{ esito: 'non_riconosciuto' }, /Riferimento non riconosciuto/],
    [{ esito: 'non_un_articolo' }, /Indica un solo articolo/],
    [{ esito: 'non_disponibile' }, /non si può leggere al momento/],
  ])('a reference that names no single article says why (%o)', async (answer, notice) => {
    readArticleReference.mockResolvedValue(answer);
    fetchRassegne.mockResolvedValue(SUMMARY);
    renderPanel();
    await openPanel();
    await userEvent.type(screen.getByRole('textbox', { name: 'Rassegne di un altro articolo' }), 'codice civile');
    await userEvent.click(screen.getByRole('button', { name: 'Cerca' }));
    expect(await screen.findByRole('status', { name: '' })).toBeDefined();
    expect(await screen.findByText(notice)).toBeInTheDocument();
    expect(fetchRassegne).toHaveBeenCalledTimes(1);
  });
});
