import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ArticleData, DossierItem, NormaVisitata, Proposal } from '../../../../types';

vi.mock('../../../../services/articleDiscussionService', () => ({
  articleDiscussionService: {
    list: vi.fn(async () => ({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 } })),
    listPassages: vi.fn(async () => []), create: vi.fn(), comment: vi.fn(), report: vi.fn(), voteThread: vi.fn(), voteComment: vi.fn(),
  },
}));
vi.mock('../../../../services/studiaService', () => ({ studiaService: { forArticle: () => Promise.resolve([]) } }));
vi.mock('../../../../services/authService', () => ({ isAuthenticated: () => true }));
vi.mock('../../../../services/notificationService', () => ({ notificationService: { checkNorma: vi.fn(async () => ({ changed: false })) } }));
vi.mock('../../../../features/devMode/useDevMode', () => ({ useDevMode: () => false }));
vi.mock('../../../../features/merlt/useMerltFeatures', () => ({
  useMerltFeatures: () => ({ canContribute: false, qaAskable: false, consentLevel: 'basic', merltEnabled: false }),
}));
vi.mock('../../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
vi.mock('../../rassegne/RassegnePanel', () => ({ RassegnePanel: () => null }));
vi.mock('../../../../services/assistantService', () => ({
  assistantService: {
    features: vi.fn(), listProposals: vi.fn(), setProposalState: vi.fn(), editProposalNote: vi.fn(), moveProposal: vi.fn(),
    removeProposal: vi.fn(), removeProposalOnExit: vi.fn(), refreshForExit: vi.fn(async () => {}),
  },
}));

import { ArticleTabContent } from '../ArticleTabContent';
import { appStore } from '../../../../store/useAppStore';
import { assistantService } from '../../../../services/assistantService';
import { assistantProposalsStore } from '../../../../store/assistantProposals';
import { ReadingHostContext } from '../../practice/readingHost';
import { CurrentDossierContext } from '../../dossier/currentDossier';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../../utils/normaKeys';
import { fixtureText } from '../../../../utils/__fixtures__/articleTexts';
import { aiNote } from '../../../../utils/__fixtures__/assistantNote';
import { GLOSS_WORDS } from '../../../../constants/glossWords';

/** LC58 c5: an article read in a dossier's «Lettura» shows the dossier's work on it, as «Fonti» does. */

const norma: NormaVisitata = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1453' };
const RAW = fixtureText('nrm-cc-1453');
const PLAIN = RAW.replace(/\n/g, '');
const at = (words: string) => PLAIN.indexOf(words);
const data: ArticleData = { article_text: RAW, norma_data: norma };

const proposal = (id: string, words: string, over: Partial<Proposal> = {}): Proposal => ({
  id, kind: 'gloss', normaKey: `${buildItemKey(norma)}::art::${uniqueArticleIdFromNorma(norma)}`, text: words, color: null,
  startOffset: at(words), endOffset: at(words) + words.length, createdAt: '2026-10-29T09:00:00Z', dossierItemId: 'a1',
  proposedBy: { clientName: 'Claude Code' }, assistantRange: { startOffset: at(words), text: words },
  rangeEdited: false, rangeEditedAt: null, rangeEditedBy: null, note: aiNote('La parte che ha adempiuto può scegliere.'),
  ...over,
});
const gloss = proposal('g1', 'contraenti');
const mark: Proposal = { ...proposal('p1', 'obbligazioni'), kind: 'mark', color: 'green', note: aiNote('Il presupposto.') };
const lost: Proposal = { ...proposal('g2', 'parole che non ci sono'), startOffset: 12 };

const items: DossierItem[] = [
  { id: 'a1', addedAt: '', type: 'norma', data: norma },
  { id: 'nt1', addedAt: '2026-11-10T09:00:00Z', type: 'note', data: 'Da citare nel ricorso, punto 2.', aboutItemId: 'a1' },
  { id: 'nt2', addedAt: '', type: 'note', data: 'Una nota libera della pratica.' },
];

function lettura(dossierItemId: string | undefined) {
  return render(
    <MemoryRouter>
      <CurrentDossierContext.Provider value="dos-1">
        <ReadingHostContext.Provider value={{ search: vi.fn(), dossier: { id: 'dos-1' } }}>
          <ArticleTabContent data={data} dossierItemId={dossierItemId} />
        </ReadingHostContext.Provider>
      </CurrentDossierContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assistantService.listProposals).mockResolvedValue([gloss, mark, lost]);
  assistantProposalsStore.setState({ enabled: true, byItem: {} });
  appStore.setState({
    loadAnnotationsForArticle: vi.fn(), loadHighlightsForArticle: vi.fn(), highlights: [], annotations: [], bookmarks: [],
    dossiers: [{ id: 'dos-1', title: 'Ricorso Rossi', createdAt: '', items }],
  });
});

describe('ArticleTabContent in a dossier\'s «Lettura»: what an application proposed (D7b)', () => {
  it('reads the entry\'s proposals: the coloured passage drawn, a gloss counted on its sign, never a mark', async () => {
    const { container } = lettura('a1');
    await waitFor(() => expect(container.querySelector('[data-highlight="p1"]')).not.toBeNull());
    expect(assistantService.listProposals).toHaveBeenCalledWith('dos-1', 'a1');
    expect(container.querySelector('[data-highlight="g1"]')).toBeNull();
    await waitFor(() => expect(container.querySelector('.vlx-sign .vlx-sign-gloss[data-state="proposed"]')).not.toBeNull());
    // the text is the text, and nothing entered the reader's own highlights
    expect(container.querySelector('.vlx-art')?.textContent).toBe(PLAIN);
    expect(appStore.getState().highlights).toEqual([]);
  });

  it('a gloss whose words are not in the text is listed under it, with its actions', async () => {
    lettura('a1');
    const list = await screen.findByRole('region', { name: `${GLOSS_WORDS.lostTitle} (1)` });
    expect(within(list).getByRole('button', { name: 'Da rivedere' })).toBeInTheDocument();
  });

  it('with no entry (a row only on the table, the Corpus) nothing is asked', async () => {
    const { container } = lettura(undefined);
    await new Promise((r) => setTimeout(r, 0));
    expect(assistantService.listProposals).not.toHaveBeenCalled();
    expect(container.querySelector('[data-highlight="p1"]')).toBeNull();
  });
});

describe('ArticleTabContent in a dossier\'s «Lettura»: «Note della pratica» (§14)', () => {
  it('the dossier\'s notes about the article stand under it, with that title; a free note does not', () => {
    lettura('a1');
    const notes = screen.getByRole('region', { name: 'Note della pratica' });
    expect(within(notes).getByText('Da citare nel ricorso, punto 2.')).toBeInTheDocument();
    expect(within(notes).queryByText('Una nota libera della pratica.')).toBeNull();
  });

  it('none outside a dossier\'s «Lettura»', () => {
    render(<MemoryRouter><ArticleTabContent data={data} /></MemoryRouter>);
    expect(screen.queryByRole('region', { name: 'Note della pratica' })).toBeNull();
    expect(screen.queryByText('Da citare nel ricorso, punto 2.')).toBeNull();
  });
});

describe('ArticleTabContent: one command to add to a practice (LC61)', () => {
  const bar = () => screen.queryAllByRole('button', { name: /Aggiungi a questa pratica|Alla pratica/ });

  it('an article already in the hosting dossier offers no «Aggiungi a questa pratica» in the bar', () => {
    lettura('a1');
    expect(bar()).toHaveLength(0);
  });

  it('one not in it does', () => {
    appStore.setState({ dossiers: [{ id: 'dos-1', title: 'Ricorso Rossi', createdAt: '', items: [] }] });
    lettura(undefined);
    expect(bar().length).toBeGreaterThan(0);
  });

  it('in a row that has its own add (the Ricerca), the bar has none; read alone, it keeps «Alla pratica»', () => {
    const { unmount } = render(<MemoryRouter><ArticleTabContent data={data} dossierCommandInRow /></MemoryRouter>);
    expect(bar()).toHaveLength(0);
    unmount();
    render(<MemoryRouter><ArticleTabContent data={data} /></MemoryRouter>);
    expect(bar().length).toBeGreaterThan(0);
  });
});
