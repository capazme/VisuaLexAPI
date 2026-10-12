import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const env = vi.hoisted(() => ({
  lines: [] as unknown[],
  requests: [] as Array<Record<string, unknown>>,
  /** The article a reader's citation link names. */
  jumpTo: '',
  /** What a decision window's citation link searches. */
  citation: null as null | Record<string, unknown>,
  stream: null as null | ((params: Record<string, unknown>) => unknown[]),
  tree: null as unknown,
  annex: { MAX_MAIN_ARTICLES: 50, MIN_ANNEX_ARTICLES: 10, TOAST_DURATION: 3000, ENABLED: false, AUTO_CONFIRM: true },
}));
vi.mock('../../../config/annexConfig', () => ({ ANNEX_AUTO_SWITCH_CONFIG: env.annex }));

vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => true, isDesktopViewport: () => true }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('../workspace/WorkspaceManager', () => ({ WorkspaceManager: () => <div data-testid="old-workspace" /> }));
vi.mock('../workspace/WorkspaceNavigator', () => ({ WorkspaceNavigator: () => <div data-testid="old-dock" /> }));
vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('./QuickNormsManager', () => ({ QuickNormsManager: () => null }));
vi.mock('../settings/AliasManager', () => ({ AliasManager: () => null }));
vi.mock('./NormaCard', () => ({ NormaCard: () => null }));
vi.mock('./ArticleTabContent', () => ({
  ArticleTabContent: ({ data, variant = 'row', onCrossReferenceNavigate }: {
    data: { norma_data: { numero_articolo: string } };
    variant?: string;
    onCrossReferenceNavigate?: (article: string, normaData: unknown) => void;
  }) => (
    <>
      <div data-testid="reader" data-variant={variant}>art. {data.norma_data.numero_articolo}</div>
      <button type="button" onClick={() => onCrossReferenceNavigate?.(env.jumpTo, data.norma_data)}>
        Citazione in art. {data.norma_data.numero_articolo} ({variant})
      </button>
    </>
  ),
}));
vi.mock('./TreeViewPanel', () => ({ TreeViewPanel: () => null }));
vi.mock('../workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../../../utils/actStructureCache', () => ({
  fetchActTree: () => Promise.resolve([]),
  fetchActRubriche: () => Promise.resolve({}),
}));
// A decision's reading place: its citation link searches a norm beside it, as `DecisionReadingSurface` does.
vi.mock('../decisions/DecisionEntryView', async () => {
  const { appStore: store } = await import('../../../store/useAppStore');
  return {
    DecisionEntryView: ({ reference, hostId }: { reference: { numero: number }; hostId: string }) => (
      <div data-testid="decision-reader">
        n. {reference.numero}
        <button type="button" onClick={() => store.getState().triggerSearch({
          ...(env.citation ?? { act_type: 'codice civile', act_number: '', date: '', article: '2043', version: 'vigente', show_brocardi_info: false }),
          besideTabId: hostId,
        } as never)}>
          Cita l'art. 2043 c.c.
        </button>
      </div>
    ),
  };
});
vi.mock('../decisions/DecisionSearchTabView', () => ({ DecisionSearchTabView: () => <div data-testid="topic-list" /> }));
vi.mock('../../../services/historyService', () => ({ addToHistory: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../services/legalFetch', () => ({
  legalFetch: async (path: string, init?: RequestInit) => {
    if (path === '/fetch_tree') return env.tree ? new Response(JSON.stringify(env.tree)) : new Response('', { status: 500 });
    const params = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    env.requests.push(params);
    const lines = env.stream ? env.stream(params) : env.lines;
    return new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  },
}));

import { appStore } from '../../../store/useAppStore';
import { SearchPanel } from './SearchPanel';
import { L24, article } from '../../../utils/__fixtures__/savedWorkspaces';
import { articleWindowId, decisionWindowId, practiceArticleKey } from '../../../utils/practice';

const s = () => appStore.getState();
const CC = { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', url: 'urn:nir:stato:regio.decreto:1942-03-16;262' };
const ccArticle = (n: string) => ({ article_text: `Art. ${n}\nTesto ${n}.`, norma_data: { ...CC, numero_articolo: n }, brocardi_info: null });
const REF = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 99999, anno: 2024 };
const panel = () => render(<MemoryRouter><SearchPanel /></MemoryRouter>);
const windowLabels = () => screen.queryAllByTestId('reading-window').map((w) => w.getAttribute('data-window-id'));

beforeEach(() => {
  vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
  window.innerWidth = 1500;
  env.lines = [];
  env.requests = [];
  env.jumpTo = '';
  env.citation = null;
  env.stream = null;
  env.tree = null;
  env.annex.ENABLED = false;
  appStore.setState({
    practices: [], activePracticeId: null, practicesSeeded: true, practiceRows: {}, pendingReveal: null,
    practiceNotice: null, workspaceTabs: [], searchTrigger: null, searchQueue: [], pendingDecision: null,
    readingBackStack: [], commandPaletteOpen: false, structureWindow: { blockId: null, position: { x: 0, y: 0 } },
    mobileActiveTabId: null, windowFocusRequest: null,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('SearchPanel with the windows beside (spec §4.5)', () => {
  it('mounts the row: the practice\'s windows are drawn beside the table', async () => {
    const { practiceId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    const { decisionId } = s().openDecision(REF, { practiceId });
    panel();
    expect(await screen.findByTestId('reading-row')).toBeInTheDocument();
    expect(windowLabels()).toEqual([decisionWindowId(decisionId)]);
    expect(screen.getByTestId('practice-column')).toBeInTheDocument();
  });

  it('a norm cited in a decision window enters its act and opens beside the decision, which stays', async () => {
    env.lines = [ccArticle('2043')];
    const p = s().createPractice('P');
    const { decisionId } = s().openDecision(REF, { practiceId: p });
    panel();
    fireEvent.click(await screen.findByRole('button', { name: "Cita l'art. 2043 c.c." }));
    await waitFor(() => expect(s().practices[0].acts).toHaveLength(1));
    const practice = s().practices[0];
    const articleKey = practiceArticleKey(practice.acts[0].articles[0]);
    await waitFor(() => expect(s().practices[0].beside.map((b) => b.id)).toEqual([
      decisionWindowId(decisionId), articleWindowId(practice.acts[0].id, articleKey),
    ]));
    // The search carried the window as its asker; the row did not open in the table.
    expect(env.requests[0]).toMatchObject({ besideTabId: decisionWindowId(decisionId) });
    expect(Object.values(s().practiceRows).some(Boolean)).toBe(false);
    expect(s().pendingReveal).toBeNull();
    await waitFor(() => expect(screen.getAllByTestId('reader').map((r) => r.getAttribute('data-variant'))).toEqual(['beside']));
  });

  it('with two windows open, the cited norm replaces the oldest OTHER window: the asker, the oldest, stays', async () => {
    env.lines = [ccArticle('2043')];
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    const five = practiceArticleKey(article(L24, '5'));
    const { decisionId } = s().openDecision(REF, { practiceId, beside: false });
    // The decision window is the asker and the oldest; art. 5's window came after it.
    s().openBeside(practiceId, { id: decisionWindowId(decisionId), kind: 'decision', decisionId });
    s().openBeside(practiceId, { id: articleWindowId(actId, five), kind: 'article', actId, articleKey: five });
    panel();
    fireEvent.click(await screen.findByRole('button', { name: "Cita l'art. 2043 c.c." }));
    await waitFor(() => expect(s().practices[0].acts).toHaveLength(2));
    const cited = s().practices[0].acts.find((a) => a.id !== actId);
    if (!cited) throw new Error('the cited act did not land');
    await waitFor(() => expect(s().practices[0].beside.map((b) => b.id)).toEqual([
      decisionWindowId(decisionId), articleWindowId(cited.id, practiceArticleKey(cited.articles[0])),
    ]));
  });

  it('a norm cited from an article window that the act already holds opens beside it, replacing the other window, nothing searched', async () => {
    env.jumpTo = '7';
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5'), article(L24, '7')]);
    const five = practiceArticleKey(article(L24, '5'));
    const { decisionId } = s().openDecision(REF, { practiceId, beside: false });
    // Art. 5's window is the asker and the oldest; the decision's window came after it.
    s().openBeside(practiceId, { id: articleWindowId(actId, five), kind: 'article', actId, articleKey: five });
    s().openBeside(practiceId, { id: decisionWindowId(decisionId), kind: 'decision', decisionId });
    panel();
    fireEvent.click(await screen.findByRole('button', { name: 'Citazione in art. 5 (beside)' }));
    const seven = practiceArticleKey(article(L24, '7'));
    await waitFor(() => expect(s().practices[0].beside.map((b) => b.id)).toEqual([
      articleWindowId(actId, five), articleWindowId(actId, seven),
    ]));
    expect(env.requests).toEqual([]);
  });

  it('a citation that switches annex still opens its article beside the window, and the main text\'s stray row goes with its window', async () => {
    const DLGS = { tipo_atto: 'decreto legislativo', data: '2008-04-09', numero_atto: '81', url: 'urn:nir:stato:decreto.legislativo:2008-04-09;81' };
    const dlgs = (n: string, allegato?: string) => ({
      article_text: `Art. ${n}\nTesto ${n}.`, norma_data: { ...DLGS, numero_articolo: n, ...(allegato ? { allegato } : {}) }, brocardi_info: null,
    });
    env.annex.ENABLED = true;
    env.tree = { metadata: { annexes: [
      { number: null, label: 'Testo', article_count: 3, article_numbers: ['1', '2', '3'] },
      { number: '2', label: 'Allegato 2', article_count: 20, article_numbers: ['5', '6'] },
    ] } };
    env.citation = { act_type: 'decreto legislativo', act_number: '81', date: '2008', article: '5', version: 'vigente', show_brocardi_info: false };
    env.stream = (params) => (params.annex === '2' ? [dlgs('5', '2')] : [dlgs('5')]);
    const p = s().createPractice('P');
    const { decisionId } = s().openDecision(REF, { practiceId: p });
    panel();
    fireEvent.click(await screen.findByRole('button', { name: "Cita l'art. 2043 c.c." }));
    await waitFor(() => expect(env.requests.some((r) => r.annex === '2')).toBe(true));
    // The annex search carries the window that asked.
    expect(env.requests.find((r) => r.annex === '2')).toMatchObject({ besideTabId: decisionWindowId(decisionId) });
    await waitFor(() => {
      const practice = s().practices[0];
      const articles = practice.acts.flatMap((a) => a.articles.map((x) => `${x.norma_data.allegato ?? ''}:${x.norma_data.numero_articolo}`));
      expect(articles).toEqual(['2:5']);
    });
    const practice = s().practices[0];
    const act = practice.acts[0];
    await waitFor(() => expect(s().practices[0].beside.map((b) => b.id)).toEqual([
      decisionWindowId(decisionId), articleWindowId(act.id, practiceArticleKey(act.articles[0])),
    ]));
  });

  it('a norm cited from a row of the table is revealed in the table, as before', async () => {
    env.jumpTo = '7';
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5'), article(L24, '7')], { reveal: 'first' });
    panel();
    fireEvent.click(await screen.findByRole('button', { name: 'Citazione in art. 5 (row)' }));
    expect(s().practices[0].beside).toEqual([]);
    expect(s().practiceRows[`${practiceId}/${actId}/${practiceArticleKey(article(L24, '7'))}`]).toBe(true);
  });

  it('the way back floats above the bar of practices, not at the top over the act heading', async () => {
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    s().pushReadingBack({ tabId: practiceId, blockId: actId, articleId: '5', label: 'art. 5 l. 24/2017' });
    panel();
    const wrapper = (await screen.findByRole('button', { name: 'Torna a art. 5 l. 24/2017' })).parentElement as HTMLElement;
    expect(wrapper).not.toHaveClass('top-4');
    // No bar measured yet in jsdom: the least offset; with the bar, its height + 24 + 12.
    expect(wrapper.style.bottom).toMatch(/px$/);
  });

  it('a decision asked for twice (the palette, then the address) is one window, and the second ask takes focus', async () => {
    s().createPractice('P');
    panel();
    act(() => { s().openDecisionTab(REF); });
    await screen.findByTestId('decision-reader');
    act(() => { s().requestOpenDecision(REF); });
    await waitFor(() => expect(s().pendingDecision).toBeNull());
    expect(windowLabels()).toHaveLength(1);
    await waitFor(() => expect(within(screen.getByTestId('reading-window')).getByTestId('decision-reader')).toBeInTheDocument());
    await waitFor(() => expect(s().windowFocusRequest).toBeNull());
    expect(screen.getByTestId('reading-window')).toHaveFocus();
  });
});
