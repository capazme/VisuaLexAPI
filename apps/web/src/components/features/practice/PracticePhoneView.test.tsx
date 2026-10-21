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
import { besideRefFor, practiceArticleKey } from '../../../utils/practice';

const REF = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 12345, anno: 2020 };

const s = () => appStore.getState();
const view = () => <PracticePhoneView onViewPdf={vi.fn()} onCrossReference={vi.fn()} streaming={null} />;
const title = () => screen.getByRole('heading', { level: 2 }).textContent;

beforeEach(() => {
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
  h.trees.length = 0;
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null,
    practiceNotice: null, readingBackStack: [], phoneReader: null, windowFocusRequest: null,
    structureWindow: { blockId: null, position: { x: 0, y: 0 } },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('PracticePhoneView (spec §8, P3)', () => {
  it('the header switches practices by its chevrons and its dots, and the column follows', () => {
    const first = s().createPractice('Prima');
    s().addArticlesToPractice(first, L24, [article(L24, '5')]);
    const second = s().createPractice('Seconda');
    s().addArticlesToPractice(second, L241, [article(L241, '2')]);
    s().setActivePractice(first);
    render(view());
    expect(title()).toBe('Prima');
    expect(screen.getByRole('button', { name: 'Pratica precedente' })).toBeDisabled();
    expect(screen.getByRole('region', { name: 'l. 8 marzo 2017, n. 24' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pratica successiva' }));
    expect(s().activePracticeId).toBe(second);
    expect(title()).toBe('Seconda');
    expect(screen.getByRole('button', { name: 'Pratica successiva' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'l. 8 marzo 2017, n. 24' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Pratica 1: Prima' }));
    expect(s().activePracticeId).toBe(first);
    expect(screen.getByRole('button', { name: 'Pratica 1: Prima' })).toHaveAttribute('aria-current', 'true');
  });

  it('rows open in place: a reveal from the store opens the row on the phone too', () => {
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    render(view());
    expect(screen.queryByTestId('reader')).toBeNull();
    act(() => { s().revealPracticeArticle(practiceId, actId, '5'); });
    expect(screen.getByTestId('reader')).toBeInTheDocument();
  });

  it('an empty practice says so; the migration\'s notice is not the view\'s (SearchPanel shows it over both layouts)', () => {
    s().createPractice('Vuota');
    const notice = '2 ricerche per tema non sono state riaperte: «a», «b». Puoi rifarle dalla barra di ricerca.';
    appStore.setState({ practiceNotice: notice });
    render(view());
    expect(screen.getByText('Pratica vuota')).toBeInTheDocument();
    expect(s().practiceNotice).toBe(notice);
  });

  it('the header\'s controls are 44 px targets: the chevrons, and each dot a button around a small dot naming its practice', () => {
    s().createPractice('Prima');
    s().createPractice('Seconda');
    render(view());
    for (const name of ['Pratica precedente', 'Pratica successiva', 'Pratica 1: Prima', 'Pratica 2: Seconda']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-[44px]', 'min-w-[44px]');
    }
    const dot = screen.getByRole('button', { name: 'Pratica 2: Seconda' });
    expect(dot).toHaveAttribute('aria-current', 'true');
    expect(dot.querySelector('span')).toHaveClass('h-1.5', 'w-6');
    expect(screen.getByRole('button', { name: 'Pratica 1: Prima' }).querySelector('span')).toHaveClass('h-1.5', 'w-1.5');
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
    const decisions = screen.getByText(/Giurisprudenza \(1\)/);
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
    expect(back).toHaveClass('min-h-[44px]');
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
    expect(open).toHaveClass('min-h-[44px]', 'min-w-[44px]');
    expect(open.querySelector('span')).toHaveClass('hidden', 'md:inline');
  });

  it('the count line has its own line, above the buttons: never cut by them', () => {
    withArticleAndDecision();
    render(view());
    const count = screen.getByText(/1 atto · 1 articolo · 1 sentenza/);
    expect(count.tagName).toBe('P');
    expect(count).not.toHaveClass('truncate');
    expect(screen.getByRole('button', { name: 'Salva come dossier' }).parentElement).not.toContainElement(count);
  });

  it('Esc on the list\'s open «⋯» menu closes the menu and leaves «Le tue pratiche» visible', async () => {
    s().createPractice('Prima');
    render(view());
    fireEvent.click(screen.getByTitle('Elenco delle pratiche'));
    const dialog = screen.getByRole('dialog', { name: 'Le tue pratiche' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Altre azioni per la pratica Prima' }));
    const item = screen.getByRole('menuitem', { name: 'Rinomina' });
    fireEvent.keyDown(item, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    // (a dialog that closed would still be in the DOM for its exit animation: wait it out)
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(screen.getByRole('dialog', { name: 'Le tue pratiche' })).toBeInTheDocument();
    // a second Esc, with no menu open, is the dialog's
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('the dossier picker is one stable sibling: opening the reader does not remount it, its typed query survives', () => {
    const { practiceId, articleKey, actId } = withArticleAndDecision();
    appStore.setState({
      dossiers: Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, title: `Dossier ${i}`, createdAt: '', tags: [], items: [] })),
    });
    render(view());
    fireEvent.click(screen.getByRole('button', { name: /^Altre azioni per la pratica/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Aggiungi a un dossier…' }));
    const search = screen.getByRole('textbox', { name: 'Cerca dossier' }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'Dossier 3' } });
    act(() => { s().openPhoneReader(practiceId, besideRefFor({ kind: 'article', actId, articleKey })); });
    const after = screen.getByRole('textbox', { name: 'Cerca dossier' }) as HTMLInputElement;
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
  });

  it('a reader whose practice is not the one on screen is not drawn', () => {
    const { practiceId, articleKey, actId } = withArticleAndDecision();
    const other = s().createPractice('Altra');
    appStore.setState({ phoneReader: { practiceId, ref: besideRefFor({ kind: 'article', actId, articleKey }) }, activePracticeId: other });
    render(view());
    expect(screen.queryByTestId('reading-full-screen')).toBeNull();
    expect(title()).toBe('Altra');
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
    fireEvent.click(screen.getByRole('button', { name: /^Altre azioni per la pratica/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Aggiungi a un dossier…' }));
    expect(screen.getByRole('dialog', { name: 'Aggiungi a un dossier' })).toBeInTheDocument();
    act(() => { s().openPhoneReader(practiceId, besideRefFor({ kind: 'article', actId, articleKey })); });
    expect(screen.getByTestId('reading-full-screen')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Aggiungi a un dossier' })).toBeInTheDocument();
  });

  it('a tap on the name lists the practices (44 px entries): it switches, and «Nuova pratica» creates one', async () => {
    const first = s().createPractice('Prima');
    const second = s().createPractice('Seconda');
    s().addArticlesToPractice(second, L241, [article(L241, '2')]);
    s().setActivePractice(first);
    render(view());
    const name = () => screen.getByTitle('Elenco delle pratiche');
    expect(name()).toHaveClass('min-h-[44px]');

    fireEvent.click(name());
    const dialog = screen.getByRole('dialog', { name: 'Le tue pratiche' });
    expect(within(dialog).getByRole('button', { name: /^Prima/ })).toHaveAttribute('aria-current', 'true');
    expect(within(dialog).getByRole('button', { name: /^Seconda/ })).toHaveClass('min-h-[44px]');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Seconda/ }));
    expect(s().activePracticeId).toBe(second);
    expect(name()).toHaveTextContent('Seconda');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(name());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Nuova pratica' }));
    expect(s().practices.map((p) => p.label)).toEqual(['Prima', 'Seconda', 'Nuova pratica']);
    expect(s().activePracticeId).toBe(s().practices[2].id);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('each practice in the list has «⋯» (44 px) to rename it, in place', async () => {
    const first = s().createPractice('Prima');
    render(view());
    fireEvent.click(screen.getByTitle('Elenco delle pratiche'));
    const dialog = screen.getByRole('dialog', { name: 'Le tue pratiche' });
    const more = within(dialog).getByRole('button', { name: 'Altre azioni per la pratica Prima' });
    expect(more).toHaveClass('min-h-[44px]', 'min-w-[44px]');
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rinomina' }));
    const input = within(dialog).getByRole('textbox', { name: 'Nome della pratica' });
    fireEvent.change(input, { target: { value: 'Rossi c. Bianchi' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(s().practices.find((p) => p.id === first)?.label).toBe('Rossi c. Bianchi');
    expect(s().practices.find((p) => p.id === first)?.labelIsCustom).toBe(true);
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^Rossi c\. Bianchi/ })).toBeInTheDocument());
  });

  it('«Chiudi la pratica» in the list closes it at once, with no confirmation, and the other becomes active (K1a)', () => {
    const { practiceId } = withArticleAndDecision();
    const keep = s().createPractice('Resta');
    s().setActivePractice(practiceId);
    render(view());
    fireEvent.click(screen.getByTitle('Elenco delle pratiche'));
    const label = s().practices.find((p) => p.id === practiceId)?.label ?? '';
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Le tue pratiche' })).getByRole('button', { name: `Altre azioni per la pratica ${label}` }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Chiudi la pratica' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(s().practices.map((p) => p.id)).toEqual([keep]);
    expect(s().activePracticeId).toBe(keep);
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

  it('«Salva come dossier» and its «⋯» entries are on the phone\'s header, 44 px', () => {
    withArticleAndDecision();
    render(view());
    const save = screen.getByRole('button', { name: 'Salva come dossier' });
    expect(save).toHaveClass('min-h-[44px]');
    const more = screen.getByRole('button', { name: /^Altre azioni per la pratica/ });
    expect(more).toHaveClass('min-h-[44px]', 'min-w-[44px]');
    fireEvent.click(more);
    expect(screen.getByRole('menuitem', { name: 'Salva come dossier' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Aggiungi a un dossier…' })).toBeInTheDocument();
    expect(screen.getByText(/1 atto · 1 articolo · 1 sentenza/)).toBeInTheDocument();
  });

  it('the index drawer stays open across picks', async () => {
    h.legalFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([article(L24, '9')]) });
    const { actId } = s().addArticlesToPractice(null, { ...L24, urn: 'urn:nir:stato:legge:2017-03-08;24' }, [article(L24, '5')]);
    render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Struttura della norma' }));
    const tree = () => h.trees.at(-1) as { variant: string; isOpen: boolean; onArticleSelect: (n: string, a: string | null) => void };
    await waitFor(() => expect(tree()).toEqual(expect.objectContaining({ variant: 'drawer', isOpen: true })));
    await act(async () => { tree().onArticleSelect('9', null); });
    await waitFor(() => expect(s().practices[0].acts.find((a) => a.id === actId)?.articles).toHaveLength(2));
    expect(tree()).toEqual(expect.objectContaining({ variant: 'drawer', isOpen: true }));
    await act(async () => { tree().onArticleSelect('5', null); });
    expect(tree()).toEqual(expect.objectContaining({ variant: 'drawer', isOpen: true }));
  });
});
