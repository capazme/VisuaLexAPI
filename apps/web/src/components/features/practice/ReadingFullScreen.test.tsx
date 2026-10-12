import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArticleData } from '../../../types';
import type { FetchDecisionAnswer } from '../../../types/decisions';

const { fetchDecision } = vi.hoisted(() => ({ fetchDecision: vi.fn() }));

vi.mock('../../../services/articleDiscussionService', () => ({
  articleDiscussionService: {
    list: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 } }),
    listPassages: vi.fn().mockResolvedValue([]),
    create: vi.fn(), comment: vi.fn(), report: vi.fn(), voteThread: vi.fn(), voteComment: vi.fn(), setPassageReleased: vi.fn(),
  },
}));
vi.mock('../../../services/studiaService', () => ({ studiaService: { forArticle: () => Promise.resolve([]) } }));
vi.mock('../../../services/authService', () => ({ isAuthenticated: () => true }));
vi.mock('../../../services/notificationService', () => ({ notificationService: { checkNorma: vi.fn().mockResolvedValue({ changed: false }) } }));
vi.mock('../../../services/decisionService', () => ({ fetchDecision: (...a: unknown[]) => fetchDecision(...a) }));
vi.mock('../../../services/historyService', () => ({ addDecisionToHistory: vi.fn().mockResolvedValue({}) }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('../../../features/merlt/useMerltFeatures', () => ({
  useMerltFeatures: () => ({ canContribute: false, qaAskable: false, consentLevel: 'none', merltEnabled: false }),
}));
vi.mock('../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
vi.mock('../search/BrocardiDisplay', () => ({ BrocardiDisplay: () => null }));
vi.mock('../dossier/AddToDossierPopover', () => ({ AddToDossierPopover: () => null }));
vi.mock('../decisions/DecisionResultList', () => ({
  DecisionResultList: ({ besideTabId }: { besideTabId?: string }) => <div data-testid="topic-list" data-beside={besideTabId} />,
}));

import { appStore } from '../../../store/useAppStore';
import { findRootsFor } from '../../../utils/findTargets';
import { FakeHighlight } from '../../../utils/__fixtures__/openFind';
import { FOUND, L24, article } from '../../../utils/__fixtures__/savedWorkspaces';
import { besideRefFor, practiceArticleKey, type BesideRef } from '../../../utils/practice';
import { ReadingFullScreen } from './ReadingFullScreen';

const s = () => appStore.getState();
const g = globalThis as unknown as Record<string, unknown>;
let registry: Map<string, FakeHighlight>;
let savedMatchMedia: typeof window.matchMedia;

// With a URN, so the Studia row would be offered in the row variant: the window must not draw it.
const A5_BASE = article(L24, '5');
const A5: ArticleData = {
  ...A5_BASE,
  norma_data: { ...A5_BASE.norma_data, urn: 'urn:nir:stato:legge:2017-03-08;24~art5' },
  article_text: 'Art. 5\n\nIl risarcimento del danno ingiusto è dovuto a chi lo subisce.',
};
const FOUND_ANSWER: FetchDecisionAnswer = {
  esito: 'trovata',
  identita: FOUND,
  attributi: { sezione: '3', tipo: 'sentenza', data_deposito: '2019-11-12' },
  testo: { motivazione: 'Il danno è stato provato in giudizio.' },
  fonte: { nome: 'Corte di cassazione' },
  avvisi: [],
};

/** A practice with art. 5 of l. 24/2017 and a decision, a window on each (the practice is active). */
function practiceWithTwoWindows() {
  const { practiceId, actId } = s().addArticlesToPractice(null, L24, [A5]);
  const { decisionId } = s().openDecision(FOUND, { practiceId, beside: false, open: false });
  const articleRef = besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(A5) });
  const decisionRef = besideRefFor({ kind: 'decision', decisionId });
  return { practiceId, actId, decisionId, articleRef, decisionRef };
}

const reader = () => screen.getByTestId('reading-full-screen');
const draw = (onCrossReference = vi.fn()) => render(
  <MemoryRouter>
    <ReadingFullScreen onCrossReference={onCrossReference} />
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  fetchDecision.mockResolvedValue(FOUND_ANSWER);
  vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
  appStore.setState({
    practices: [], activePracticeId: null, practicesSeeded: true, practiceRows: {}, pendingReveal: null,
    readingBackStack: [], workspaceTabs: [], highlights: [], annotations: [], bookmarks: [], phoneReader: null,
    loadAnnotationsForArticle: vi.fn(), loadHighlightsForArticle: vi.fn(),
  });
  registry = new Map();
  g.CSS = { highlights: registry };
  g.Highlight = FakeHighlight;
  savedMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  window.matchMedia = savedMatchMedia;
  delete g.CSS;
  delete g.Highlight;
  vi.unstubAllEnvs();
});

describe('ReadingFullScreen (spec §8, T19)', () => {
  it('draws nothing while the phone reads no subject', () => {
    practiceWithTwoWindows();
    draw();
    expect(screen.queryByTestId('reading-full-screen')).toBeNull();
  });

  it('an article: «‹ Pratica» (44 px) and the citation as title, the light reader in the body; «Pratica» clears the reader and leaves everything else', () => {
    const { practiceId, articleRef } = practiceWithTwoWindows();
    s().openPhoneReader(practiceId, articleRef);
    draw();
    expect(reader()).toHaveAccessibleName('art. 5, l. 8 marzo 2017, n. 24');
    expect(reader().querySelector('header h3')).toHaveTextContent('art. 5, l. 8 marzo 2017, n. 24');
    expect(within(reader()).getByText(/Il risarcimento del danno ingiusto/)).toBeInTheDocument();
    // the window's body: no Studio, no Studia row, the compact bar
    expect(within(reader()).queryByRole('button', { name: /Studio/ })).not.toBeInTheDocument();
    expect(within(reader()).queryByText(/Nuova scheda/)).not.toBeInTheDocument();
    expect(within(reader()).getByRole('button', { name: 'Giurisprudenza' })).toHaveAttribute('aria-expanded', 'false');
    // clear of the layout's menu button, a 44 px target
    const back = within(reader()).getByRole('button', { name: 'Pratica' });
    expect(back).toHaveClass('min-h-[44px]');
    expect(back.parentElement).toHaveClass('pl-[4.5rem]');

    fireEvent.click(back);
    expect(s().phoneReader).toBeNull();
    expect(screen.queryByTestId('reading-full-screen')).toBeNull();
    expect(s().practices[0].acts[0].articles).toHaveLength(1);
    expect(s().practices[0].beside).toEqual([]);
  });

  it('keeps root rule 23: the text root spells article_text, and registers under the practice for the find window', async () => {
    const { practiceId, articleRef } = practiceWithTwoWindows();
    s().openPhoneReader(practiceId, articleRef);
    draw();
    await waitFor(() => expect(findRootsFor(practiceId)).toHaveLength(1));
    const [root] = findRootsFor(practiceId);
    expect(reader().contains(root.element)).toBe(true);
    expect(root.element.textContent).toBe((A5.article_text ?? '').replace(/\n/g, ''));
    // not under the subject's own id: that is the way back's
    expect(findRootsFor(articleRef.id)).toHaveLength(0);
  });

  it('a decision reads on the entry view', async () => {
    const { practiceId, decisionRef } = practiceWithTwoWindows();
    s().openPhoneReader(practiceId, decisionRef);
    draw();
    await waitFor(() => expect(within(reader()).getByText(/Il danno è stato provato/)).toBeInTheDocument());
    expect(fetchDecision).toHaveBeenCalledTimes(1);
    expect(reader()).toHaveAccessibleName(/n\. 28994\/2019/);
    await waitFor(() => expect(findRootsFor(practiceId)).toHaveLength(1));
  });

  it('a topic search draws the list, its decisions opening in the reader (the list\'s place is the reader\'s subject)', () => {
    const { practiceId } = practiceWithTwoWindows();
    const ref: BesideRef = { id: 'topic:1', kind: 'decision-search', query: { tema: 'danno non patrimoniale' }, label: 'Danno' };
    s().openPhoneReader(practiceId, ref);
    draw();
    // the header says what it is; the view's own heading carries the topic, once
    expect(reader()).toHaveAccessibleName('Ricerca per tema');
    expect(within(reader()).getAllByText(/Tema: danno non patrimoniale/)).toHaveLength(1);
    expect(within(reader()).getByTestId('topic-list')).toHaveAttribute('data-beside', 'topic:1');
  });

  it('a subject the practice no longer holds says so, and «Pratica» still returns', () => {
    const { practiceId, articleRef } = practiceWithTwoWindows();
    s().openPhoneReader(practiceId, articleRef);
    draw();
    act(() => { s().removePracticeArticle(practiceId, articleRef.kind === 'article' ? articleRef.actId : '', articleRef.kind === 'article' ? articleRef.articleKey : ''); });
    expect(within(reader()).getByText('Questo testo non è più sul tavolo della pratica.')).toBeInTheDocument();
    fireEvent.click(within(reader()).getByRole('button', { name: 'Pratica' }));
    expect(s().phoneReader).toBeNull();
  });

  it('the body keeps clear of the back control and the services pill at the bottom, and scrolls itself', () => {
    const { practiceId, articleRef } = practiceWithTwoWindows();
    s().openPhoneReader(practiceId, articleRef);
    draw();
    expect(reader().querySelector('[data-reading-window-body]')).toHaveClass('overflow-y-auto', 'pb-28');
    // the page never scrolls: the reader is as tall as the content area
    expect(reader()).toHaveClass('h-app-row');
  });
});
