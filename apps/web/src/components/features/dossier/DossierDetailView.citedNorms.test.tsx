import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ParsedCitationData } from '../../../utils/citationMatcher';

vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => true, isDesktopViewport: () => true }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }) }));
vi.mock('../../../services/legalFetch', () => ({ legalFetch: vi.fn(() => new Promise(() => {})) }));
// D7b's flag: off here, with no request leaving the test.
vi.mock('../../../services/assistantService', () => ({ assistantService: { features: vi.fn(async () => ({ assistantPassages: false })) } }));
vi.mock('./useActDetails', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useActDetails')>()),
  useActDetails: () => ({ title: null, rubricaOf: () => null }),
}));
vi.mock('../../../utils/actStructureCache', () => ({ fetchActTree: () => Promise.resolve([]), fetchActRubriche: () => Promise.resolve({}) }));
vi.mock('../search/ArticleTabContent', () => ({ ArticleTabContent: () => <div data-testid="reader" /> }));
vi.mock('../search/TreeViewPanel', () => ({ TreeViewPanel: () => null }));
vi.mock('../workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../decisions/DecisionSearchTabView', () => ({ DecisionSearchTabView: () => null }));
vi.mock('../atti/DossierAttiPanel', () => ({ DossierAttiPanel: () => null }));
vi.mock('../planner/DossierTasksPanel', () => ({ DossierTasksPanel: () => null }));
vi.mock('../../../features/deadlines/DeadlineCard', () => ({ DeadlineCard: () => null }));
vi.mock('../../../services/dossierService', () => ({
  dossierService: {
    getSnapshots: vi.fn(async () => []), addItem: vi.fn(), getById: vi.fn(() => new Promise(() => {})),
    reorderItems: vi.fn(async () => {}), updateItem: vi.fn(async () => ({})), writesInFlight: () => 0,
  },
}));
// The cited norm as the source answers it.
const fetched = vi.hoisted(() => ({ fetchArticleForNorma: vi.fn() }));
vi.mock('../../../utils/articleFetchCache', () => fetched);

// The decision's reader, reduced to the links its text draws, with the reading's own route for the norms it cites
// (`useTableCitedNorms`; the surface's own tests: `DecisionEntryView.dossier.test.tsx`). The page's answer is tested here.
const CITED = vi.hoisted(() => ({
  held: { act_type: 'legge', act_number: '247', date: '2012-12-31', article: '3', confidence: 0.95 },
  absent: { act_type: 'codice civile', article: '2043', confidence: 0.95 },
}));
vi.mock('../decisions/DecisionEntryView', async () => {
  const { useTableCitedNorms } = await import('../practice/inDossier');
  return {
    DecisionEntryView: ({ hostId }: { hostId: string }) => {
      const cited = useTableCitedNorms(hostId);
      const link = (citation: ParsedCitationData, words: string) => (
        <button type="button" onClick={() => cited?.open(citation, null)}>{words}</button>
      );
      return (
        <div data-testid="decision-text">
          {link(CITED.held, 'art. 3 l. 247/2012')} {link(CITED.absent, 'art. 2043 c.c.')}
          <span>{cited?.holds(CITED.held) ? 'art. 3 nella pratica' : ''}</span>
          <span>{cited?.holds(CITED.absent) ? 'art. 2043 nella pratica' : ''}</span>
          <span>{cited?.elsewhere}</span>
        </div>
      );
    },
  };
});

import { appStore } from '../../../store/useAppStore';
import { DossierDetailView } from './DossierDetailView';
import type { Dossier } from '../../../types';

const L247 = { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31' };
const dossier: Dossier = {
  id: 'd1', title: 'Ricorso Rossi', createdAt: '2026-10-04T08:00:00Z', tags: [],
  items: [
    { id: 'a3', type: 'norma', addedAt: '', data: { ...L247, numero_articolo: '3' } },
    { id: 's1', type: 'sentenza', addedAt: '', data: { corte: 'corte_costituzionale', numero: 1, anno: 2014, tipo: 'sentenza', data_deposito: '2014-01-13', etichetta: 'x' } },
  ],
};

function renderView() {
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, searchTrigger: null,
    practiceNotice: null, readingBackStack: [], phoneReader: null, windowFocusRequest: null, structureWindow: { blockId: null },
    dossiers: [structuredClone(dossier)], pendingDossierItemIds: {}, pendingDossierOrders: {},
  });
  render(
    <MemoryRouter initialEntries={['/pratiche/d1']}>
      <Routes>
        <Route path="/pratiche/:id" element={<DossierDetailView dossier={appStore.getState().dossiers[0]} onBack={() => {}} showToast={() => {}} />} />
        <Route path="/" element={<p>Dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );
  // The decision opened in place, its text drawn.
  fireEvent.click(within(screen.getByTestId('practice-decisions')).getByRole('button', { name: /^Espandi / }));
  return screen.getByTestId('decision-text');
}

const articleToggle = (numero: string) => screen.queryByRole('button', { name: new RegExp(`^(Espandi|Comprimi) art\\. ${numero}`) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.removeItem('visualex-dossier-last-read');
});

// LC88: rewritten for the one «Fonti» (LC86). A norm a decision cites goes through the reading's route: put on the
// dossier's table, never into the dossier, never into the Ricerca.
describe('a norm a decision cites, in «Fonti» (D7d)', () => {
  it('says whether the dossier holds it, and names «Fonti» as where it opens', () => {
    const text = renderView();
    expect(within(text).getByText('art. 3 nella pratica')).toBeInTheDocument();
    expect(within(text).queryByText('art. 2043 nella pratica')).toBeNull();
    expect(within(text).getByText('Apri in Fonti')).toBeInTheDocument();
  });

  it('held, opens its row in place; the decision stays open and the page stays', async () => {
    fetched.fetchArticleForNorma.mockResolvedValue({ norma_data: { ...L247, numero_articolo: '3' }, article_text: '' });
    const text = renderView();
    expect(articleToggle('3')).toHaveAttribute('aria-expanded', 'false');
    await act(async () => { fireEvent.click(within(text).getByRole('button', { name: 'art. 3 l. 247/2012' })); });
    await waitFor(() => expect(articleToggle('3')).toHaveAttribute('aria-expanded', 'true'));
    expect(appStore.getState().searchTrigger).toBeNull();
    expect(screen.queryByText('Dashboard')).toBeNull();
    expect(screen.getByTestId('decision-text')).toBe(text);
    expect(appStore.getState().dossiers[0].items).toHaveLength(2);
  });

  it('not held, puts it on the table, open and marked «Non nella pratica», without adding it or asking with a dialog', async () => {
    fetched.fetchArticleForNorma.mockResolvedValue({ norma_data: { tipo_atto: 'codice civile', numero_atto: '', data: '1942-03-16', numero_articolo: '2043' }, article_text: '' });
    const text = renderView();
    await act(async () => { fireEvent.click(within(text).getByRole('button', { name: 'art. 2043 c.c.' })); });
    expect(fetched.fetchArticleForNorma).toHaveBeenCalledWith(expect.objectContaining({ tipo_atto: 'codice civile', numero_articolo: '2043' }));
    await waitFor(() => expect(articleToggle('2043')).toHaveAttribute('aria-expanded', 'true'));
    expect(articleToggle('2043')).toHaveAccessibleName(/non nella pratica/);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(appStore.getState().searchTrigger).toBeNull();
    expect(appStore.getState().dossiers[0].items).toHaveLength(2);
  });
});
