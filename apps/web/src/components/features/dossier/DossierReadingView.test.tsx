import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchParams } from '../../../types';

const h = vi.hoisted(() => ({
  desktop: true,
  legalFetch: vi.fn(),
  tours: vi.fn(),
  fallback: vi.fn(),
  cited: null as SearchParams | null,
}));
vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => h.desktop, isDesktopViewport: () => h.desktop }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ tryStartTour: h.tours, startTour: h.tours, hasSeenTour: () => true }),
}));
vi.mock('../../../services/legalFetch', () => ({ legalFetch: h.legalFetch }));
vi.mock('../../../services/dossierService', () => ({ dossierService: { addItem: vi.fn(), writesInFlight: () => 0 } }));
vi.mock('../../../utils/actStructureCache', () => ({
  fetchActTree: () => Promise.resolve([]),
  fetchActRubriche: () => Promise.resolve({}),
}));
// The reader, reduced to its text and two of its gestures: a norm of another act (the host's search) and one of the same act.
vi.mock('../search/ArticleTabContent', async () => {
  const { useReadingSearch } = await import('../practice/readingHost');
  return {
    ArticleTabContent: ({ data, onCrossReferenceNavigate }: {
      data: { article_text?: string; norma_data: Record<string, string> };
      onCrossReferenceNavigate?: (n: string, d: unknown) => void;
    }) => {
      const search = useReadingSearch(h.fallback);
      return (
        <div data-testid="reader">
          {data.article_text}
          <button type="button" onClick={() => search(h.cited as SearchParams)}>norma citata</button>
          <button type="button" onClick={() => onCrossReferenceNavigate?.('7', data.norma_data)}>stesso atto</button>
        </div>
      );
    },
  };
});
vi.mock('../search/TreeViewPanel', () => ({ TreeViewPanel: () => null }));
vi.mock('../workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../decisions/DecisionEntryView', () => ({ DecisionEntryView: () => <div data-testid="decision-reader" /> }));
vi.mock('../decisions/DecisionSearchTabView', () => ({ DecisionSearchTabView: () => null }));
vi.mock('../../ui/PDFViewer', () => ({ PDFViewer: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div role="dialog" aria-label="PDF" /> : null) }));

import { appStore } from '../../../store/useAppStore';
import { dossierService } from '../../../services/dossierService';
import { clearArticleCache } from '../../../utils/articleFetchCache';
import { L241, article } from '../../../utils/__fixtures__/savedWorkspaces';
import { articleRowKey, isBoundPractice, practiceArticleKey, type Practice } from '../../../utils/practice';
import type { Dossier, DossierItem } from '../../../types';
import { DossierReadingView } from './DossierReadingView';

/** LC54 c3: the dossier's «Lettura», the Corpus's reading on the dossier's own bound table. */

const s = () => appStore.getState();
const norma = (numero: string, more: Record<string, string> = {}): DossierItem => ({
  id: `n${numero}`, addedAt: '', type: 'norma',
  data: { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08', numero_articolo: numero, ...more },
});
const dossierOf = (items: DossierItem[]): Dossier => ({ id: 'dos-1', title: 'Ricorso Rossi', createdAt: '', items });
const TWO = dossierOf([norma('5'), norma('7')]);
const toast = vi.fn();

const bound = (): Practice | undefined => s().practices.find(isBoundPractice);
const boundRow = (numero: string) => {
  const act = bound()!.acts.find((a) => a.articles.some((r) => r.norma_data.numero_articolo === numero))!;
  const row = act.articles.find((r) => r.norma_data.numero_articolo === numero)!;
  return { actId: act.id, articleKey: practiceArticleKey(row), row };
};
const openRow = (numero: string) => {
  const { actId, articleKey } = boundRow(numero);
  act(() => { s().setRowOpen(articleRowKey(bound()!.id, actId, articleKey), true); });
};
const answer = (text: string, data: Record<string, string>) => ({
  ok: true, status: 200, json: async () => [{ article_text: text, norma_data: data }],
});
const L24_ART = (numero: string) => ({ tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08', numero_articolo: numero });

let corpus: string;

beforeEach(() => {
  h.desktop = true;
  h.legalFetch.mockReset();
  h.tours.mockReset();
  h.fallback.mockReset();
  toast.mockReset();
  vi.mocked(dossierService.addItem).mockReset();
  clearArticleCache();
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, searchTrigger: null,
    practiceNotice: null, readingBackStack: [], phoneReader: null, windowFocusRequest: null,
    structureWindow: { blockId: null, position: { x: 0, y: 0 } }, dossiers: [TWO],
  });
  corpus = s().createPractice('Del Corpus');
  s().addArticlesToPractice(corpus, L241, [article(L241, '2')]);
  s().setActivePractice(corpus);
  h.cited = { act_type: 'legge', act_number: '241', date: '1990-08-07', article: '3', version: 'vigente' };
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the «Lettura» builds the dossier\'s bound table and shows it', () => {
  it('builds one bound table from the dossier, shows its acts, and leaves the Corpus\'s active practice alone', () => {
    render(<DossierReadingView dossier={TWO} showToast={toast} />);
    expect(bound()?.dossierId).toBe('dos-1');
    expect(screen.getByRole('region', { name: 'l. 8 marzo 2017, n. 24' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'l. 7 agosto 1990, n. 241' })).toBeNull();
    expect(s().activePracticeId).toBe(corpus);
    expect(s().practices.filter(isBoundPractice)).toHaveLength(1);
  });

  it('says, at its head, what happens to what is opened while reading', () => {
    render(<DossierReadingView dossier={TWO} showToast={toast} />);
    expect(screen.getByText('Quello che apri leggendo resta qui finché non lo aggiungi alla pratica.')).toBeInTheDocument();
  });

  it('re-syncs the table when the dossier is refreshed (an item added, by Claude too)', () => {
    const view = render(<DossierReadingView dossier={TWO} showToast={toast} />);
    const id = bound()!.id;
    view.rerender(<DossierReadingView dossier={dossierOf([norma('5'), norma('7'), norma('9')])} showToast={toast} />);
    expect(bound()!.id).toBe(id);
    expect(bound()!.acts[0].articles.map((a) => a.norma_data.numero_articolo)).toEqual(['5', '7', '9']);
    expect(s().activePracticeId).toBe(corpus);
  });
});

describe('what is the Corpus practice\'s is not drawn in the dossier', () => {
  const PRACTICE_ONLY = ['Salva come dossier', 'Nuova pratica', 'Rinomina', 'Chiudi la pratica', "Sposta in un'altra pratica"];

  it('on a computer: no practice header, name or count, no practice actions in the act\'s «⋯», no tour, no room for the bar', () => {
    render(<DossierReadingView dossier={TWO} showToast={toast} />);
    expect(screen.queryByRole('heading', { level: 2, name: 'Ricorso Rossi' })).toBeNull();
    // the practice's header (its name and its count line), on screen or for a screen reader
    expect(document.getElementById('tour-practice-header')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Azioni su l. 8 marzo 2017, n. 24' }));
    for (const label of PRACTICE_ONLY) expect(screen.queryByText(label)).toBeNull();
    // An act of the dossier leaves it rather than the table (LC55 c4).
    expect(screen.getByRole('menuitem', { name: 'Togli dalla pratica' })).toBeInTheDocument();
    expect(h.tours).not.toHaveBeenCalled();
    expect(screen.getByTestId('practice-column').className).not.toContain('practice-bar-height');
  });

  it('one article alone (the simple reading): its act\'s «⋯» carries no practice actions either', () => {
    render(<DossierReadingView dossier={dossierOf([norma('5')])} showToast={toast} />);
    fireEvent.click(screen.getByRole('button', { name: /Azioni su/ }));
    for (const label of PRACTICE_ONLY) expect(screen.queryByText(label)).toBeNull();
  });

  it('on a phone: the column with its rows, no list of practices, no «Salva come dossier»', () => {
    h.desktop = false;
    render(<DossierReadingView dossier={TWO} showToast={toast} />);
    expect(screen.getByTestId('practice-phone-view')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'l. 8 marzo 2017, n. 24' })).toBeInTheDocument();
    expect(screen.queryByTitle('Elenco delle pratiche')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Salva come dossier' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Altre azioni per la pratica/ })).toBeNull();
  });
});

describe('a row\'s text as it loads', () => {
  it('says «Carico il testo…» while it comes, then reads it', async () => {
    let arrive: (v: unknown) => void = () => {};
    h.legalFetch.mockReturnValueOnce(new Promise((resolve) => { arrive = resolve; }));
    render(<DossierReadingView dossier={TWO} showToast={toast} />);
    openRow('5');
    expect(await screen.findByText('Carico il testo…')).toBeInTheDocument();
    expect(screen.queryByTestId('reader')).toBeNull();
    await act(async () => { arrive(answer('Testo del 5', L24_ART('5'))); });
    expect(await screen.findByText('Testo del 5')).toBeInTheDocument();
    expect(screen.queryByText('Carico il testo…')).toBeNull();
  });

  it('after a failure says «Non riesco a leggere il testo.» with «Riprova», which asks again', async () => {
    h.legalFetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) });
    render(<DossierReadingView dossier={TWO} showToast={toast} />);
    openRow('5');
    expect(await screen.findByText('Non riesco a leggere il testo.')).toBeInTheDocument();
    h.legalFetch.mockResolvedValueOnce(answer('Testo del 5', L24_ART('5')));
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText('Testo del 5')).toBeInTheDocument();
    expect(h.legalFetch).toHaveBeenCalledTimes(2);
  });

  it('the act takes its URN from the text it loads, so «Struttura» and «PDF» are there', async () => {
    h.legalFetch.mockResolvedValueOnce(answer('Testo del 5', { ...L24_ART('5'), url: 'urn:nir:stato:legge:2017-03-08;24~art5' }));
    render(<DossierReadingView dossier={TWO} showToast={toast} />);
    expect(screen.queryByRole('button', { name: 'Esporta PDF della norma' })).toBeNull();
    openRow('5');
    expect(await screen.findByRole('button', { name: 'Esporta PDF della norma' })).toBeInTheDocument();
  });
});

describe('the dossier hosts the reading: its gestures stay on its table', () => {
  it('a norm of another act lands on the bound table, revealed, never in the dossier nor in the Corpus', async () => {
    h.legalFetch.mockResolvedValueOnce(answer('Testo del 5', L24_ART('5')));
    render(<DossierReadingView dossier={TWO} showToast={toast} />);
    openRow('5');
    await screen.findByText('Testo del 5');
    const corpusBefore = s().practices.find((p) => p.id === corpus);
    h.legalFetch.mockResolvedValueOnce(answer('Testo del 3 della 241', { tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', numero_articolo: '3', url: 'urn:241~art3' }));
    fireEvent.click(screen.getByRole('button', { name: 'norma citata' }));
    expect(await screen.findByText('Testo del 3 della 241')).toBeInTheDocument();
    const landed = bound()!.acts.find((a) => a.norma.numero_atto === '241');
    expect(landed?.articles.map((a) => a.norma_data.numero_articolo)).toEqual(['3']);
    expect(landed?.norma.urn).toBe('urn:241~art3');
    expect(s().practiceRows[articleRowKey(bound()!.id, landed!.id, practiceArticleKey(landed!.articles[0]))]).toBe(true);
    expect(s().practices.find((p) => p.id === corpus)).toBe(corpusBefore);
    expect(s().activePracticeId).toBe(corpus);
    expect(s().searchTrigger).toBeNull();
    expect(h.fallback).not.toHaveBeenCalled();
    expect(dossierService.addItem).not.toHaveBeenCalled();
    expect(s().dossiers[0]).toBe(TWO);
  });

  it('a past text («testo al…») is a row of its own beside the text in force', async () => {
    h.legalFetch.mockResolvedValueOnce(answer('Testo del 5', L24_ART('5')));
    render(<DossierReadingView dossier={TWO} showToast={toast} />);
    openRow('5');
    await screen.findByText('Testo del 5');
    h.cited = { act_type: 'legge', act_number: '24', date: '2017-03-08', article: '5', version: 'vigente', version_date: '2018-01-01' };
    h.legalFetch.mockResolvedValueOnce(answer('Testo del 5 al 2018', { ...L24_ART('5'), versione: 'vigente', data_versione: '2018-01-01' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'norma citata' })[0]);
    await waitFor(() => expect(bound()!.acts[0].articles).toHaveLength(3));
    expect(bound()!.acts).toHaveLength(1);
  });

  it('a failed gesture leaves its row on the table, which says so and offers «Riprova»', async () => {
    h.legalFetch.mockResolvedValueOnce(answer('Testo del 5', L24_ART('5')));
    render(<DossierReadingView dossier={TWO} showToast={toast} />);
    openRow('5');
    await screen.findByText('Testo del 5');
    h.legalFetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) });
    fireEvent.click(screen.getByRole('button', { name: 'norma citata' }));
    expect(await screen.findByText('Non riesco a leggere il testo.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeInTheDocument();
    expect(s().searchTrigger).toBeNull();
  });

  it('a norm of the same act already on the table is revealed, with no request', async () => {
    h.legalFetch.mockResolvedValueOnce(answer('Testo del 5', L24_ART('5')));
    render(<DossierReadingView dossier={TWO} showToast={toast} />);
    openRow('5');
    await screen.findByText('Testo del 5');
    fireEvent.click(screen.getByRole('button', { name: 'stesso atto' }));
    const { actId, articleKey } = boundRow('7');
    expect(s().practiceRows[articleRowKey(bound()!.id, actId, articleKey)]).toBe(true);
    expect(s().searchTrigger).toBeNull();
    expect(s().activePracticeId).toBe(corpus);
  });

  it('the act\'s PDF opens here, from the dossier', async () => {
    h.legalFetch.mockResolvedValueOnce({ ok: true, status: 200, blob: async () => new Blob(['%PDF']) });
    const urlOf = vi.fn(() => 'blob:pdf');
    Object.assign(window.URL, { createObjectURL: urlOf });
    render(<DossierReadingView dossier={dossierOf([norma('5', { urn: 'urn:nir:stato:legge:2017-03-08;24~art5' }), norma('7')])} showToast={toast} />);
    fireEvent.click(screen.getByRole('button', { name: 'Esporta PDF della norma' }));
    await waitFor(() => expect(h.legalFetch).toHaveBeenCalledWith('/export_pdf', expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByRole('dialog', { name: 'PDF' })).toBeInTheDocument();
  });

  it('a dossier with nothing to read says so', () => {
    render(<DossierReadingView dossier={dossierOf([])} showToast={toast} />);
    expect(screen.getByText('Questa pratica non ha ancora norme o sentenze da leggere.')).toBeInTheDocument();
    expect(within(document.body).queryByText('Pratica vuota')).toBeNull();
  });
});
