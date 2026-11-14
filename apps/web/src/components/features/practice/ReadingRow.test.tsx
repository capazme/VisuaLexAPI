import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ deepStack: false }));

vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => true, isDesktopViewport: () => true }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }),
}));
vi.mock('./PracticeTable', () => ({
  PracticeTable: ({ layout }: { layout: string }) => (
    <div data-testid="practice-table" data-layout={layout}>
      <header data-pinned-head data-testid="stub-practice-head">La pratica</header>
      <div data-pinned-head data-testid="stub-act-head">Atto</div>
      <div data-pinned-head data-testid="stub-toolbar">Barra della riga aperta</div>
      <div data-pinned-head data-testid="stub-toolbar-later">Barra di una riga più in basso</div>
      {env.deepStack && (
        <>
          <div data-pinned-head data-testid="stub-act-head-2">Secondo atto</div>
          <div data-pinned-head data-testid="stub-act-head-3">Terzo atto</div>
        </>
      )}
      <button type="button">Dentro il tavolo</button>
    </div>
  ),
}));
vi.mock('../search/ArticleTabContent', () => ({
  ArticleTabContent: ({ data, findHostId, readingOrigin }: { data: { article_text: string }; findHostId?: string; readingOrigin?: { tabId: string } }) => (
    <div data-testid="article-reader" data-find-host={findHostId} data-origin={readingOrigin?.tabId}>
      <div data-pinned-head data-testid="stub-window-toolbar">Barra compatta</div>
      {data.article_text}
    </div>
  ),
}));
vi.mock('../decisions/DecisionEntryView', () => ({
  DecisionEntryView: ({ hostId, findHostId }: { hostId: string; findHostId?: string }) => (
    <div data-testid="decision-reader" data-host={hostId} data-find-host={findHostId}>
      <div data-pinned-head data-testid="stub-decision-toolbar">Barra della decisione</div>
    </div>
  ),
}));
vi.mock('../decisions/DecisionSearchTabView', () => ({
  DecisionSearchTabView: ({ tabId }: { tabId: string }) => <div data-testid="topic-list" data-tab={tabId} />,
}));

import { appStore } from '../../../store/useAppStore';
import { FindWindow } from '../search/FindWindow';
import { closeFindWindow, openFindWindow, setFindWindowDefaultPlace } from '../../../utils/findWindowControl';
import { CitationPreviewPopup } from '../../ui/CitationPreviewPopup';
import { CommandPalette } from '../search/CommandPalette';
import { FOUND, L24, L241, article } from '../../../utils/__fixtures__/savedWorkspaces';
import { besideRefFor, practiceArticleKey, type BesideRef } from '../../../utils/practice';
import { ReadingRow } from './ReadingRow';
import { FOCUS_BUTTON_CLEARANCE } from '../../layout/PageFrame';

const s = () => appStore.getState();
const AREA_LEFT = 100;
const AREA_TOP = 50;
let areaWidth = 1300;
/** The page is scrolled: the practice header is gone, the act's heading and the open row's toolbar are stuck at the top. */
let scrolled = false;

class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.all.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    FakeResizeObserver.all = FakeResizeObserver.all.filter((o) => o !== this);
  }
}
const resizeTo = (width: number) => {
  areaWidth = width;
  act(() => FakeResizeObserver.all.forEach((o) => o.callback()));
};

const box = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
const pxOf = (el: Element | null) => parseFloat((el as HTMLElement | null)?.style.width ?? '0') || 0;

/** jsdom has no layout: the row's rectangles, worked out from the columns' own widths. */
function fakeRect(this: Element): DOMRect {
  const id = this.getAttribute('data-testid');
  if (id === 'reading-row') return box(AREA_LEFT, AREA_TOP, areaWidth, 800);
  if (id === 'results-area') return box(AREA_LEFT, AREA_TOP, 960, 800);
  const columnLeft = (column: Element) => {
    let left = AREA_LEFT;
    for (let sibling = column.previousElementSibling; sibling; sibling = sibling.previousElementSibling) left += pxOf(sibling);
    return left;
  };
  if (id === 'reading-row-table' || id === 'reading-row-rail' || id === 'reading-row-window') {
    return box(columnLeft(this), scrolled && id === 'reading-row-table' ? -300 : AREA_TOP, pxOf(this) || areaWidth, 800);
  }
  const column = this.closest('[data-testid="reading-row-window"]');
  if (column && this.hasAttribute('data-reading-window-header')) return box(columnLeft(column) + 16, AREA_TOP, pxOf(column) - 16, 44);
  if (column && this.hasAttribute('data-reading-window-body')) return box(columnLeft(column) + 16, AREA_TOP + 44, pxOf(column) - 16, 756);
  if (column && (id === 'stub-window-toolbar' || id === 'stub-decision-toolbar')) return box(columnLeft(column) + 16, AREA_TOP + 44, pxOf(column) - 16, 40);
  const table = this.closest('[data-testid="reading-row-table"]');
  if (table) {
    const left = columnLeft(table);
    const width = pxOf(table) || areaWidth;
    // Unscrolled: the practice header 50..110, 12 px, the act's heading 122..172, its open row's toolbar 172..212.
    if (id === 'stub-practice-head') return box(left, scrolled ? -200 : AREA_TOP, width, 60);
    if (id === 'stub-act-head') return box(left, scrolled ? 0 : 122, width, 50);
    if (id === 'stub-toolbar') return box(left, scrolled ? 50 : 172, width, 40);
    if (id === 'stub-toolbar-later') return box(left, 600, width, 40);
    // A deep stack: two more acts folded one under the other, each heading pinned right under the last.
    if (id === 'stub-act-head-2') return box(left, 212, width, 50);
    if (id === 'stub-act-head-3') return box(left, 262, width, 50);
  }
  return box(0, 0, 0, 0);
}

const A5 = article(L24, '5');
const B2 = article(L241, '2');

/** The active practice holds art. 5 of l. 24/2017 and a decision; `count` windows are open on them. */
function practiceWithWindows(count: 0 | 1 | 2 = 2) {
  const { practiceId, actId } = s().addArticlesToPractice(null, L24, [A5]);
  const { decisionId } = s().openDecision(FOUND, { practiceId, beside: false, open: false });
  const refs: BesideRef[] = [
    besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(A5) }),
    besideRefFor({ kind: 'decision', decisionId }),
  ];
  // A second article, shown in no window: the one a reveal reaches in the table.
  s().addArticlesToPractice(practiceId, L24, [article(L24, '7')]);
  appStore.setState({ pendingReveal: null });
  for (const ref of refs.slice(0, count)) s().openBeside(practiceId, ref);
  return { practiceId, actId, decisionId, refs };
}

const row = () => <ReadingRow onViewPdf={vi.fn()} onCrossReference={vi.fn()} streaming={null} />;
/** The rail's overlay is open: drawn, not hidden (closed, it stays mounted and hidden, with the table in it). */
const overlayShown = () => {
  const overlay = screen.queryByTestId('reading-row-overlay');
  return overlay !== null && !overlay.hidden;
};
const windows = () => screen.queryAllByTestId('reading-window');
const widthOf = (testId: string, index = 0) => (screen.getAllByTestId(testId)[index] as HTMLElement).style.width;

beforeEach(() => {
  areaWidth = 1300;
  scrolled = false;
  env.deepStack = false;
  FakeResizeObserver.all = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(fakeRect);
  window.innerWidth = 1920;
  window.innerHeight = 768;
  sessionStorage.clear();
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null,
    readingBackStack: [],  });
});

afterEach(() => {
  act(() => closeFindWindow());
  setFindWindowDefaultPlace(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('ReadingRow — the table and its windows (spec §4.2-§4.3)', () => {
  it('with no window, the table alone, taking the whole area', () => {
    practiceWithWindows(0);
    render(row());
    expect(screen.getByTestId('practice-table')).toBeInTheDocument();
    expect(windows()).toHaveLength(0);
    expect(screen.getByTestId('reading-row-table').style.width).toBe('');
  });

  it('the view follows the windows (U2): the overview with none, the index beside one, the overview again once it closes', () => {
    const { practiceId, refs } = practiceWithWindows(0);
    render(row());
    expect(screen.getByTestId('practice-table')).toHaveAttribute('data-layout', 'overview');
    expect(screen.getByTestId('reading-row-table')).toHaveAttribute('data-view', 'overview');
    act(() => s().openBeside(practiceId, refs[0]));
    expect(screen.getByTestId('practice-table')).toHaveAttribute('data-layout', 'index');
    expect(screen.getByTestId('reading-row-table')).toHaveAttribute('data-view', 'index');
    act(() => s().closeBeside(practiceId, refs[0].id));
    expect(screen.getByTestId('practice-table')).toHaveAttribute('data-layout', 'overview');
  });

  it('a view changed under the focus hands it on: to the newest window, then to the table\'s first control', () => {
    const { practiceId, refs } = practiceWithWindows(0);
    render(row());
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => s().openBeside(practiceId, refs[0]));
    expect(windows()[0]).toHaveFocus();
    // The window goes with the focus in it (an entry's ✕, the store): the overview's first control takes it.
    act(() => s().closeBeside(practiceId, refs[0].id));
    expect(screen.getByRole('button', { name: 'Dentro il tavolo' })).toHaveFocus();
    // A focus somewhere that stays (the search field) is left where it is.
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    act(() => s().openBeside(practiceId, refs[0]));
    expect(field).toHaveFocus();
    field.remove();
  });

  it('a row revealed in the reading view opens beside, in place of the oldest window; with none open the column takes it', () => {
    const { practiceId, actId, refs } = practiceWithWindows(2);
    render(row());
    act(() => { s().revealPracticeArticle(practiceId, actId, '7'); });
    const seven = besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(article(L24, '7')) });
    expect(s().practices[0].beside.map((b) => b.id)).toEqual([refs[1].id, seven.id]);
    expect(s().pendingReveal).toBeNull();
    // Its row, which the reveal opened in the hidden overview, is closed again.
    expect(Object.keys(s().practiceRows).filter((key) => key.endsWith(practiceArticleKey(article(L24, '7'))))).toEqual([]);
    // A reveal does not take the focus (a search that landed keeps it in the field).
    expect(s().windowFocusRequest).toBeNull();

    act(() => {
      s().closeBeside(practiceId, refs[1].id);
      s().closeBeside(practiceId, seven.id);
    });
    act(() => { s().revealPracticeArticle(practiceId, actId, '7'); });
    expect(s().practices[0].beside).toEqual([]);
    // The overview's column (stubbed here) takes it: nothing opened beside, the reveal left for it.
    expect(s().pendingReveal?.rowKey).toContain(practiceArticleKey(article(L24, '7')));
  });

  it('draws the practice\'s windows in order, with their views', () => {
    const { practiceId, refs } = practiceWithWindows(2);
    render(row());
    const drawn = windows();
    expect(drawn.map((w) => w.getAttribute('data-window-id'))).toEqual(refs.map((r) => r.id));
    expect(within(drawn[0]).getByTestId('article-reader')).toHaveAttribute('data-find-host', practiceId);
    expect(within(drawn[0]).getByTestId('article-reader')).toHaveAttribute('data-origin', refs[0].id);
    expect(within(drawn[1]).getByTestId('decision-reader')).toHaveAttribute('data-host', refs[1].id);
    expect(within(drawn[1]).getByTestId('decision-reader')).toHaveAttribute('data-find-host', practiceId);
  });

  it('a topic window renders the topic search', () => {
    const { practiceId } = practiceWithWindows(0);
    s().openTopicSearch({ tema: 'danno' }, 'Danno', { besideId: practiceId });
    render(row());
    expect(screen.getByTestId('topic-list')).toHaveAttribute('data-tab', s().practices[0].beside[0].id);
  });

  it('only the active practice\'s windows: switching practice hides them, returning shows them', () => {
    const { practiceId } = practiceWithWindows(2);
    const other = s().createPractice('Altra');
    s().addArticlesToPractice(other, L241, [B2]);
    s().setActivePractice(other);
    render(row());
    expect(windows()).toHaveLength(0);
    act(() => s().setActivePractice(practiceId));
    expect(windows()).toHaveLength(2);
    act(() => s().setActivePractice(other));
    expect(windows()).toHaveLength(0);
    act(() => s().setActivePractice(practiceId));
    expect(windows()).toHaveLength(2);
  });

  it('«Chiudi» removes one window and leaves its subject in the table', () => {
    const { practiceId, refs } = practiceWithWindows(2);
    render(row());
    fireEvent.click(within(windows()[0]).getByRole('button', { name: /^Chiudi la finestra/ }));
    expect(windows().map((w) => w.getAttribute('data-window-id'))).toEqual([refs[1].id]);
    const practice = s().practices.find((p) => p.id === practiceId)!;
    expect(practice.beside.map((b) => b.id)).toEqual([refs[1].id]);
    expect(practice.acts[0].articles).toHaveLength(2);
    expect(practice.decisions).toHaveLength(1);
  });
});

describe('ReadingRow — widths (besideLayout)', () => {
  it('one window: the index, 320 px, and the window the rest', () => {
    areaWidth = 1280;
    practiceWithWindows(1);
    render(row());
    expect(widthOf('reading-row-table')).toBe('320px');
    expect(widthOf('reading-row-window')).toBe('960px');
  });

  it('two windows: the index and the two windows sharing the rest, each at least 420 px', () => {
    areaWidth = 1300;
    practiceWithWindows(2);
    render(row());
    expect(widthOf('reading-row-table')).toBe('320px');
    expect(widthOf('reading-row-window', 0)).toBe('490px');
    expect(widthOf('reading-row-window', 1)).toBe('490px');
    expect(screen.queryByTestId('practice-rail')).not.toBeInTheDocument();
  });

  it('follows the area when it is resized: the index folds into the rail and unfolds again', () => {
    practiceWithWindows(2);
    render(row());
    expect(screen.getByTestId('practice-table')).toBeInTheDocument();
    resizeTo(1100);
    expect(screen.getByTestId('practice-table')).not.toBeVisible();
    expect(screen.getByTestId('practice-rail')).toBeInTheDocument();
    expect(widthOf('reading-row-rail')).toBe('48px');
    expect(widthOf('reading-row-window', 0)).toBe('526px');
    expect(widthOf('reading-row-window', 1)).toBe('526px');
    resizeTo(1400);
    expect(screen.getByTestId('practice-table')).toBeInTheDocument();
    expect(screen.queryByTestId('practice-rail')).not.toBeInTheDocument();
  });
});

describe('ReadingRow — the frame is its one cap, with or without a window beside (U1)', () => {
  /** The page's shape: Layout's scroller and its frame, the search page's results area (no cap of its own), the row. */
  function inPage() {
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'clientWidth', { value: 1500 });
    const container = document.createElement('div');
    container.style.paddingLeft = '32px';
    const area = document.createElement('div');
    area.setAttribute('data-testid', 'results-area');
    scroller.appendChild(container);
    container.appendChild(area);
    document.body.appendChild(scroller);
    return area;
  }
  const root = () => screen.getByTestId('reading-row');

  it('never reaches past its parent while windows are beside: the scroller\'s room beyond it is the frame\'s margin', () => {
    areaWidth = 1436;
    practiceWithWindows(2);
    render(row(), { container: inPage() });
    expect(root().style.marginInline).toBe('');
    expect(root().style.width).toBe('');
    // The columns share the row's own width.
    const px = (testId: string, index = 0) => parseFloat(widthOf(testId, index));
    expect(px('reading-row-table') + px('reading-row-window', 0) + px('reading-row-window', 1)).toBe(1436);
  });

  it('with no window the row keeps the page\'s measure', () => {
    areaWidth = 960;
    practiceWithWindows(0);
    render(row(), { container: inPage() });
    expect(root().style.marginInline).toBe('');
    expect(root().style.width).toBe('');
  });

  it('keeps the table, alone in the row, clear of the full-screen button; beside a window, the last window does', () => {
    areaWidth = 1436;
    const { practiceId, refs } = practiceWithWindows(1);
    render(row(), { container: inPage() });
    expect(screen.getByTestId('reading-row-table')).not.toHaveClass(FOCUS_BUTTON_CLEARANCE);
    act(() => s().closeBeside(practiceId, refs[0].id));
    expect(screen.getByTestId('reading-row-table')).toHaveClass(FOCUS_BUTTON_CLEARANCE);
  });

  it('the overview comes back at its scroll position when the last window closes (U2)', () => {
    areaWidth = 1436;
    const { practiceId, refs } = practiceWithWindows(0);
    const area = inPage();
    render(row(), { container: area });
    const scroller = area.parentElement!.parentElement!;
    scroller.scrollTop = 640;
    fireEvent.scroll(scroller);
    act(() => s().openBeside(practiceId, refs[0]));
    // The reading view is the window's height: the browser clamps the scroller, the overview's place is kept.
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    act(() => s().closeBeside(practiceId, refs[0].id));
    expect(scroller.scrollTop).toBe(640);
  });

  it('entering the reading view starts at the top; the overview\'s place is kept per practice', () => {
    areaWidth = 1436;
    const { practiceId, refs } = practiceWithWindows(0);
    const other = s().createPractice('Altra');
    s().addArticlesToPractice(other, L241, [B2]);
    s().setActivePractice(practiceId);
    const area = inPage();
    render(row(), { container: area });
    const scroller = area.parentElement!.parentElement!;
    scroller.scrollTop = 640;
    fireEvent.scroll(scroller);
    act(() => s().openBeside(practiceId, refs[0]));
    expect(scroller.scrollTop).toBe(0);
    // Another practice, in its overview, scrolled elsewhere: it does not take this one's place.
    act(() => s().setActivePractice(other));
    scroller.scrollTop = 120;
    fireEvent.scroll(scroller);
    act(() => s().setActivePractice(practiceId));
    act(() => s().closeBeside(practiceId, refs[0].id));
    expect(scroller.scrollTop).toBe(640);
  });

  it('stays in its parent as a window opens and closes', () => {
    areaWidth = 1436;
    const { practiceId, refs } = practiceWithWindows(1);
    render(row(), { container: inPage() });
    expect(root().style.marginInline).toBe('');
    act(() => s().closeBeside(practiceId, refs[0].id));
    expect(root().style.marginInline).toBe('');
    expect(root().style.width).toBe('');
  });
});

describe('ReadingRow — it fits Layout\'s scroller and clears its corner', () => {
  it('every column is the page\'s height less the content area\'s two paddings (`h-app-row`), so the scroller never overflows', () => {
    areaWidth = 1100;
    practiceWithWindows(2);
    render(row());
    fireEvent.click(screen.getByTestId('practice-rail'));
    for (const el of [screen.getByTestId('reading-row-rail'), screen.getByTestId('reading-row-overlay'), ...screen.getAllByTestId('reading-row-window')]) {
      expect(el).toHaveClass('h-app-row');
      expect(el.className).not.toMatch(/100vh/);
    }
  });

  it('the right-hand window\'s header leaves Layout\'s full-screen toggle free; the other\'s does not need to', () => {
    areaWidth = 1400;
    practiceWithWindows(2);
    render(row());
    const headers = [...document.querySelectorAll('[data-reading-window-header]')];
    expect(headers).toHaveLength(2);
    expect(headers[0]).not.toHaveClass('md:pr-12');
    expect(headers[1]).toHaveClass('md:pr-12');
  });

  it('a single window is the right-hand one', () => {
    areaWidth = 1400;
    practiceWithWindows(1);
    render(row());
    expect(document.querySelector('[data-reading-window-header]')).toHaveClass('md:pr-12');
  });
});

describe('ReadingRow — the rail (spec §4.3)', () => {
  beforeEach(() => {
    areaWidth = 1100;
  });

  it('keeps the one table mounted as the index folds into the rail and unfolds again: what its acts hold stays open', () => {
    areaWidth = 1400;
    practiceWithWindows(2);
    render(row());
    const table = screen.getByTestId('practice-table');
    resizeTo(1100);
    expect(screen.getByTestId('practice-table')).toBe(table);
    expect(table).not.toBeVisible();
    expect(screen.getByTestId('reading-row-overlay')).toHaveAttribute('hidden');
    fireEvent.click(screen.getByTestId('practice-rail'));
    expect(table).toBeVisible();
    resizeTo(1400);
    expect(screen.getByTestId('practice-table')).toBe(table);
  });

  it('shows the count of texts and the practice\'s name, with the table folded away', () => {
    practiceWithWindows(2);
    render(row());
    const rail = screen.getByTestId('practice-rail');
    expect(rail).toHaveAccessibleName('Pratica l. 24/2017');
    expect(rail).toHaveAttribute('aria-expanded', 'false');
    expect(within(rail).getByTestId('practice-rail-count')).toHaveTextContent('3');
    expect(screen.getByTestId('practice-table')).not.toBeVisible();
  });

  it('opens the index as an overlay over the windows; Esc closes it and returns focus to the rail', () => {
    practiceWithWindows(2);
    render(row());
    fireEvent.click(screen.getByTestId('practice-rail'));
    const overlay = screen.getByTestId('reading-row-overlay');
    expect(within(overlay).getByTestId('practice-table')).toHaveAttribute('data-layout', 'index');
    // The index's 320 px and the overlay's padding.
    expect(overlay.style.width).toMatch(/^min\(344px/);
    expect(screen.getByTestId('practice-rail')).toHaveAttribute('aria-expanded', 'true');
    expect(overlay).toHaveClass('z-30');
    expect(windows()).toHaveLength(2);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(overlayShown()).toBe(false);
    expect(screen.getByTestId('practice-rail')).toHaveFocus();
  });

  it('a click outside closes it; a click inside, on the rail again or in what the table opens does not', () => {
    practiceWithWindows(2);
    render(row());
    fireEvent.click(screen.getByTestId('practice-rail'));

    fireEvent.pointerDown(within(screen.getByTestId('reading-row-overlay')).getByRole('button', { name: 'Dentro il tavolo' }));
    expect(overlayShown()).toBe(true);

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    fireEvent.pointerDown(dialog);
    expect(overlayShown()).toBe(true);
    dialog.remove();

    fireEvent.pointerDown(within(windows()[0]).getByTestId('article-reader'));
    expect(overlayShown()).toBe(false);

    // The rail itself toggles it: a press on it is not «outside».
    fireEvent.click(screen.getByTestId('practice-rail'));
    fireEvent.pointerDown(screen.getByTestId('practice-rail'));
    expect(overlayShown()).toBe(true);
    fireEvent.click(screen.getByTestId('practice-rail'));
    expect(overlayShown()).toBe(false);
  });

  it('Esc under an open modal dialog leaves the overlay open (the dialog takes it)', () => {
    practiceWithWindows(2);
    render(row());
    fireEvent.click(screen.getByTestId('practice-rail'));
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(overlayShown()).toBe(true);
    modal.remove();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(overlayShown()).toBe(false);
  });

  it('a press in a floating tool (the structure window, the find window) is not a click away', () => {
    practiceWithWindows(2);
    render(row());
    fireEvent.click(screen.getByTestId('practice-rail'));
    const tool = document.createElement('aside');
    tool.setAttribute('data-floating-tool', '');
    document.body.appendChild(tool);
    fireEvent.pointerDown(tool);
    expect(overlayShown()).toBe(true);
    tool.remove();
  });

  it('Esc closes the overlay with the real palette mounted, closed: it does not swallow the key', () => {
    practiceWithWindows(2);
    render(<>{row()}<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} /></>);
    fireEvent.click(screen.getByTestId('practice-rail'));
    expect(overlayShown()).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(overlayShown()).toBe(false);
  });

  it('a window asked to take focus closes the overlay over it, and is focused', () => {
    const { practiceId, refs } = practiceWithWindows(2);
    render(row());
    fireEvent.click(screen.getByTestId('practice-rail'));
    expect(overlayShown()).toBe(true);
    // The folded row's header, or an index chip of an article shown beside, asks again for its window.
    act(() => s().openBeside(practiceId, refs[0]));
    expect(overlayShown()).toBe(false);
    expect(windows()[0]).toHaveFocus();
  });

  it('a window opening while the overlay is open («Apri accanto» pressed in it) closes it', () => {
    const { practiceId, refs } = practiceWithWindows(2);
    render(row());
    fireEvent.click(screen.getByTestId('practice-rail'));
    expect(overlayShown()).toBe(true);
    const { actId } = s().addArticlesToPractice(practiceId, L24, [article(L24, '9')]);
    act(() => s().openBeside(practiceId, besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(article(L24, '9')) })));
    expect(s().practices[0].beside.map((b) => b.id)).not.toContain(refs[0].id);
    expect(overlayShown()).toBe(false);
  });

  it('a press in a link popup portalled out of the table (a citation preview) leaves the overlay open', () => {
    practiceWithWindows(2);
    render(<>
      {row()}
      <CitationPreviewPopup
        isVisible isLoading={false} error={null} citation={{ act_type: 'codice civile', article: '2043', confidence: 1 }}
        article={null} position={{ top: 0, left: 0 }} onClose={vi.fn()} onOpenCitation={vi.fn()}
      />
    </>);
    fireEvent.click(screen.getByTestId('practice-rail'));
    fireEvent.pointerDown(screen.getByRole('tooltip'));
    expect(overlayShown()).toBe(true);
  });

  it('the rail names the overlay it opens, and opening it moves focus in; a reveal opens no overlay and takes no focus', () => {
    const { practiceId, actId } = practiceWithWindows(2);
    render(row());
    const rail = screen.getByTestId('practice-rail');
    fireEvent.click(rail);
    const overlay = screen.getByTestId('reading-row-overlay');
    expect(rail).toHaveAttribute('aria-controls', overlay.id);
    expect(within(overlay).getByRole('button', { name: 'Dentro il tavolo' })).toHaveFocus();
    fireEvent.click(rail);
    expect(overlayShown()).toBe(false);

    rail.focus();
    act(() => { s().revealPracticeArticle(practiceId, actId, '7'); });
    expect(overlayShown()).toBe(false);
    expect(rail).toHaveFocus();
  });

  it('is closed by a room for the table again, and by switching practice', () => {
    const { practiceId } = practiceWithWindows(2);
    const other = s().createPractice('Altra');
    s().setActivePractice(practiceId);
    render(row());
    fireEvent.click(screen.getByTestId('practice-rail'));
    resizeTo(1400);
    expect(overlayShown()).toBe(false);
    resizeTo(1100);
    expect(overlayShown()).toBe(false);

    fireEvent.click(screen.getByTestId('practice-rail'));
    act(() => s().setActivePractice(other));
    act(() => s().setActivePractice(practiceId));
    expect(overlayShown()).toBe(false);
  });

  it('a reveal of a row folded by its window opens no overlay: the window is focused instead', () => {
    const { practiceId, actId } = practiceWithWindows(2);
    render(row());
    act(() => { s().revealPracticeArticle(practiceId, actId, '5'); });
    expect(overlayShown()).toBe(false);
    expect(windows()[0]).toHaveFocus();
  });

  it('a row revealed while the index is folded opens beside (U2): the overlay stays closed', () => {
    const { practiceId, actId, refs } = practiceWithWindows(2);
    render(row());
    expect(overlayShown()).toBe(false);
    act(() => { s().revealPracticeArticle(practiceId, actId, '7'); });
    expect(overlayShown()).toBe(false);
    expect(windows().map((w) => w.getAttribute('data-window-id'))).toEqual([
      refs[1].id, besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(article(L24, '7')) }).id,
    ]);
  });
});

describe('ReadingRow — where the find window opens (spec §4.4)', () => {
  const win = () => screen.getByTestId('find-window');
  const placeOf = () => ({ x: parseFloat(win().style.left), y: parseFloat(win().style.top) });

  it('with no window: the table column\'s top right, under the practice header, the act\'s heading and the open row\'s toolbar', () => {
    practiceWithWindows(0);
    render(<>{row()}<FindWindow /></>);
    act(() => openFindWindow());
    // Column 100..1400; header 50..110, heading 122..172, toolbar 172..212 (the later row's toolbar is not in the stack).
    expect(placeOf()).toEqual({ x: 1400 - 420 - 16, y: 212 + 8 });
  });

  it('scrolled: under the heading and the toolbar stuck at the top, the header being gone', () => {
    scrolled = true;
    practiceWithWindows(0);
    render(<>{row()}<FindWindow /></>);
    act(() => openFindWindow());
    expect(placeOf()).toEqual({ x: 1400 - 420 - 16, y: 90 + 8 });
  });

  it('in the reading view (U2): the first window\'s body, under its header and its pinned compact bar', () => {
    areaWidth = 1400;
    practiceWithWindows(1);
    render(<>{row()}<FindWindow /></>);
    act(() => openFindWindow());
    // The index 100..420; the window 420..1500, its body from 436, from 94; its bar 94..134.
    expect(placeOf()).toEqual({ x: 1500 - 420 - 16, y: 134 + 8 });
  });

  it('never on the index, narrower than the find window, and never over a window\'s ×: below its header', () => {
    areaWidth = 1260;
    practiceWithWindows(2);
    render(<>{row()}<FindWindow /></>);
    act(() => openFindWindow());
    // The index 100..420, the first window 420..890: its body ends at 890.
    expect(placeOf()).toEqual({ x: 890 - 420 - 16, y: 134 + 8 });
    expect(placeOf().x).toBeGreaterThan(100 + 320);
    expect(placeOf().y).toBeGreaterThan(AREA_TOP + 44);
  });

  it('with the rail: at the first window\'s body, under its header and its pinned compact bar', () => {
    areaWidth = 1100;
    practiceWithWindows(2);
    render(<>{row()}<FindWindow /></>);
    act(() => openFindWindow());
    // First window: column 148..674, body from 164 (the column\'s 16 px gap) to 674, from 94; its bar 94..134.
    expect(placeOf()).toEqual({ x: 674 - 420 - 16, y: 134 + 8 });
  });

  it('with the rail and a decision as the first window: under its pinned reading bar too', () => {
    areaWidth = 1100;
    const { practiceId, refs } = practiceWithWindows(0);
    s().openBeside(practiceId, refs[1]);
    s().openBeside(practiceId, refs[0]);
    render(<>{row()}<FindWindow /></>);
    act(() => openFindWindow());
    // First window (the decision): body from 94, its bar 94..134.
    expect(screen.getAllByTestId('reading-window')[0]).toContainElement(screen.getByTestId('stub-decision-toolbar'));
    expect(placeOf()).toEqual({ x: 674 - 420 - 16, y: 134 + 8 });
  });

  it('a stack too deep for the screen falls back to the first group: header, first heading, pinned bar', () => {
    env.deepStack = true;
    practiceWithWindows(0);
    window.innerHeight = 300;
    render(<>{row()}<FindWindow /></>);
    act(() => openFindWindow());
    // The full chain ends at 312: 312 + 8 + 80 is past the 300 px screen. The first group ends at 212.
    expect(placeOf()).toEqual({ x: 1400 - 420 - 16, y: 212 + 8 });
  });

  it('a deep stack that fits is followed to its end', () => {
    env.deepStack = true;
    practiceWithWindows(0);
    window.innerHeight = 900;
    render(<>{row()}<FindWindow /></>);
    act(() => openFindWindow());
    expect(placeOf().y).toBe(312 + 8);
  });

  it('a place the user dragged it to wins', () => {
    areaWidth = 1400;
    practiceWithWindows(1);
    sessionStorage.setItem('visualex:find-window-place', JSON.stringify({ x: 20, y: 30 }));
    render(<>{row()}<FindWindow /></>);
    act(() => openFindWindow());
    expect(placeOf()).toEqual({ x: 20, y: 30 });
  });

  it('takes the table\'s place when the last window closes, and goes back to PR 4d\'s when the row goes', () => {
    areaWidth = 1400;
    const { practiceId, refs } = practiceWithWindows(1);
    const { unmount } = render(<>{row()}<FindWindow /></>);
    act(() => openFindWindow());
    expect(placeOf()).toEqual({ x: 1500 - 420 - 16, y: 134 + 8 });
    act(() => closeFindWindow());
    act(() => s().closeBeside(practiceId, refs[0].id));
    act(() => openFindWindow());
    expect(placeOf()).toEqual({ x: 1500 - 420 - 16, y: 220 });
    act(() => closeFindWindow());

    act(() => s().openBeside(practiceId, refs[0]));
    unmount();
    render(<FindWindow />);
    act(() => openFindWindow());
    expect(placeOf().y).toBe(16);
  });
});
