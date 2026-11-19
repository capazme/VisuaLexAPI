import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  trees: [] as Array<Record<string, unknown>>,
  legalFetch: vi.fn(),
}));
vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => false, isDesktopViewport: () => false }));
vi.mock('../../../services/legalFetch', () => ({ legalFetch: h.legalFetch }));
vi.mock('../../../utils/actStructureCache', () => ({
  fetchActTree: () => Promise.resolve([]),
  fetchActRubriche: () => Promise.resolve({}),
}));
vi.mock('../search/ArticleTabContent', () => ({ ArticleTabContent: () => <div data-testid="reader" /> }));
vi.mock('../search/TreeViewPanel', () => ({
  TreeViewPanel: (props: Record<string, unknown>) => {
    h.trees.push(props);
    return null;
  },
}));
vi.mock('../workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../decisions/DecisionEntryView', () => ({
  DecisionEntryView: ({ reference, hostId }: { reference: { numero: number }; hostId: string }) => (
    <div data-testid="decision-reader" data-host={hostId}>n. {reference.numero}</div>
  ),
}));
// A topic search's list: one decision, opened as `DecisionLink` opens it (from the list's own place).
vi.mock('../decisions/DecisionSearchTabView', async () => {
  const { appStore: store } = await import('../../../store/useAppStore');
  return {
    DecisionSearchTabView: ({ tabId }: { tabId: string }) => (
      <button type="button" data-testid="topic-list" onClick={() => store.getState().openDecision(REF, { fromLink: true, besideId: tabId })}>
        Cass. civ., n. 12345/2020
      </button>
    ),
  };
});

import { appStore } from '../../../store/useAppStore';
import { PracticePhoneView } from './PracticePhoneView';
import { L24, L241, article } from '../../../utils/__fixtures__/savedWorkspaces';
import { besideRefFor, practiceArticleKey, searchTableLabel } from '../../../utils/practice';

const REF = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 12345, anno: 2020 };

const s = () => appStore.getState();
const view = () => <PracticePhoneView onViewPdf={vi.fn()} onCrossReference={vi.fn()} streaming={null} />;

beforeEach(() => {
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
  h.trees.length = 0;
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null,
    practiceNotice: null, readingBackStack: [], phoneReader: null, windowFocusRequest: null,
    structureWindow: { blockId: null },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('PracticePhoneView (spec §8, P3)', () => {
  it('no list of practices behind the head (LC60), and the column follows the active practice (R3: no carousel)', async () => {
    const first = s().createPractice('Prima');
    s().addArticlesToPractice(first, L24, [article(L24, '5')]);
    const second = s().createPractice('Seconda');
    s().addArticlesToPractice(second, L241, [article(L241, '2')]);
    s().setActivePractice(first);
    render(view());
    expect(screen.queryByRole('button', { name: 'Pratica precedente' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Pratica \d: / })).toBeNull();
    expect(screen.getByRole('region', { name: 'l. 8 marzo 2017, n. 24' })).toBeInTheDocument();

    expect(screen.queryByTitle('Elenco delle pratiche')).toBeNull();
    act(() => { s().setActivePractice(second); });
    expect(screen.queryByRole('region', { name: 'l. 8 marzo 2017, n. 24' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('region', { name: /241/ })).toBeInTheDocument());
  });

  it('one act: one head, the act\'s, with the table\'s name small over its title and one «⋯» holding both (LC68)', () => {
    const { practiceId } = s().addArticlesToPractice(null, L24, [article(L24, '5'), article(L24, '7')]);
    render(view());
    const head = screen.getByRole('region', { name: 'l. 8 marzo 2017, n. 24' }).querySelector('header')!;
    // One «⋯» in the head: the table has no head of its own.
    expect(within(head).getAllByRole('button', { name: /^(Azioni su|Altre azioni per) / })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Altre azioni per / })).toBeNull();
    const name = within(head).getByRole('heading', { level: 2 });
    expect(name).toHaveTextContent(searchTableLabel(new Date()));
    expect(name).toHaveClass('text-xs');
    fireEvent.click(within(head).getByRole('button', { name: 'Azioni su l. 8 marzo 2017, n. 24' }));
    expect(screen.getByRole('menuitem', { name: 'Modalità studio' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Aggiungi a una pratica…' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Chiudi il tavolo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rinomina' }));
    const field = screen.getByRole('textbox', { name: 'Nome del tavolo' });
    fireEvent.change(field, { target: { value: 'Danno medico' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(s().practices.find((p) => p.id === practiceId)?.label).toBe('Danno medico');
  });

  it('two acts: the table\'s head names it, with «⋯» and «Rinomina»; each act keeps its own head (LC68)', () => {
    const { practiceId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    s().addArticlesToPractice(practiceId, L241, [article(L241, '2')]);
    render(view());
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(searchTableLabel(new Date()));
    // No table entry is repeated in an act's «⋯».
    fireEvent.click(screen.getByRole('button', { name: 'Azioni su l. 8 marzo 2017, n. 24' }));
    expect(screen.queryByRole('menuitem', { name: 'Chiudi il tavolo' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Rinomina' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /^Altre azioni per / }));
    expect(screen.getByRole('menuitem', { name: 'Rinomina' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Chiudi il tavolo' })).toBeInTheDocument();
  });

  it('sits at the layout\'s edge, no step of its own, and writes a short name whole (R3b)', () => {
    s().createPractice('c.c.');
    const { container } = render(view());
    // The column and the head add no side padding: the text starts 16 px from the screen's edges.
    expect(container.querySelector('.space-y-4')!.className).not.toMatch(/\bpx-/);
    expect(screen.getByRole('heading', { level: 2 }).parentElement!.parentElement!.className).not.toMatch(/\bpx-/);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('c.c.');
  });

  it('the header\'s one control is «⋯», a 44 px target; no «Salva come dossier» (LC60)', () => {
    s().createPractice('Prima');
    render(view());
    expect(screen.queryByRole('button', { name: 'Salva come dossier' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Altre azioni per / })).toHaveClass('min-h-[44px]', 'min-w-[44px]');
  });
});


/** The page's content scroller, `Layout`'s: the view sits in it, and its scroll is what «‹ Pratica» gives back. */
function scrolled(ui: React.ReactElement) {
  let top = 0;
  let max = Infinity; // how far the page can scroll: a short page clamps a write, as a browser does
  const utils = render(<div data-testid="scroller" style={{ overflowY: 'auto' }}>{ui}</div>);
  const scroller = screen.getByTestId('scroller');
  Object.defineProperty(scroller, 'scrollTop', { get: () => top, set: (v: number) => { top = Math.min(v, max); }, configurable: true });
  const scrollTo = (v: number) => { top = Math.min(v, max); fireEvent.scroll(scroller); };
  const setMax = (v: number) => { max = v; top = Math.min(top, max); };
  return { ...utils, scroller, scrollTo, setMax, top: () => top };
}

/** A ResizeObserver the test drives: `grow()` tells every observer its element changed size. */
function fakeResizeObserver() {
  const callbacks = new Set<() => void>();
  class Fake {
    private readonly cb: () => void;
    constructor(cb: () => void) { this.cb = cb; }
    observe() { callbacks.add(this.cb); }
    unobserve() { callbacks.delete(this.cb); }
    disconnect() { callbacks.delete(this.cb); }
  }
  vi.stubGlobal('ResizeObserver', Fake);
  return { grow: () => act(() => { [...callbacks].forEach((cb) => cb()); }) };
}

/** One practice with art. 5 of l. 24/2017 and a read decision. */
function withArticleAndDecision() {
  const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
  const { decisionId } = s().openDecision(REF, { practiceId, open: false });
  const a = s().practices[0].acts[0].articles[0];
  return { practiceId, actId, decisionId, articleKey: practiceArticleKey(a) };
}

describe('PracticePhoneView: the full-screen reader and the practice list (spec §8, T19, P5)', () => {
  it('the table is the main screen, with «Giurisprudenza» at the bottom', () => {
    withArticleAndDecision();
    render(view());
    const column = screen.getByTestId('practice-column');
    expect(screen.getByRole('region', { name: 'l. 8 marzo 2017, n. 24' })).toBeInTheDocument();
    const decisions = screen.getByRole('heading', { name: 'Giurisprudenza (1)' });
    expect(column.lastElementChild).toContainElement(decisions);
    expect(screen.queryByTestId('reading-full-screen')).toBeNull();
  });

  it('«Apri accanto» shows the article full screen under «‹ Pratica» (44 px) and the column goes; «Pratica» returns to the table at the same scroll', () => {
    const { practiceId, articleKey, actId } = withArticleAndDecision();
    const { scrollTo, top } = scrolled(view());
    scrollTo(420);
    fireEvent.click(screen.getByRole('button', { name: /^Apri accanto art\. 5/ }));
    expect(s().phoneReader).toEqual({ practiceId, ref: besideRefFor({ kind: 'article', actId, articleKey }) });
    const reader = screen.getByTestId('reading-full-screen');
    expect(within(reader).getByTestId('reader')).toBeInTheDocument();
    // one reading surface, not a hidden twin under the reader (gotcha 26)
    expect(screen.queryByTestId('practice-column')).toBeNull();
    expect(screen.queryByTestId('practice-phone-view')).toBeNull();
    const back = within(reader).getByRole('button', { name: 'Pratica' });
    expect(back).toHaveClass('min-h-11');
    expect(reader).toHaveAccessibleName('art. 5, l. 8 marzo 2017, n. 24');
    // the desktop's windows are untouched
    expect(s().practices[0].beside).toEqual([]);

    scrollTo(0); // the column's unmounting clamps the scroller; the reader does not scroll it
    fireEvent.click(back);
    expect(s().phoneReader).toBeNull();
    expect(screen.getByTestId('practice-column')).toBeInTheDocument();
    expect(top()).toBe(420);
  });

  it('the place is asked for again while the remounted column grows, until it is reached', () => {
    const { practiceId, articleKey, actId } = withArticleAndDecision();
    const observer = fakeResizeObserver();
    const { scrollTo, setMax, top } = scrolled(view());
    scrollTo(407);
    act(() => { s().openPhoneReader(practiceId, besideRefFor({ kind: 'article', actId, articleKey })); });
    setMax(0); // the reader is short: the scroller is clamped
    scrollTo(0);
    setMax(120); // the column remounts short: its open rows' text has not arrived
    act(() => { s().closePhoneReader(); });
    expect(top()).toBe(120); // clamped, but still asked for
    setMax(300);
    observer.grow();
    expect(top()).toBe(300);
    setMax(2000); // the text arrives
    observer.grow();
    expect(top()).toBe(407);
    // reached: it stops asking
    scrollTo(50);
    setMax(3000);
    observer.grow();
    expect(top()).toBe(50);
  });

  it('a scroll of the user ends the asking', () => {
    const { practiceId, articleKey, actId } = withArticleAndDecision();
    const observer = fakeResizeObserver();
    const { scroller, scrollTo, setMax, top } = scrolled(view());
    scrollTo(407);
    act(() => { s().openPhoneReader(practiceId, besideRefFor({ kind: 'article', actId, articleKey })); });
    setMax(0);
    scrollTo(0);
    setMax(120);
    act(() => { s().closePhoneReader(); });
    fireEvent.wheel(scroller);
    scrollTo(10);
    setMax(2000);
    observer.grow();
    expect(top()).toBe(10);
  });

  it('the asking gives up after a few seconds', () => {
    vi.useFakeTimers();
    try {
      const { practiceId, articleKey, actId } = withArticleAndDecision();
      const observer = fakeResizeObserver();
      const { scrollTo, setMax, top } = scrolled(view());
      scrollTo(407);
      act(() => { s().openPhoneReader(practiceId, besideRefFor({ kind: 'article', actId, articleKey })); });
      setMax(0);
      scrollTo(0);
      setMax(120);
      act(() => { s().closePhoneReader(); });
      act(() => { vi.advanceTimersByTime(3500); });
      setMax(2000);
      observer.grow();
      expect(top()).toBe(120);
    } finally {
      vi.useRealTimers();
    }
  });

  it('«Apri accanto» is icon-only on a phone (its name stays), a 44 px target, so the row\'s name keeps its width', () => {
    withArticleAndDecision();
    render(view());
    const open = screen.getByRole('button', { name: /^Apri accanto art\. 5/ });
    expect(open).toHaveClass('min-h-11', 'min-w-11');
    expect(within(open).getByText('Apri accanto')).toHaveClass('hidden', 'md:inline');
  });

  it('the count sits after the name, on its row, in the part that gives way to the buttons (R3)', () => {
    withArticleAndDecision();
    render(view());
    const count = screen.getByText(/1 atto · 1 articolo · 1 sentenza/);
    expect(count.parentElement).toContainElement(screen.getByRole('heading', { level: 2 }));
    expect(count.parentElement).not.toContainElement(screen.getByRole('button', { name: /^Altre azioni per / }));
    expect(count.parentElement).toHaveClass('min-w-0', 'flex-1');
    // The name keeps its room; the count gives way, its words in its title. Under 390 px it goes under the name (LC70).
    expect(screen.getByRole('heading', { level: 2 })).toHaveClass('min-[390px]:shrink-0', 'text-lg');
    expect(count.parentElement).toHaveClass('flex-col', 'min-[390px]:flex-row');
    expect(count).toHaveAttribute('title', '1 atto · 1 articolo · 1 sentenza');
  });

  it('the dossier picker is one stable sibling: opening the reader does not remount it, its typed query survives', () => {
    const { practiceId, articleKey, actId } = withArticleAndDecision();
    appStore.setState({
      dossiers: Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, title: `Dossier ${i}`, createdAt: '', tags: [], items: [] })),
    });
    render(view());
    fireEvent.click(screen.getByRole('button', { name: /^Altre azioni per / }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Aggiungi a una pratica…' }));
    const search = screen.getByRole('textbox', { name: 'Cerca una pratica' }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'Dossier 3' } });
    act(() => { s().openPhoneReader(practiceId, besideRefFor({ kind: 'article', actId, articleKey })); });
    const after = screen.getByRole('textbox', { name: 'Cerca una pratica' }) as HTMLInputElement;
    expect(after).toBe(search); // the same element: not remounted
    expect(after.value).toBe('Dossier 3');
  });

  it('a pending reveal wins over the saved scroll: the row is scrolled to, not the old place', () => {
    const { practiceId, articleKey, actId } = withArticleAndDecision();
    const { scrollTo, top } = scrolled(view());
    scrollTo(420);
    act(() => { s().openPhoneReader(practiceId, besideRefFor({ kind: 'article', actId, articleKey })); });
    scrollTo(0);
    act(() => { s().closePhoneReader(); s().revealPracticeRow(practiceId, actId, articleKey); });
    expect(top()).toBe(0);
  });

  it('a decision opened from a link opens full screen and leaves `beside` untouched', () => {
    const { practiceId, articleKey, actId } = withArticleAndDecision();
    const window_ = besideRefFor({ kind: 'article', actId, articleKey });
    // a window the desktop saved: the phone neither shows it nor folds the row
    appStore.setState((st) => ({ practices: st.practices.map((p) => ({ ...p, beside: [window_] })) }));
    render(view());
    expect(screen.queryByText(/Aperto accanto/)).toBeNull();
    act(() => { s().openDecision({ ...REF, numero: 777 }, { fromLink: true }); });
    const reader = screen.getByTestId('reading-full-screen');
    expect(within(reader).getByTestId('decision-reader')).toHaveTextContent('n. 777');
    expect(s().practices[0].beside).toEqual([window_]);
    expect(s().practices[0].decisions.map((d) => d.reference.numero)).toEqual([12345, 777]);
    expect(s().activePracticeId).toBe(practiceId);
    expect(s().practiceRows).toEqual({});
  });

  it('a topic search opens full screen with «‹ Pratica»; a decision opened from its list replaces it in the reader; `beside` is untouched', () => {
    withArticleAndDecision();
    render(view());
    act(() => { s().openTopicSearch({ tema: 'danno' }, 'Tema: danno'); });
    const reader = screen.getByTestId('reading-full-screen');
    expect(reader).toHaveAccessibleName('Ricerca per tema');
    expect(within(reader).getByRole('button', { name: 'Pratica' })).toBeInTheDocument();
    expect(screen.queryByTestId('practice-topic-searches')).toBeNull();
    expect(s().practices[0].beside).toEqual([]);

    fireEvent.click(within(reader).getByTestId('topic-list'));
    expect(screen.queryByTestId('topic-list')).toBeNull();
    expect(screen.getByTestId('reading-full-screen')).toContainElement(screen.getByTestId('decision-reader'));
    expect(s().phoneReader?.ref.kind).toBe('decision');
    expect(s().practices[0].beside).toEqual([]);
    expect(s().practices[0].decisions).toHaveLength(1); // the decision was already there: one entry

    fireEvent.click(screen.getByRole('button', { name: 'Pratica' }));
    expect(screen.getByTestId('practice-column')).toBeInTheDocument();
  });

  it('a reload lands on the table: the reader is session state, not saved, whatever windows the desktop had', async () => {
    // LC60: only the Corpus practices waiting for the riquadro are saved; the reader never is.
    appStore.setState({ corpusPracticesPending: true });
    const { practiceId, actId, articleKey, decisionId } = withArticleAndDecision();
    const two = [
      besideRefFor({ kind: 'article', actId, articleKey }),
      besideRefFor({ kind: 'decision', decisionId }),
    ];
    appStore.setState((st) => ({ practices: st.practices.map((p) => ({ ...p, beside: two })) }));
    act(() => { s().openPhoneReader(practiceId, two[0]); });
    expect(s().phoneReader).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('visualex-storage') ?? '{}').state).not.toHaveProperty('phoneReader');

    // a reload: the store is built again from what the browser saved
    vi.resetModules();
    const fresh = await import('../../../store/useAppStore');
    const { PracticePhoneView: Reloaded } = await import('./PracticePhoneView');
    expect(fresh.appStore.getState().phoneReader).toBeNull();
    expect(fresh.appStore.getState().practices[0].beside).toHaveLength(2);
    render(<Reloaded onViewPdf={vi.fn()} onCrossReference={vi.fn()} streaming={null} />);
    expect(screen.getByTestId('practice-column')).toBeInTheDocument();
    expect(screen.queryByTestId('reading-full-screen')).toBeNull();
    expect(screen.queryByText(/Aperto accanto/)).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Espandi/ })).toHaveLength(2);
    localStorage.removeItem('visualex-storage');
    appStore.setState({ corpusPracticesPending: false });
  });

  it('a reader whose practice is not the one on screen is not drawn', () => {
    const { practiceId, articleKey, actId } = withArticleAndDecision();
    const other = s().createPractice('Altra');
    appStore.setState({ phoneReader: { practiceId, ref: besideRefFor({ kind: 'article', actId, articleKey }) }, activePracticeId: other });
    render(view());
    expect(screen.queryByTestId('reading-full-screen')).toBeNull();
    expect(screen.getByText('Pratica vuota')).toBeInTheDocument();
  });

  it('the saved scroll belongs to its practice: another practice comes back from its reader at the top', () => {
    const a = withArticleAndDecision();
    const b = s().createPractice('Seconda');
    const { actId: actB } = s().addArticlesToPractice(b, L241, [article(L241, '2')]);
    const refB = besideRefFor({ kind: 'article', actId: actB, articleKey: practiceArticleKey(article(L241, '2')) });
    s().setActivePractice(a.practiceId);
    const { scrollTo, top } = scrolled(view());
    scrollTo(420);
    // practice A's reader opens, then practice B comes on screen (which takes the reader off): not A's place
    act(() => { s().openPhoneReader(a.practiceId, besideRefFor({ kind: 'article', actId: a.actId, articleKey: a.articleKey })); });
    scrollTo(0);
    act(() => { s().openPhoneReader(b, refB); });
    act(() => { s().closePhoneReader(); });
    expect(top()).toBe(0);
  });

  it('the save\'s picker is not lost when the reader opens: it is mounted outside the column the reader replaces', () => {
    const { practiceId, articleKey, actId } = withArticleAndDecision();
    render(view());
    fireEvent.click(screen.getByRole('button', { name: /^Altre azioni per / }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Aggiungi a una pratica…' }));
    expect(screen.getByRole('dialog', { name: 'Aggiungi a una pratica' })).toBeInTheDocument();
    act(() => { s().openPhoneReader(practiceId, besideRefFor({ kind: 'article', actId, articleKey })); });
    expect(screen.getByTestId('reading-full-screen')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Aggiungi a una pratica' })).toBeInTheDocument();
  });

  it('«Chiudi il tavolo» in «⋯» closes it at once, with no confirmation (K1a)', () => {
    const { practiceId } = withArticleAndDecision();
    render(view());
    fireEvent.click(screen.getByRole('button', { name: /^Altre azioni per / }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Chiudi il tavolo' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(s().practices.some((p) => p.id === practiceId)).toBe(false);
  });

  it('no extracted article is drawn, and no topic band: a practice with only a desktop window is empty here', () => {
    const p = s().createPractice('Solo ricerca');
    appStore.setState((st) => ({
      practices: st.practices.map((x) => ({ ...x, beside: [{ id: 'search:x', kind: 'decision-search' as const, query: { tema: 'danno' }, label: 'Tema: danno' }] })),
    }));
    render(view());
    expect(s().activePracticeId).toBe(p);
    expect(screen.getByText('Pratica vuota')).toBeInTheDocument();
    expect(screen.queryByTestId('practice-topic-searches')).toBeNull();
    expect(screen.queryByTestId('topic-list')).toBeNull();
  });

  it('«⋯» on the phone\'s header adds to a pratica, never saves the table as one (LC60), 44 px', () => {
    withArticleAndDecision();
    render(view());
    const more = screen.getByRole('button', { name: /^Altre azioni per / });
    expect(more).toHaveClass('min-h-[44px]', 'min-w-[44px]');
    fireEvent.click(more);
    expect(screen.queryByRole('menuitem', { name: 'Salva come dossier' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Aggiungi a una pratica…' })).toBeInTheDocument();
    expect(screen.getByText(/1 atto · 1 articolo · 1 sentenza/)).toBeInTheDocument();
  });

  it('the index stays open across picks', async () => {
    h.legalFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([article(L24, '9')]) });
    const { actId } = s().addArticlesToPractice(null, { ...L24, urn: 'urn:nir:stato:legge:2017-03-08;24' }, [article(L24, '5')]);
    render(view());
    fireEvent.click(screen.getByRole('button', { name: /^Azioni su/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Struttura della norma' }));
    const tree = () => h.trees.at(-1) as { isOpen: boolean; onArticleSelect: (n: string, a: string | null) => void };
    await waitFor(() => expect(tree()).toEqual(expect.objectContaining({ isOpen: true })));
    await act(async () => { tree().onArticleSelect('9', null); });
    await waitFor(() => expect(s().practices[0].acts.find((a) => a.id === actId)?.articles).toHaveLength(2));
    expect(tree()).toEqual(expect.objectContaining({ isOpen: true }));
    await act(async () => { tree().onArticleSelect('5', null); });
    expect(tree()).toEqual(expect.objectContaining({ isOpen: true }));
  });
});
