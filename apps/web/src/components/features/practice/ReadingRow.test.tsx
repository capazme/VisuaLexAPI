import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('./PracticeTable', () => ({
  PracticeTable: () => (
    <div data-testid="practice-table">
      <header data-pinned-head data-testid="stub-practice-head">La pratica</header>
      <div data-pinned-head data-testid="stub-act-head">Atto</div>
      <div data-pinned-head data-testid="stub-toolbar">Barra della riga aperta</div>
      <div data-pinned-head data-testid="stub-toolbar-later">Barra di una riga più in basso</div>
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
    <div data-testid="decision-reader" data-host={hostId} data-find-host={findHostId} />
  ),
}));
vi.mock('../decisions/DecisionSearchTabView', () => ({
  DecisionSearchTabView: ({ tabId }: { tabId: string }) => <div data-testid="topic-list" data-tab={tabId} />,
}));

import { appStore } from '../../../store/useAppStore';
import { FindWindow } from '../search/FindWindow';
import { closeFindWindow, openFindWindow, setFindWindowDefaultPlace } from '../../../utils/findWindowControl';
import { FOUND, L24, L241, article } from '../../../utils/__fixtures__/savedWorkspaces';
import { besideRefFor, practiceArticleKey, type BesideRef } from '../../../utils/practice';
import { ReadingRow } from './ReadingRow';

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
  if (column && id === 'stub-window-toolbar') return box(columnLeft(column) + 16, AREA_TOP + 44, pxOf(column) - 16, 40);
  const table = this.closest('[data-testid="reading-row-table"]');
  if (table) {
    const left = columnLeft(table);
    const width = pxOf(table) || areaWidth;
    // Unscrolled: the practice header 50..110, 12 px, the act's heading 122..172, its open row's toolbar 172..212.
    if (id === 'stub-practice-head') return box(left, scrolled ? -200 : AREA_TOP, width, 60);
    if (id === 'stub-act-head') return box(left, scrolled ? 0 : 122, width, 50);
    if (id === 'stub-toolbar') return box(left, scrolled ? 50 : 172, width, 40);
    if (id === 'stub-toolbar-later') return box(left, 600, width, 40);
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
  for (const ref of refs.slice(0, count)) s().openBeside(practiceId, ref);
  return { practiceId, actId, decisionId, refs };
}

const row = () => <ReadingRow onViewPdf={vi.fn()} onCrossReference={vi.fn()} streaming={null} />;
const windows = () => screen.queryAllByTestId('reading-window');
const widthOf = (testId: string, index = 0) => (screen.getAllByTestId(testId)[index] as HTMLElement).style.width;

beforeEach(() => {
  areaWidth = 1300;
  scrolled = false;
  FakeResizeObserver.all = [];
  vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(fakeRect);
  window.innerWidth = 1920;
  sessionStorage.clear();
  appStore.setState({
    practices: [], activePracticeId: null, practicesSeeded: true, practiceRows: {}, pendingReveal: null,
    readingBackStack: [], workspaceTabs: [],
  });
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
    s().openDecisionSearchTab({ tema: 'danno' }, 'Danno', { besideTabId: practiceId });
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
    expect(practice.acts[0].articles).toHaveLength(1);
    expect(practice.decisions).toHaveLength(1);
  });
});

describe('ReadingRow — widths (besideLayout)', () => {
  it('one window: half and half', () => {
    areaWidth = 1280;
    practiceWithWindows(1);
    render(row());
    expect(widthOf('reading-row-table')).toBe('640px');
    expect(widthOf('reading-row-window')).toBe('640px');
  });

  it('two windows: three columns when each gets 420 px', () => {
    areaWidth = 1300;
    practiceWithWindows(2);
    render(row());
    expect(widthOf('reading-row-table')).toBe('434px');
    expect(widthOf('reading-row-window', 0)).toBe('433px');
    expect(widthOf('reading-row-window', 1)).toBe('433px');
    expect(screen.queryByTestId('practice-rail')).not.toBeInTheDocument();
  });

  it('follows the area when it is resized: thirds fold into the rail and unfold again', () => {
    practiceWithWindows(2);
    render(row());
    expect(screen.getByTestId('practice-table')).toBeInTheDocument();
    resizeTo(1100);
    expect(screen.queryByTestId('practice-table')).not.toBeInTheDocument();
    expect(screen.getByTestId('practice-rail')).toBeInTheDocument();
    expect(widthOf('reading-row-rail')).toBe('48px');
    expect(widthOf('reading-row-window', 0)).toBe('526px');
    expect(widthOf('reading-row-window', 1)).toBe('526px');
    resizeTo(1400);
    expect(screen.getByTestId('practice-table')).toBeInTheDocument();
    expect(screen.queryByTestId('practice-rail')).not.toBeInTheDocument();
  });
});

describe('ReadingRow — the rail (spec §4.3)', () => {
  beforeEach(() => {
    areaWidth = 1100;
  });

  it('shows the count of texts and the practice\'s name, with the table folded away', () => {
    practiceWithWindows(2);
    render(row());
    const rail = screen.getByTestId('practice-rail');
    expect(rail).toHaveAccessibleName('Pratica l. 24/2017');
    expect(rail).toHaveAttribute('aria-expanded', 'false');
    expect(within(rail).getByTestId('practice-rail-count')).toHaveTextContent('2');
    expect(screen.queryByTestId('practice-table')).not.toBeInTheDocument();
  });

  it('opens the table as an overlay over the windows; Esc closes it and returns focus to the rail', () => {
    practiceWithWindows(2);
    render(row());
    fireEvent.click(screen.getByTestId('practice-rail'));
    const overlay = screen.getByTestId('reading-row-overlay');
    expect(within(overlay).getByTestId('practice-table')).toBeInTheDocument();
    expect(screen.getByTestId('practice-rail')).toHaveAttribute('aria-expanded', 'true');
    expect(overlay).toHaveClass('z-30');
    expect(windows()).toHaveLength(2);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('reading-row-overlay')).not.toBeInTheDocument();
    expect(screen.getByTestId('practice-rail')).toHaveFocus();
  });

  it('a click outside closes it; a click inside, on the rail again or in what the table opens does not', () => {
    practiceWithWindows(2);
    render(row());
    fireEvent.click(screen.getByTestId('practice-rail'));

    fireEvent.pointerDown(within(screen.getByTestId('reading-row-overlay')).getByRole('button', { name: 'Dentro il tavolo' }));
    expect(screen.getByTestId('reading-row-overlay')).toBeInTheDocument();

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    fireEvent.pointerDown(dialog);
    expect(screen.getByTestId('reading-row-overlay')).toBeInTheDocument();
    dialog.remove();

    fireEvent.pointerDown(within(windows()[0]).getByTestId('article-reader'));
    expect(screen.queryByTestId('reading-row-overlay')).not.toBeInTheDocument();

    // The rail itself toggles it: a press on it is not «outside».
    fireEvent.click(screen.getByTestId('practice-rail'));
    fireEvent.pointerDown(screen.getByTestId('practice-rail'));
    expect(screen.getByTestId('reading-row-overlay')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('practice-rail'));
    expect(screen.queryByTestId('reading-row-overlay')).not.toBeInTheDocument();
  });

  it('Esc under an open modal dialog leaves the overlay open (the dialog takes it)', () => {
    practiceWithWindows(2);
    render(row());
    fireEvent.click(screen.getByTestId('practice-rail'));
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('reading-row-overlay')).toBeInTheDocument();
    modal.remove();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('reading-row-overlay')).not.toBeInTheDocument();
  });

  it('a press in a floating tool (the structure window, the find window) is not a click away', () => {
    practiceWithWindows(2);
    render(row());
    fireEvent.click(screen.getByTestId('practice-rail'));
    const tool = document.createElement('aside');
    tool.setAttribute('data-floating-tool', '');
    document.body.appendChild(tool);
    fireEvent.pointerDown(tool);
    expect(screen.getByTestId('reading-row-overlay')).toBeInTheDocument();
    tool.remove();
  });

  it('the rail names the overlay it opens, and opening it moves focus in; a reveal opening it does not', () => {
    const { practiceId, actId } = practiceWithWindows(2);
    render(row());
    const rail = screen.getByTestId('practice-rail');
    fireEvent.click(rail);
    const overlay = screen.getByTestId('reading-row-overlay');
    expect(rail).toHaveAttribute('aria-controls', overlay.id);
    expect(within(overlay).getByRole('button', { name: 'Dentro il tavolo' })).toHaveFocus();
    fireEvent.click(rail);
    expect(screen.queryByTestId('reading-row-overlay')).not.toBeInTheDocument();

    rail.focus();
    act(() => { s().revealPracticeArticle(practiceId, actId, '5'); });
    expect(screen.getByTestId('reading-row-overlay')).toBeInTheDocument();
    expect(rail).toHaveFocus();
  });

  it('is closed by a room for the table again, and by switching practice', () => {
    const { practiceId } = practiceWithWindows(2);
    const other = s().createPractice('Altra');
    s().setActivePractice(practiceId);
    render(row());
    fireEvent.click(screen.getByTestId('practice-rail'));
    resizeTo(1400);
    expect(screen.queryByTestId('reading-row-overlay')).not.toBeInTheDocument();
    resizeTo(1100);
    expect(screen.queryByTestId('reading-row-overlay')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('practice-rail'));
    act(() => s().setActivePractice(other));
    act(() => s().setActivePractice(practiceId));
    expect(screen.queryByTestId('reading-row-overlay')).not.toBeInTheDocument();
  });

  it('opens by itself when a row is revealed in a practice whose table is folded', () => {
    const { practiceId, actId } = practiceWithWindows(2);
    render(row());
    expect(screen.queryByTestId('reading-row-overlay')).not.toBeInTheDocument();
    act(() => { s().revealPracticeArticle(practiceId, actId, '5'); });
    expect(screen.getByTestId('reading-row-overlay')).toBeInTheDocument();
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

  it('with windows beside: the table column\'s top right, under the same stack and every window\'s header', () => {
    areaWidth = 1400;
    practiceWithWindows(1);
    render(<>{row()}<FindWindow /></>);
    act(() => openFindWindow());
    // Table column: 100..800; the window\'s header ends at 94, the table\'s stack at 212.
    expect(placeOf()).toEqual({ x: 800 - 420 - 16, y: 220 });
  });

  it('never over a window\'s ×: below its header even when the table column is narrower than the window', () => {
    areaWidth = 1260;
    practiceWithWindows(2);
    render(<>{row()}<FindWindow /></>);
    act(() => openFindWindow());
    // The table column is 420 wide, narrower than the window: it starts at the column\'s left edge.
    expect(placeOf()).toEqual({ x: 100, y: 220 });
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

  it('a place the user dragged it to wins', () => {
    areaWidth = 1400;
    practiceWithWindows(1);
    sessionStorage.setItem('visualex:find-window-place', JSON.stringify({ x: 20, y: 30 }));
    render(<>{row()}<FindWindow /></>);
    act(() => openFindWindow());
    expect(placeOf()).toEqual({ x: 20, y: 30 });
  });

  it('keeps the table\'s place when the last window closes, and goes back to PR 4d\'s when the row goes', () => {
    areaWidth = 1400;
    const { practiceId, refs } = practiceWithWindows(1);
    const { unmount } = render(<>{row()}<FindWindow /></>);
    act(() => openFindWindow());
    expect(placeOf().x).toBe(800 - 420 - 16);
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
