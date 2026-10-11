import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Spies over the real functions, to count how often a recompute runs and how often a stored text is
// folded; everything else in both modules is the real thing.
vi.mock('../utils/findScope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/findScope')>();
  return { ...actual, findTargetsInScope: vi.fn(actual.findTargetsInScope) };
});
vi.mock('../utils/findInText', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/findInText')>();
  return { ...actual, foldForSearch: vi.fn(actual.foldForSearch) };
});

import { appStore } from '../store/useAppStore';
import type { ArticleData, NormaVisitata } from '../types';
import { buildItemKey } from '../utils/normaKeys';
import { versionKey } from '../utils/versionDisplay';
import { registerFindRoot } from '../utils/findTargets';
import { findTargetsInScope } from '../utils/findScope';
import { foldForSearch } from '../utils/findInText';
import { FakeHighlight } from '../utils/__fixtures__/openFind';
import { useFindWindow, type UseFindWindow } from './useFindWindow';

const g = globalThis as unknown as Record<string, unknown>;
let registry: Map<string, FakeHighlight>;
let saved: { css: unknown; highlight: unknown; matchMedia: typeof window.matchMedia; scrollIntoView: unknown };
let latest: UseFindWindow;
let scrolled: ReturnType<typeof vi.fn>;

function Harness({
  query,
  scope,
  open,
  prefer,
}: {
  query: string;
  scope: 'tab' | 'all';
  open: boolean;
  prefer?: { tabId: string; targetKey?: string } | null;
}) {
  const result = useFindWindow({ query, scope, open, prefer });
  useEffect(() => {
    latest = result;
  });
  return null;
}

async function settle(ms = 200) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function currentRange(): Range | undefined {
  return registry.get('vlx-find-current')?.ranges[0];
}

function currentText(): string | undefined {
  return currentRange()?.toString();
}

/** The viewport the hook reads (`useIsDesktop`): a desktop unless a test says otherwise. */
function viewport(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const norma = (numero_articolo: string): NormaVisitata => ({ tipo_atto: 'codice civile', data: '', numero_articolo });
const NORMA_1 = norma('1');
const NORMA_2 = norma('2');
const NORMA_3 = norma('3');

function article(n: NormaVisitata, text: string): ArticleData {
  return { article_text: text, norma_data: n };
}

function targetKeyOf(n: NormaVisitata): string {
  return `${buildItemKey(n)}|${versionKey(n)}`;
}

const cleanups: Array<() => void> = [];

/** Simulates `ArticleTabContent` mounting its text root for `n` in `tabId`: an element in the
 *  document, holding `html`, registered under the key `findScope` computes for that article. */
function mountRoot(tabId: string, n: NormaVisitata, html: string): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.appendChild(element);
  cleanups.push(registerFindRoot({ tabId, targetKey: targetKeyOf(n), label: 'art.', element }));
  return element;
}

function addTab(label: string, n: NormaVisitata, text: string, flags: { minimised?: boolean } = {}): string {
  const id = appStore.getState().addWorkspaceTab(label, n, [article(n, text)]);
  if (flags.minimised) {
    appStore.setState((s) => ({ workspaceTabs: s.workspaceTabs.map((t) => (t.id === id ? { ...t, isMinimized: true } : t)) }));
  }
  return id;
}

/** Spies on the store actions that can move the reader. */
function spyMoves() {
  const spies = {
    revealTab: vi.fn(appStore.getState().revealTab),
    bringTabToFront: vi.fn(appStore.getState().bringTabToFront),
    focusArticleInTab: vi.fn(appStore.getState().focusArticleInTab),
  };
  appStore.setState(spies);
  return spies;
}

const originalActions = {
  revealTab: appStore.getState().revealTab,
  bringTabToFront: appStore.getState().bringTabToFront,
  focusArticleInTab: appStore.getState().focusArticleInTab,
};

beforeEach(() => {
  vi.useFakeTimers();
  appStore.setState({ workspaceTabs: [], highestZIndex: 0, mobileActiveTabId: null, ...originalActions });
  saved = {
    css: g.CSS,
    highlight: g.Highlight,
    matchMedia: window.matchMedia,
    scrollIntoView: (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView,
  };
  registry = new Map();
  g.CSS = { highlights: registry };
  g.Highlight = FakeHighlight;
  viewport(true);
  scrolled = vi.fn();
  (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView = scrolled;
  vi.mocked(findTargetsInScope).mockClear();
  vi.mocked(foldForSearch).mockClear();
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  vi.useRealTimers();
  g.CSS = saved.css;
  g.Highlight = saved.highlight;
  window.matchMedia = saved.matchMedia;
  (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView = saved.scrollIntoView;
  document.body.innerHTML = '';
  appStore.setState({ workspaceTabs: [], mobileActiveTabId: null, ...originalActions });
});

describe('useFindWindow — what is counted and drawn', () => {
  it('counts matches drawn on screen and matches only stored together, and draws only the ones on screen', async () => {
    const tabId = appStore.getState().addWorkspaceTab('Codice civile', NORMA_1, [
      article(NORMA_1, 'il fatto e certo'),
      article(NORMA_2, 'anche qui un fatto'),
    ]);
    mountRoot(tabId, NORMA_1, 'il fatto e certo');

    render(<Harness query="fatto" scope="all" open />);
    await settle();

    expect(latest.count).toBe(2);
    expect(latest.searched).toBe(true);
    // One drawn match, the current one (`vlx-find` holds the others): the stored one is not painted.
    expect(registry.get('vlx-find')).toBeUndefined();
    expect(registry.get('vlx-find-current')?.ranges).toHaveLength(1);
    expect(currentText()?.toLowerCase()).toBe('fatto');
  });

  it('orders the matches by tab as the dock orders them', async () => {
    const a = addTab('A', NORMA_1, 'fatto a', { minimised: true });
    const b = addTab('B', NORMA_2, 'fatto b', { minimised: true });
    const c = addTab('C', NORMA_3, 'fatto c', { minimised: true });
    // The dock's order is the store's: C moved first.
    appStore.getState().reorderWorkspaceTabs(2, 0);

    render(<Harness query="fatto" scope="all" open />);
    await settle();
    const seen = [latest.current?.tabId];
    act(() => latest.next());
    seen.push(latest.current?.tabId);
    act(() => latest.next());
    seen.push(latest.current?.tabId);

    expect(seen).toEqual([c, a, b]);
  });

  it('wraps from the last match to the first', async () => {
    const tabId = addTab('Codice civile', NORMA_1, 'fatto uno fatto due');
    mountRoot(tabId, NORMA_1, 'fatto uno fatto due');

    render(<Harness query="fatto" scope="all" open />);
    await settle();
    expect(latest.count).toBe(2);
    expect(latest.index).toBe(0);
    act(() => latest.next());
    expect(latest.index).toBe(1);
    act(() => latest.next());
    expect(latest.index).toBe(0);
  });
});

describe('useFindWindow — typing never moves the reader', () => {
  it('takes the front tab\'s first match, a drawn one first, and scrolls only to it', async () => {
    // A, first in the dock, has a drawn match; B is in front, with a stored match first and a drawn one after.
    const a = addTab('A', NORMA_3, 'un fatto in A');
    mountRoot(a, NORMA_3, 'un fatto in A');
    const b = appStore.getState().addWorkspaceTab('B', NORMA_1, [article(NORMA_1, 'fatto non disegnato'), article(NORMA_2, 'fatto disegnato')]);
    const drawnB = mountRoot(b, NORMA_2, '<p>fatto disegnato</p>');
    const moves = spyMoves();

    render(<Harness query="fatto" scope="all" open />);
    await settle();

    expect(latest.count).toBe(3);
    expect(latest.current).toMatchObject({ tabId: b, targetKey: targetKeyOf(NORMA_2), onScreen: true });
    expect(latest.index).toBe(2);
    expect(currentRange()?.startContainer).toBe(drawnB.querySelector('p')!.firstChild);
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(moves.revealTab).not.toHaveBeenCalled();
    expect(moves.bringTabToFront).not.toHaveBeenCalled();
    expect(moves.focusArticleInTab).not.toHaveBeenCalled();
  });

  it('with no match in the front tab, the first match overall is current but nothing is raised or shown', async () => {
    const front = addTab('Davanti', NORMA_1, 'niente qui');
    mountRoot(front, NORMA_1, 'niente qui');
    const away = addTab('Altrove', NORMA_2, 'un fatto altrove', { minimised: true });
    appStore.getState().bringTabToFront(front);
    const moves = spyMoves();

    render(<Harness query="fatto" scope="all" open />);
    await settle();

    expect(latest.count).toBe(1);
    expect(latest.current).toEqual({ tabId: away, targetKey: targetKeyOf(NORMA_2), label: 'art. 2 c.c.', onScreen: false });
    expect(moves.revealTab).not.toHaveBeenCalled();
    expect(moves.bringTabToFront).not.toHaveBeenCalled();
    expect(moves.focusArticleInTab).not.toHaveBeenCalled();
    expect(scrolled).not.toHaveBeenCalled();
    expect(appStore.getState().workspaceTabs.find((t) => t.id === away)?.isMinimized).toBe(true);

    // A recompute (the workspace changes) does not move the reader either.
    act(() => appStore.getState().addWorkspaceTab('Vuota'));
    await settle(50);
    expect(moves.revealTab).not.toHaveBeenCalled();
    expect(moves.focusArticleInTab).not.toHaveBeenCalled();
  });
});

describe('useFindWindow — going to an undrawn match', () => {
  it('next() reveals its tab and shows the article, and the match becomes current once a root registers for it', async () => {
    const front = addTab('Davanti', NORMA_2, 'un fatto qui');
    mountRoot(front, NORMA_2, 'un fatto qui');
    const away = addTab('Altrove', NORMA_1, 'il fatto e certo', { minimised: true });
    appStore.getState().bringTabToFront(front);
    const moves = spyMoves();

    render(<Harness query="fatto" scope="all" open />);
    await settle();
    expect(latest.current?.tabId).toBe(front);

    act(() => latest.next());
    expect(latest.current).toEqual({ tabId: away, targetKey: targetKeyOf(NORMA_1), label: 'art. 1 c.c.', onScreen: false });
    expect(moves.revealTab).toHaveBeenCalledExactlyOnceWith(away);
    expect(moves.focusArticleInTab).toHaveBeenCalledWith(away, '1');
    expect(moves.bringTabToFront).not.toHaveBeenCalled();
    expect(appStore.getState().workspaceTabs.find((t) => t.id === away)?.isMinimized).toBe(false);
    expect(currentRange()).toBeUndefined();

    // The article's surface mounts (what revealing the tab causes): its root registers.
    act(() => {
      mountRoot(away, NORMA_1, 'il fatto e certo');
    });
    await settle(50);

    expect(latest.current?.onScreen).toBe(true);
    expect(latest.index).toBe(1);
    expect(currentText()?.toLowerCase()).toBe('fatto');
    expect(moves.revealTab).toHaveBeenCalledTimes(1);
  });

  it('gives a target up after 3 s with no root: it is revealed once, the window moves once, and navigation skips it', async () => {
    const front = addTab('Davanti', NORMA_2, 'un fatto qui');
    mountRoot(front, NORMA_2, 'un fatto qui');
    const away = addTab('Altrove', NORMA_1, 'il fatto mai disegnato', { minimised: true });
    appStore.getState().bringTabToFront(front);
    const moves = spyMoves();

    render(<Harness query="fatto" scope="all" open />);
    await settle();
    act(() => latest.next());
    expect(latest.current?.tabId).toBe(away);
    expect(moves.revealTab).toHaveBeenCalledTimes(1);

    await settle(2900);
    expect(latest.current?.tabId).toBe(away);
    await settle(200);
    // Moved once, forward: it wraps to the drawn match in front.
    expect(latest.current).toMatchObject({ tabId: front, onScreen: true });
    expect(latest.index).toBe(0);

    await settle(10_000);
    act(() => latest.next());
    await settle(10_000);
    expect(latest.current?.tabId).toBe(front);
    expect(moves.revealTab).toHaveBeenCalledTimes(1);
    expect(moves.bringTabToFront).not.toHaveBeenCalled();
    // Given up, so no longer counted: the counter counts what can be reached.
    expect(latest.count).toBe(1);
    expect(latest.index).toBe(0);
  });

  it('a given-up target leaves the counter even when there is nowhere else to go', async () => {
    const away = addTab('Altrove', NORMA_1, 'il fatto mai disegnato', { minimised: true });
    render(<Harness query="fatto" scope="all" open />);
    await settle();
    expect(latest.count).toBe(1);
    act(() => latest.next());
    await settle(3100);
    expect(latest.count).toBe(0);
    expect(latest.index).toBe(-1);
    expect(away).toBeTruthy();
  });

  it('a new query tries a given-up target again', async () => {
    const front = addTab('Davanti', NORMA_2, 'un fatto qui');
    mountRoot(front, NORMA_2, 'un fatto qui');
    addTab('Altrove', NORMA_1, 'il fatto mai disegnato', { minimised: true });
    appStore.getState().bringTabToFront(front);
    const moves = spyMoves();

    const { rerender } = render(<Harness query="fatto" scope="all" open />);
    await settle();
    act(() => latest.next());
    await settle(3100);
    // The reader raises the front tab again (the «go to» left the other tab on top).
    act(() => appStore.getState().bringTabToFront(front));
    rerender(<Harness query="fatt" scope="all" open />);
    await settle();
    act(() => latest.next());
    expect(moves.revealTab).toHaveBeenCalledTimes(2);
  });

  it('takes the last drawn match when fewer are drawn than were stored, never the first match', async () => {
    const front = addTab('Davanti', NORMA_2, 'un fatto qui');
    mountRoot(front, NORMA_2, 'un fatto qui');
    // Stored: two matches; drawn: one (the second sits in folded notes the reader does not see).
    const away = addTab('Altrove', NORMA_1, 'fatto uno fatto due', { minimised: true });
    addTab('Ultima', NORMA_3, 'fatto in coda', { minimised: true });
    appStore.getState().bringTabToFront(front);
    spyMoves();

    render(<Harness query="fatto" scope="all" open />);
    await settle();
    act(() => latest.next());
    act(() => latest.next());
    expect(latest.current?.tabId).toBe(away);
    expect(latest.index).toBe(2);

    act(() => {
      mountRoot(away, NORMA_1, '<p>fatto uno</p><p style="display: none">fatto due</p>');
    });
    await settle(50);

    expect(latest.count).toBe(3);
    expect(latest.current).toMatchObject({ tabId: away, onScreen: true });
    expect(latest.index).toBe(1);
    expect(currentText()).toBe('fatto');
  });

  it('with no match drawn at all, goes on in the direction of travel as a step would', async () => {
    const front = addTab('Davanti', NORMA_2, 'un fatto qui');
    mountRoot(front, NORMA_2, 'un fatto qui');
    const away = addTab('Altrove', NORMA_1, 'fatto', { minimised: true });
    const last = addTab('Ultima', NORMA_3, 'fatto in coda', { minimised: true });
    appStore.getState().bringTabToFront(front);
    const moves = spyMoves();

    render(<Harness query="fatto" scope="all" open />);
    await settle();
    act(() => latest.next());
    expect(latest.current?.tabId).toBe(away);

    act(() => {
      mountRoot(away, NORMA_1, '<p>fat</p><p>to</p>');
    });
    await settle(50);

    expect(latest.count).toBe(2);
    expect(latest.current).toMatchObject({ tabId: last, onScreen: false });
    expect(latest.index).toBe(1);
    expect(moves.revealTab).toHaveBeenLastCalledWith(last);
    expect(moves.revealTab).toHaveBeenCalledTimes(2);
  });

  it('going back, with no match drawn, goes on backwards', async () => {
    const first = addTab('Prima', NORMA_3, 'fatto in testa', { minimised: true });
    const away = addTab('Altrove', NORMA_1, 'fatto', { minimised: true });
    const front = addTab('Davanti', NORMA_2, 'un fatto qui');
    mountRoot(front, NORMA_2, 'un fatto qui');
    const moves = spyMoves();

    render(<Harness query="fatto" scope="all" open />);
    await settle();
    expect(latest.current?.tabId).toBe(front);
    act(() => latest.previous());
    expect(latest.current?.tabId).toBe(away);

    act(() => {
      mountRoot(away, NORMA_1, 'niente');
    });
    await settle(50);

    expect(latest.current?.tabId).toBe(first);
    expect(moves.revealTab).toHaveBeenLastCalledWith(first);
  });
});

describe('useFindWindow — kept current', () => {
  it('keeps the current match when a drawn root is redrawn with new nodes before it', async () => {
    const tabId = addTab('Codice civile', NORMA_1, 'fatto uno fatto due');
    const element = mountRoot(tabId, NORMA_1, '<p>fatto uno</p><p>fatto due</p>');

    render(<Harness query="fatto" scope="all" open />);
    await settle();
    act(() => latest.next());
    expect(latest.index).toBe(1);
    expect(currentRange()?.startContainer.textContent).toBe('fatto due');

    // Redrawn: every node replaced, a new paragraph with a match before the current one.
    await act(async () => {
      element.innerHTML = '<p>prima un fatto</p><p>fatto uno</p><p>fatto due</p>';
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(latest.count).toBe(3);
    expect(latest.index).toBe(2);
    expect(currentRange()?.startContainer).toBe(element.querySelectorAll('p')[2].firstChild);
  });

  it('moves to the next match, not the first, when the current one goes away', async () => {
    const a = addTab('A', NORMA_1, 'fatto a');
    mountRoot(a, NORMA_1, 'fatto a');
    const b = addTab('B', NORMA_2, 'fatto b');
    const rootB = mountRoot(b, NORMA_2, '<p>fatto b</p>');
    const c = addTab('C', NORMA_3, 'fatto c');
    mountRoot(c, NORMA_3, 'fatto c');
    appStore.getState().bringTabToFront(a);

    render(<Harness query="fatto" scope="all" open />);
    await settle();
    act(() => latest.next());
    expect(latest.current?.tabId).toBe(b);

    await act(async () => {
      rootB.innerHTML = '<p>niente</p>';
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(latest.count).toBe(2);
    expect(latest.current?.tabId).toBe(c);
  });

  it('coalesces workspace changes and registrations into one recompute per frame', async () => {
    const tabId = addTab('Codice civile', NORMA_1, 'il fatto');
    mountRoot(tabId, NORMA_1, 'il fatto');

    render(<Harness query="fatto" scope="all" open />);
    await settle();
    vi.mocked(findTargetsInScope).mockClear();

    act(() => {
      appStore.getState().addWorkspaceTab('Uno');
      appStore.getState().addWorkspaceTab('Due');
      appStore.getState().bringTabToFront(tabId);
      mountRoot(tabId, NORMA_2, 'altro');
      mountRoot(tabId, NORMA_3, 'altro ancora');
    });
    await settle(50);

    expect(vi.mocked(findTargetsInScope)).toHaveBeenCalledTimes(1);
  });

  it('folds a stored text once, however many times the window recomputes', async () => {
    addTab('Altrove', NORMA_1, 'un fatto conservato', { minimised: true });

    render(<Harness query="fatto" scope="all" open />);
    await settle();
    const storedFolds = () => vi.mocked(foldForSearch).mock.calls.filter(([t]) => t === 'un fatto conservato').length;
    expect(storedFolds()).toBe(1);

    for (const label of ['Uno', 'Due', 'Tre']) {
      act(() => {
        appStore.getState().addWorkspaceTab(label);
      });
      await settle(50);
    }
    expect(storedFolds()).toBe(1);
  });

  it('never changes the text DOM, node identity included, before, during and after a search', async () => {
    const tabId = addTab('Codice civile', NORMA_1, 'il fatto e certo. altro fatto');
    const element = mountRoot(
      tabId,
      NORMA_1,
      '<div class="vlx-b"><span>il </span><b>fatto</b> e <i>certo.</i><span class="vlx-sign"></span></div><div class="vlx-b">altro <mark>fatto</mark></div>',
    );
    const nodesOf = () => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_ALL);
      const nodes: Node[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
      return nodes;
    };
    const html = element.innerHTML;
    const nodes = nodesOf();
    const values = nodes.map((n) => n.nodeValue);

    const { rerender } = render(<Harness query="fatto" scope="all" open />);
    await settle();
    expect(latest.count).toBe(2);
    act(() => latest.next());
    act(() => latest.previous());
    expect(element.innerHTML).toBe(html);
    rerender(<Harness query="fatto" scope="all" open={false} />);
    await settle();

    expect(element.innerHTML).toBe(html);
    const after = nodesOf();
    expect(after).toHaveLength(nodes.length);
    after.forEach((n, i) => {
      expect(n).toBe(nodes[i]);
      expect(n.nodeValue).toBe(values[i]);
    });
    expect(registry.size).toBe(0);
  });
});

describe('useFindWindow — «Questa scheda»', () => {
  it('searches only the front tab on a desktop', async () => {
    addTab('Altro', NORMA_2, 'un fatto altrove');
    const front = addTab('Codice civile', NORMA_1, 'il fatto qui');
    appStore.getState().bringTabToFront(front);
    mountRoot(front, NORMA_1, 'il fatto qui');

    render(<Harness query="fatto" scope="tab" open />);
    await settle();

    expect(latest.count).toBe(1);
    expect(latest.current?.tabId).toBe(front);
  });

  it('searches the tab on screen on a phone, whatever was raised last, and follows a swipe', async () => {
    viewport(false);
    const shown = addTab('Sullo schermo', NORMA_1, 'fatto uno fatto due');
    const raised = addTab('Alzata', NORMA_2, 'un fatto');
    appStore.getState().bringTabToFront(raised);
    appStore.getState().setMobileActiveTabId(shown);

    render(<Harness query="fatto" scope="tab" open />);
    await settle();
    expect(latest.count).toBe(2);
    expect(latest.current?.tabId).toBe(shown);

    act(() => appStore.getState().setMobileActiveTabId(raised));
    await settle(50);
    expect(latest.count).toBe(1);
    expect(latest.current?.tabId).toBe(raised);
  });
});

describe('useFindWindow — starting in a given tab', () => {
  it('a fresh query starts at the preferred target\'s first match, drawn first, not at the front tab\'s', async () => {
    const a = addTab('A', NORMA_1, 'un fatto in A');
    mountRoot(a, NORMA_1, 'un fatto in A');
    const b = addTab('B', NORMA_2, 'fatto uno, fatto due');
    mountRoot(b, NORMA_2, 'fatto uno, fatto due');
    appStore.getState().bringTabToFront(b);
    const moves = spyMoves();

    render(<Harness query="fatto" scope="all" open prefer={{ tabId: a, targetKey: targetKeyOf(NORMA_1) }} />);
    await settle();

    expect(latest.current).toMatchObject({ tabId: a, onScreen: true });
    expect(latest.index).toBe(0);
    expect(moves.revealTab).not.toHaveBeenCalled();
  });

  it('restart() applies the held query again as a fresh one, now', async () => {
    const a = addTab('A', NORMA_1, 'un fatto in A');
    mountRoot(a, NORMA_1, 'un fatto in A');
    const b = addTab('B', NORMA_2, 'fatto uno, fatto due');
    mountRoot(b, NORMA_2, 'fatto uno, fatto due');
    appStore.getState().bringTabToFront(b);

    const { rerender } = render(<Harness query="fatto" scope="all" open />);
    await settle();
    expect(latest.current?.tabId).toBe(b);

    rerender(<Harness query="fatto" scope="all" open prefer={{ tabId: a }} />);
    act(() => latest.restart());
    expect(latest.current?.tabId).toBe(a);
    expect(latest.index).toBe(0);
  });
});

describe('useFindWindow — targets that cannot be reached', () => {
  it('does not bounce between two targets whose drawn text lacks the stored match', async () => {
    const front = addTab('Davanti', NORMA_3, 'niente qui');
    mountRoot(front, NORMA_3, 'niente qui');
    const x = addTab('X', NORMA_1, 'fatto', { minimised: true });
    addTab('Y', NORMA_2, 'fatto', { minimised: true });
    appStore.getState().bringTabToFront(front);
    // The carousel / the active article: revealing one target draws it and unmounts the other, and what is
    // drawn is split in two blocks, so the stored match is not there.
    const drawnRoots = new Map<string, () => void>();
    const reveal = vi.fn((id: string) => {
      for (const [other, off] of drawnRoots) {
        off();
        drawnRoots.delete(other);
      }
      const n = id === x ? NORMA_1 : NORMA_2;
      const element = document.createElement('div');
      element.innerHTML = '<p>fat</p><p>to</p>';
      document.body.appendChild(element);
      drawnRoots.set(id, registerFindRoot({ tabId: id, targetKey: targetKeyOf(n), label: 'art.', element }));
    });
    appStore.setState({ revealTab: reveal });

    render(<Harness query="fatto" scope="all" open />);
    await settle();
    act(() => latest.next());
    await settle(20_000);

    expect(reveal.mock.calls.length).toBeLessThanOrEqual(3);
    for (const off of drawnRoots.values()) off();
  });

  it('a given-up target is reachable again when its root registers with drawn matches', async () => {
    addTab('Davanti', NORMA_3, 'niente qui');
    const x = addTab('X', NORMA_1, 'fatto', { minimised: true });
    render(<Harness query="fatto" scope="all" open />);
    await settle();
    act(() => latest.next());
    await settle(3100);
    expect(latest.count).toBe(0);

    mountRoot(x, NORMA_1, 'un fatto');
    await settle();
    expect(latest.count).toBe(1);
    expect(latest.current).toMatchObject({ tabId: x, onScreen: true });
  });
});
