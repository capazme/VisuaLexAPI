import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  desktop: true,
  trees: [] as Array<Record<string, unknown>>,
  legalFetch: vi.fn(),
}));
vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => h.desktop, isDesktopViewport: () => h.desktop }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }),
}));
vi.mock('../../../services/legalFetch', () => ({ legalFetch: h.legalFetch }));
vi.mock('../../../utils/actStructureCache', () => ({
  fetchActTree: () => Promise.resolve([]),
  fetchActRubriche: () => Promise.resolve({}),
}));
vi.mock('../search/ArticleTabContent', () => ({
  ArticleTabContent: ({ data }: { data: { article_text?: string; error?: string } }) => (
    <div data-testid="reader">{data.article_text ?? data.error ?? ''}</div>
  ),
}));
vi.mock('../search/TreeViewPanel', () => ({
  TreeViewPanel: (props: Record<string, unknown>) => {
    h.trees.push(props);
    return null;
  },
}));
vi.mock('../workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../decisions/DecisionEntryView', () => ({ DecisionEntryView: () => <div data-testid="decision-reader" /> }));
vi.mock('../decisions/DecisionSearchTabView', () => ({ DecisionSearchTabView: () => <div data-testid="topic-list" /> }));

import { appStore } from '../../../store/useAppStore';
import { clearArticleCache } from '../../../utils/articleFetchCache';
import { L24, L241, article } from '../../../utils/__fixtures__/savedWorkspaces';
import { articleRowKey, besideRefFor, practiceArticleKey } from '../../../utils/practice';
import type { ArticleData, Dossier } from '../../../types';
import { PracticeTable } from './PracticeTable';
import { ReadingRow } from './ReadingRow';
import { PracticePhoneView } from './PracticePhoneView';
import { ReadingFullScreen } from './ReadingFullScreen';

/** LC52 c2: the reading containers take the practice they show; a bound table's state stays its own. */

const s = () => appStore.getState();
const handlers = { onViewPdf: vi.fn(), onCrossReference: vi.fn(), streaming: null };
const CORPUS_ACT = 'l. 7 agosto 1990, n. 241';
const BOUND_ACT = 'l. 8 marzo 2017, n. 24';
const DOSSIER: Dossier = {
  id: 'dos-1', title: 'Legata al dossier', createdAt: '',
  items: [
    { id: 'n5', addedAt: '', type: 'norma', data: { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08', numero_articolo: '5' } },
    { id: 'n7', addedAt: '', type: 'norma', data: { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08', numero_articolo: '7' } },
  ],
};

let corpus: string;
let bound: string;

/** The bound table's act and the key of its row `numero`. */
function boundRow(numero: string) {
  const act = s().practices.find((p) => p.id === bound)!.acts[0];
  const row = act.articles.find((a) => a.norma_data.numero_articolo === numero)!;
  return { actId: act.id, articleKey: practiceArticleKey(row), row };
}
/** Gives a bound row its text, as a load would. */
function giveText(numero: string) {
  const { actId, articleKey, row } = boundRow(numero);
  s().setPracticeArticleText(bound, actId, articleKey, { ...row, article_text: `Testo legato ${numero}` });
}
const answer = (text: string) => ({
  ok: true, status: 200, json: async () => [{ article_text: text, norma_data: { tipo_atto: 'legge', numero_articolo: '5' } }],
});

beforeEach(() => {
  h.desktop = true;
  h.trees.length = 0;
  h.legalFetch.mockReset();
  clearArticleCache();
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null,
    practiceNotice: null, readingBackStack: [], phoneReader: null, windowFocusRequest: null,
    structureWindow: { blockId: null, position: { x: 0, y: 0 } },
  });
  corpus = s().createPractice('Del Corpus');
  s().addArticlesToPractice(corpus, L241, [article(L241, '2'), article(L241, '3')]);
  bound = s().openDossierPractice(DOSSIER);
  s().setActivePractice(corpus);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the containers take their practice (LC52 c2)', () => {
  it('PracticeTable shows the practice it is given, rows and all, not the active one; without one, the active', () => {
    const first = render(<PracticeTable {...handlers} layout="overview" practiceId={bound} />);
    // A bound table draws no practice header (LC54 c3: the dossier's page names it).
    expect(screen.queryByRole('heading', { level: 2, name: 'Legata al dossier' })).toBeNull();
    expect(screen.getByRole('region', { name: BOUND_ACT })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: CORPUS_ACT })).toBeNull();
    first.unmount();
    render(<PracticeTable {...handlers} layout="overview" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Del Corpus');
    expect(screen.getByRole('region', { name: CORPUS_ACT })).toBeInTheDocument();
  });

  it('PracticeTable draws nothing for a practice that is not open', () => {
    const { container } = render(<PracticeTable {...handlers} layout="overview" practiceId="gone" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('ReadingRow draws the given practice\'s table and its windows, not the active one\'s', () => {
    giveText('5');
    const { actId, articleKey } = boundRow('5');
    s().openBeside(bound, besideRefFor({ kind: 'article', actId, articleKey }));
    const corpusAct = s().practices.find((p) => p.id === corpus)!.acts[0];
    s().openBeside(corpus, besideRefFor({ kind: 'article', actId: corpusAct.id, articleKey: practiceArticleKey(corpusAct.articles[0]) }));
    render(<ReadingRow {...handlers} practiceId={bound} />);
    const windows = screen.getAllByTestId('reading-row-window');
    expect(windows).toHaveLength(1);
    expect(windows[0]).toHaveTextContent('Testo legato 5');
    expect(screen.getByTestId('reading-row-table')).toHaveTextContent(BOUND_ACT);
    expect(screen.getByTestId('reading-row-table')).not.toHaveTextContent(CORPUS_ACT);
  });

  it('PracticePhoneView shows the given practice\'s column, also when it is the only one and not active', () => {
    h.desktop = false;
    s().closePractice(corpus);
    render(<PracticePhoneView {...handlers} practiceId={bound} />);
    expect(screen.getByRole('region', { name: BOUND_ACT })).toBeInTheDocument();
  });

  it('PracticePhoneView with a practice keeps to it while the active one is another', () => {
    h.desktop = false;
    render(<PracticePhoneView {...handlers} practiceId={bound} />);
    expect(screen.getByRole('region', { name: BOUND_ACT })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: CORPUS_ACT })).toBeNull();
  });

  it('PracticePhoneView draws nothing for a practice that is not open', () => {
    h.desktop = false;
    const { container } = render(<PracticePhoneView {...handlers} practiceId="gone" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('ReadingFullScreen shows the reader of the practice it is given only', () => {
    h.desktop = false;
    giveText('5');
    const { actId, articleKey } = boundRow('5');
    s().openPhoneReader(bound, besideRefFor({ kind: 'article', actId, articleKey }));
    const other = render(<ReadingFullScreen onCrossReference={vi.fn()} practiceId={corpus} />);
    expect(other.container).toBeEmptyDOMElement();
    other.unmount();
    render(<ReadingFullScreen onCrossReference={vi.fn()} practiceId={bound} />);
    expect(screen.getByTestId('reading-full-screen')).toHaveTextContent('Testo legato 5');
  });

  it('the bound table\'s phone reader is drawn by its own view, not by the Corpus\'s', () => {
    h.desktop = false;
    giveText('5');
    const { actId, articleKey } = boundRow('5');
    s().openPhoneReader(bound, besideRefFor({ kind: 'article', actId, articleKey }));
    const corpusView = render(<PracticePhoneView {...handlers} />);
    expect(screen.queryByTestId('reading-full-screen')).toBeNull();
    expect(screen.getByRole('region', { name: CORPUS_ACT })).toBeInTheDocument();
    corpusView.unmount();
    render(<PracticePhoneView {...handlers} practiceId={bound} />);
    expect(screen.getByTestId('reading-full-screen')).toHaveTextContent('Testo legato 5');
  });
});

describe('a row without its text loads it when it opens (LC52 c2)', () => {
  it('a bound row opened asks for its text once and puts it in the row', async () => {
    h.desktop = false;
    h.legalFetch.mockResolvedValue(answer('Testo caricato'));
    const { actId, articleKey } = boundRow('5');
    const view = render(<PracticePhoneView {...handlers} practiceId={bound} />);
    expect(h.legalFetch).not.toHaveBeenCalled();
    act(() => s().setRowOpen(articleRowKey(bound, actId, articleKey), true));
    await waitFor(() => expect(boundRow('5').row.article_text).toBe('Testo caricato'));
    expect(h.legalFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(h.legalFetch.mock.calls[0][1].body)).toMatchObject({ act_type: 'legge', act_number: '24', article: '5' });
    view.rerender(<PracticePhoneView {...handlers} practiceId={bound} />);
    await act(async () => {});
    expect(h.legalFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Testo caricato')).toBeInTheDocument();
  });

  it('a row read in a window loads its text as well', async () => {
    h.legalFetch.mockResolvedValue(answer('Testo nella finestra'));
    const { actId, articleKey } = boundRow('7');
    s().openBeside(bound, besideRefFor({ kind: 'article', actId, articleKey }));
    render(<ReadingRow {...handlers} practiceId={bound} />);
    await waitFor(() => expect(boundRow('7').row.article_text).toBe('Testo nella finestra'));
    expect(h.legalFetch).toHaveBeenCalledTimes(1);
  });

  it('a failed load is asked once and leaves its error on the row', async () => {
    h.desktop = false;
    h.legalFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const { actId, articleKey } = boundRow('5');
    act(() => s().setRowOpen(articleRowKey(bound, actId, articleKey), true));
    const view = render(<PracticePhoneView {...handlers} practiceId={bound} />);
    await waitFor(() => expect(boundRow('5').row.error).toBeTruthy());
    view.rerender(<PracticePhoneView {...handlers} practiceId={bound} />);
    await act(async () => {});
    expect(h.legalFetch).toHaveBeenCalledTimes(1);
  });

  it('a row that has its text asks nothing', async () => {
    h.desktop = false;
    giveText('5');
    const { actId, articleKey } = boundRow('5');
    act(() => s().setRowOpen(articleRowKey(bound, actId, articleKey), true));
    render(<PracticePhoneView {...handlers} practiceId={bound} />);
    await act(async () => {});
    expect(h.legalFetch).not.toHaveBeenCalled();
  });

  it('a Corpus row without text asks nothing (the Corpus as today)', async () => {
    h.desktop = false;
    const bare: ArticleData = { norma_data: article(L24, '9').norma_data };
    const { actId } = s().addArticlesToPractice(corpus, L24, [bare]);
    const key = practiceArticleKey(bare);
    act(() => s().setRowOpen(articleRowKey(corpus, actId, key), true));
    render(<PracticePhoneView {...handlers} />);
    await act(async () => {});
    expect(h.legalFetch).not.toHaveBeenCalled();
  });
});

describe('the reading state is the practice\'s own (LC52 c2, #526 open points)', () => {
  const boundReader = () => {
    giveText('5');
    const { actId, articleKey } = boundRow('5');
    s().openPhoneReader(bound, besideRefFor({ kind: 'article', actId, articleKey }));
  };

  it('the bound table\'s phone reader stays when a Corpus practice comes on screen or reveals a row', () => {
    h.desktop = false;
    boundReader();
    const other = s().createPractice('Altra');
    s().setActivePractice(other);
    expect(s().phoneReader?.practiceId).toBe(bound);
    const corpusAct = s().practices.find((p) => p.id === corpus)!.acts[0];
    s().revealPracticeRow(corpus, corpusAct.id, practiceArticleKey(corpusAct.articles[0]));
    expect(s().phoneReader?.practiceId).toBe(bound);
    s().addActIndexToPractice(corpus, L24);
    expect(s().phoneReader?.practiceId).toBe(bound);
  });

  it('the Corpus\'s phone reader stays when the bound table reveals a row or opens an act\'s index', () => {
    h.desktop = false;
    const corpusAct = s().practices.find((p) => p.id === corpus)!.acts[0];
    s().openPhoneReader(corpus, besideRefFor({ kind: 'article', actId: corpusAct.id, articleKey: practiceArticleKey(corpusAct.articles[0]) }));
    const { actId, articleKey } = boundRow('7');
    s().revealPracticeRow(bound, actId, articleKey);
    expect(s().phoneReader?.practiceId).toBe(corpus);
    s().addActIndexToPractice(bound, L241);
    expect(s().phoneReader?.practiceId).toBe(corpus);
  });

  it('a Corpus practice\'s reader still gives way to another Corpus practice (as today)', () => {
    h.desktop = false;
    const corpusAct = s().practices.find((p) => p.id === corpus)!.acts[0];
    s().openPhoneReader(corpus, besideRefFor({ kind: 'article', actId: corpusAct.id, articleKey: practiceArticleKey(corpusAct.articles[0]) }));
    s().setActivePractice(s().createPractice('Altra'));
    expect(s().phoneReader).toBeNull();
  });

  it('a row the bound table reveals is not taken by the Corpus\'s view, and is by its own', () => {
    h.desktop = false;
    const { actId, articleKey } = boundRow('7');
    s().revealPracticeRow(bound, actId, articleKey);
    expect(s().pendingReveal?.practiceId).toBe(bound);
    const corpusView = render(<PracticePhoneView {...handlers} />);
    expect(s().pendingReveal?.practiceId).toBe(bound);
    corpusView.unmount();
    render(<PracticePhoneView {...handlers} practiceId={bound} />);
    expect(s().pendingReveal).toBeNull();
  });

  it('the Corpus\'s view gives its scroll back when its reader closes, whatever the bound table has to reveal', () => {
    h.desktop = false;
    const corpusAct = s().practices.find((p) => p.id === corpus)!.acts[0];
    let top = 0;
    render(<div data-testid="scroller" style={{ overflowY: 'auto' }}><PracticePhoneView {...handlers} /></div>);
    const scroller = screen.getByTestId('scroller');
    Object.defineProperty(scroller, 'scrollTop', { get: () => top, set: (v: number) => { top = v; }, configurable: true });
    top = 420;
    fireEvent.scroll(scroller);
    act(() => { s().openPhoneReader(corpus, besideRefFor({ kind: 'article', actId: corpusAct.id, articleKey: practiceArticleKey(corpusAct.articles[0]) })); });
    top = 0;
    const { actId, articleKey } = boundRow('7');
    act(() => { s().revealPracticeRow(bound, actId, articleKey); s().closePhoneReader(); });
    expect(s().pendingReveal?.practiceId).toBe(bound);
    expect(top).toBe(420);
  });

  it('a window of the bound table asked to take focus is not taken by the Corpus\'s windows', () => {
    giveText('5');
    const { actId, articleKey } = boundRow('5');
    const ref = besideRefFor({ kind: 'article', actId, articleKey });
    s().openBeside(bound, ref);
    s().openBeside(bound, ref);
    expect(s().windowFocusRequest).toBe(ref.id);
    const corpusAct = s().practices.find((p) => p.id === corpus)!.acts[0];
    s().openBeside(corpus, besideRefFor({ kind: 'article', actId: corpusAct.id, articleKey: practiceArticleKey(corpusAct.articles[0]) }));
    render(<ReadingRow {...handlers} />);
    expect(s().windowFocusRequest).toBe(ref.id);
  });

  it('the structure window of a bound act is not drawn in the Corpus\'s table', () => {
    s().openStructureWindow(boundRow('5').actId);
    render(<PracticeTable {...handlers} layout="overview" />);
    expect(h.trees.length).toBeGreaterThan(0);
    expect(h.trees.every((props) => props.isOpen === false)).toBe(true);
  });
});
