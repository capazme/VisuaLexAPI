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
import { FindWindow } from '../search/FindWindow';
import { closeFindWindow } from '../../../utils/findWindowControl';
import { findRootsFor } from '../../../utils/findTargets';
import { FakeHighlight } from '../../../utils/__fixtures__/openFind';
import { FOUND, L24, article } from '../../../utils/__fixtures__/savedWorkspaces';
import { besideRefFor, decisionWindowId, practiceArticleKey, type BesideRef } from '../../../utils/practice';
import { ReadingWindow } from './ReadingWindow';

const s = () => appStore.getState();
const g = globalThis as unknown as Record<string, unknown>;
let registry: Map<string, FakeHighlight>;
let savedMatchMedia: typeof window.matchMedia;

const A5: ArticleData = {
  ...article(L24, '5'),
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

const windowOf = (ref: BesideRef) => document.querySelector<HTMLElement>(`[data-window-id="${ref.id}"]`)!;
const titleOf = (ref: BesideRef) => windowOf(ref).querySelector('[data-reading-window-header] h3');
const draw = (practiceId: string, refs: BesideRef[], onCrossReference = vi.fn()) => render(
  <MemoryRouter>
    {refs.map((ref) => <ReadingWindow key={ref.id} practiceId={practiceId} besideRef={ref} onCrossReference={onCrossReference} />)}
    <FindWindow />
  </MemoryRouter>,
);
const drawn = (name: string) => registry.get(name)?.ranges ?? [];

beforeEach(() => {
  vi.clearAllMocks();
  fetchDecision.mockResolvedValue(FOUND_ANSWER);
  vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
  appStore.setState({
    practices: [], activePracticeId: null, practicesSeeded: true, practiceRows: {}, pendingReveal: null,
    readingBackStack: [], workspaceTabs: [], highlights: [], annotations: [], bookmarks: [],
    loadAnnotationsForArticle: vi.fn(), loadHighlightsForArticle: vi.fn(),
  });
  registry = new Map();
  g.CSS = { highlights: registry };
  g.Highlight = FakeHighlight;
  savedMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  act(() => closeFindWindow());
  window.matchMedia = savedMatchMedia;
  delete g.CSS;
  delete g.Highlight;
  vi.unstubAllEnvs();
});

describe('ReadingWindow (spec §4.1)', () => {
  it('an article window: the citation as title, the reader in its body, and «Chiudi» leaving the article on the table', () => {
    const { practiceId, articleRef } = practiceWithTwoWindows();
    s().openBeside(practiceId, articleRef);
    draw(practiceId, [articleRef]);
    const window_ = windowOf(articleRef);
    expect(titleOf(articleRef)).toHaveTextContent('art. 5, l. 8 marzo 2017, n. 24');
    expect(window_).toHaveAttribute('aria-label', 'art. 5, l. 8 marzo 2017, n. 24');
    expect(within(window_).getByText(/Il risarcimento del danno ingiusto/)).toBeInTheDocument();
    // The window shows no Studio: that lives on the act's heading in the table (D5).
    expect(within(window_).queryByRole('button', { name: /Studio/ })).not.toBeInTheDocument();

    expect(s().practices[0].beside).toHaveLength(1);
    fireEvent.click(within(window_).getByRole('button', { name: /^Chiudi la finestra/ }));
    expect(s().practices[0].beside).toEqual([]);
    expect(s().practices[0].acts[0].articles).toHaveLength(1);
  });

  it('a past text carries what it asks for in its title', () => {
    const past = article(L24, '5', { versione: 'originale' }, { article_text: 'Art. 5\n\nTesto originale.' });
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [past]);
    const ref = besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(past) });
    draw(practiceId, [ref]);
    expect(titleOf(ref)).toHaveTextContent('art. 5, l. 8 marzo 2017, n. 24 — testo originale');
  });

  it('a decision window reads the decision on the entry view, the window as its place', async () => {
    const { practiceId, decisionId, decisionRef } = practiceWithTwoWindows();
    expect(decisionRef.id).toBe(decisionWindowId(decisionId));
    draw(practiceId, [decisionRef]);
    const window_ = windowOf(decisionRef);
    await waitFor(() => expect(within(window_).getByText(/Il danno è stato provato/)).toBeInTheDocument());
    expect(fetchDecision).toHaveBeenCalledTimes(1);
    expect(titleOf(decisionRef)).toHaveTextContent(/n\. 28994\/2019/);
  });

  it('a topic window draws the search, its decisions opening beside the window', () => {
    const { practiceId } = practiceWithTwoWindows();
    const ref: BesideRef = { id: 'topic:1', kind: 'decision-search', query: { tema: 'danno non patrimoniale' }, label: 'Danno' };
    draw(practiceId, [ref]);
    const window_ = windowOf(ref);
    expect(titleOf(ref)).toHaveTextContent('Danno');
    expect(within(window_).getByRole('heading', { level: 4 })).toHaveTextContent('Tema: danno non patrimoniale');
    expect(within(window_).getByTestId('topic-list')).toHaveAttribute('data-beside', 'topic:1');
  });

  it('a subject the practice no longer holds says so, and can still be closed', () => {
    const { practiceId, actId } = practiceWithTwoWindows();
    const gone: BesideRef = { id: 'article:x', kind: 'article', actId, articleKey: 'nessuno|nessuno' };
    draw(practiceId, [gone]);
    expect(within(windowOf(gone)).getByText('Questo testo non è più sul tavolo della pratica.')).toBeInTheDocument();
    expect(within(windowOf(gone)).getByRole('button', { name: /^Chiudi la finestra/ })).toBeInTheDocument();
  });

  it('keeps the column\'s bottom padding, clear of the bar of practices (§3.4)', () => {
    const { practiceId, articleRef } = practiceWithTwoWindows();
    draw(practiceId, [articleRef]);
    expect(windowOf(articleRef).querySelector('[data-reading-window-body]')).toHaveClass(
      'overflow-y-auto', 'pb-[calc(var(--practice-bar-height,3.75rem)+2.25rem)]',
    );
  });
});

describe('ReadingWindow — what the find window sees (spec §6.6)', () => {
  it('registers the text roots of an article window and a decision window under the practice\'s id', async () => {
    const { practiceId, articleRef, decisionRef } = practiceWithTwoWindows();
    draw(practiceId, [articleRef, decisionRef]);
    await waitFor(() => expect(findRootsFor(practiceId)).toHaveLength(2));
    const roots = findRootsFor(practiceId);
    expect(roots.map((r) => windowOf(articleRef).contains(r.element) || windowOf(decisionRef).contains(r.element))).toEqual([true, true]);
    expect(roots.some((r) => windowOf(articleRef).contains(r.element))).toBe(true);
    expect(roots.some((r) => windowOf(decisionRef).contains(r.element))).toBe(true);
    // Not under the window's own id: that is the way back's and the focus's.
    expect(findRootsFor(articleRef.id)).toHaveLength(0);
    expect(findRootsFor(decisionRef.id)).toHaveLength(0);
  });

  it('«Questa pratica» draws the matches of both windows and counts nothing from the stored text', async () => {
    const { practiceId, articleRef, decisionRef } = practiceWithTwoWindows();
    draw(practiceId, [articleRef, decisionRef]);
    await waitFor(() => expect(findRootsFor(practiceId)).toHaveLength(2));

    fireEvent.click(within(windowOf(articleRef)).getAllByRole('button', { name: 'Cerca nel testo' })[0]);
    expect(s().activePracticeId).toBe(practiceId);
    expect(screen.getByRole('button', { name: 'Questa pratica' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Cerca nel testo' }), { target: { value: 'danno' } });

    // «danno» once in the article, once in the decision: the counter is the ranges drawn in the two roots.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^1 di 2$/));
    const ranges = [...drawn('vlx-find'), ...drawn('vlx-find-current')];
    expect(ranges).toHaveLength(2);
    expect(ranges.filter((r) => windowOf(articleRef).contains(r.commonAncestorContainer))).toHaveLength(1);
    expect(ranges.filter((r) => windowOf(decisionRef).contains(r.commonAncestorContainer))).toHaveLength(1);
  });

  it('the magnifier of a window is pressed while the window is open on that text, and closes it again', async () => {
    const { practiceId, articleRef } = practiceWithTwoWindows();
    draw(practiceId, [articleRef]);
    const magnifier = () => within(windowOf(articleRef)).getAllByRole('button', { name: 'Cerca nel testo' })[0];
    expect(magnifier()).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(magnifier());
    expect(magnifier()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.pointerDown(magnifier());
    fireEvent.click(magnifier());
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
  });
});
