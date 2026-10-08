import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appStore } from '../store/useAppStore';
import type { ArticleData, NormaVisitata } from '../types';
import { buildItemKey } from '../utils/normaKeys';
import { versionKey } from '../utils/versionDisplay';
import { registerFindRoot } from '../utils/findTargets';
import { FakeHighlight } from '../utils/__fixtures__/openFind';
import { useFindWindow, type UseFindWindow } from './useFindWindow';

const g = globalThis as unknown as Record<string, unknown>;
let registry: Map<string, FakeHighlight>;
let saved: { css: unknown; highlight: unknown };
let latest: UseFindWindow;

function Harness({ query, scope, open }: { query: string; scope: 'tab' | 'all'; open: boolean }) {
  const result = useFindWindow({ query, scope, open });
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

function currentText(): string | undefined {
  return registry.get('vlx-find-current')?.ranges[0]?.toString();
}

const NORMA_1: NormaVisitata = { tipo_atto: 'codice civile', data: '', numero_articolo: '1' };
const NORMA_2: NormaVisitata = { tipo_atto: 'codice civile', data: '', numero_articolo: '2' };

function article(norma: NormaVisitata, text: string): ArticleData {
  return { article_text: text, norma_data: norma };
}

function targetKeyOf(norma: NormaVisitata): string {
  return `${buildItemKey(norma)}|${versionKey(norma)}`;
}

/** Simulates `ArticleTabContent` mounting its text root for `norma` in `tabId`: an element in the
 *  document, holding `text`, registered under the same key `findScope` computes for that article. */
function mountRoot(tabId: string, norma: NormaVisitata, text: string): { element: HTMLElement; unregister: () => void } {
  const element = document.createElement('div');
  element.textContent = text;
  document.body.appendChild(element);
  const unregister = registerFindRoot({ tabId, targetKey: targetKeyOf(norma), label: 'art.', element });
  return { element, unregister };
}

const cleanups: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  appStore.setState({ workspaceTabs: [], highestZIndex: 0 });
  saved = { css: g.CSS, highlight: g.Highlight };
  registry = new Map();
  g.CSS = { highlights: registry };
  g.Highlight = FakeHighlight;
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  vi.useRealTimers();
  g.CSS = saved.css;
  g.Highlight = saved.highlight;
  document.body.innerHTML = '';
  appStore.setState({ workspaceTabs: [] });
});

describe('useFindWindow', () => {
  it('counts matches drawn on screen and matches only stored together, and draws only the ones on screen', async () => {
    const tabId = appStore.getState().addWorkspaceTab('Codice civile', NORMA_1, [
      article(NORMA_1, 'il fatto e certo'),
      article(NORMA_2, 'anche qui un fatto'),
    ]);
    const { unregister } = mountRoot(tabId, NORMA_1, 'il fatto e certo');
    cleanups.push(unregister);

    render(<Harness query="fatto" scope="all" open />);
    await settle();

    expect(latest.count).toBe(2);
    expect(latest.searched).toBe(true);
    // Only the on-screen article's match is actually painted.
    expect(registry.get('vlx-find-current')).toBeDefined();
    expect(currentText()?.toLowerCase()).toBe('fatto');
  });

  it('going to a stored-only match brings its tab to the front and shows the article, and the match becomes current once a root registers for it', async () => {
    const bringTabToFront = vi.fn(appStore.getState().bringTabToFront);
    const focusArticleInTab = vi.fn(appStore.getState().focusArticleInTab);
    appStore.setState({ bringTabToFront, focusArticleInTab });
    const tabId = appStore.getState().addWorkspaceTab('Codice civile', NORMA_1, [article(NORMA_1, 'il fatto e certo')]);
    // The tab starts minimised: the article's root is not registered (not drawn).
    appStore.setState((s) => ({ workspaceTabs: s.workspaceTabs.map((t) => (t.id === tabId ? { ...t, isMinimized: true } : t)) }));

    render(<Harness query="fatto" scope="all" open />);
    await settle();

    expect(latest.count).toBe(1);
    expect(latest.current).toEqual({ tabId, targetKey: targetKeyOf(NORMA_1), label: 'art. 1 c.c.', onScreen: false });
    expect(bringTabToFront).toHaveBeenCalledWith(tabId);
    expect(focusArticleInTab).toHaveBeenCalledWith(tabId, '1');
    // Not drawn: nothing painted as current yet.
    expect(registry.get('vlx-find-current')).toBeUndefined();

    // The article's surface mounts (what focusArticleInTab's effect would cause): its root registers.
    const { unregister } = await act(async () => {
      const root = mountRoot(tabId, NORMA_1, 'il fatto e certo');
      return root;
    });
    cleanups.push(unregister);
    await settle(0);

    expect(latest.current?.onScreen).toBe(true);
    expect(currentText()?.toLowerCase()).toBe('fatto');
  });

  it('wraps from the last match to the first', async () => {
    const tabId = appStore.getState().addWorkspaceTab('Codice civile', NORMA_1, [article(NORMA_1, 'fatto uno fatto due')]);
    const { unregister } = mountRoot(tabId, NORMA_1, 'fatto uno fatto due');
    cleanups.push(unregister);

    render(<Harness query="fatto" scope="all" open />);
    await settle();
    expect(latest.count).toBe(2);
    expect(latest.index).toBe(0);
    act(() => latest.next());
    expect(latest.index).toBe(1);
    act(() => latest.next());
    expect(latest.index).toBe(0);
  });

  it('keeps the current match when a drawn root redraws', async () => {
    const tabId = appStore.getState().addWorkspaceTab('Codice civile', NORMA_1, [article(NORMA_1, 'fatto uno fatto due')]);
    const { element, unregister } = mountRoot(tabId, NORMA_1, 'fatto uno fatto due');
    cleanups.push(unregister);

    render(<Harness query="fatto" scope="all" open />);
    await settle();
    act(() => latest.next());
    expect(latest.index).toBe(1);
    expect(currentText()?.toLowerCase()).toBe('fatto');

    await act(async () => {
      const p = document.createElement('p');
      p.textContent = 'un altro fatto ancora';
      element.appendChild(p);
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(latest.count).toBe(3);
    expect(latest.index).toBe(1);
  });

  it('never changes the text DOM, before, during or after a search', async () => {
    const tabId = appStore.getState().addWorkspaceTab('Codice civile', NORMA_1, [article(NORMA_1, 'fatto uno fatto due')]);
    const { element, unregister } = mountRoot(tabId, NORMA_1, 'fatto uno fatto due');
    cleanups.push(unregister);
    const before = element.innerHTML;

    render(<Harness query="fatto" scope="all" open />);
    await settle();
    expect(element.innerHTML).toBe(before);
    act(() => latest.next());
    act(() => latest.previous());
    expect(element.innerHTML).toBe(before);
  });

  it('searches only the front tab under «Questa scheda»', async () => {
    const other = appStore.getState().addWorkspaceTab('Altro', NORMA_2, [article(NORMA_2, 'un fatto altrove')]);
    const front = appStore.getState().addWorkspaceTab('Codice civile', NORMA_1, [article(NORMA_1, 'il fatto qui')]);
    void other;
    appStore.getState().bringTabToFront(front);
    const { unregister } = mountRoot(front, NORMA_1, 'il fatto qui');
    cleanups.push(unregister);

    render(<Harness query="fatto" scope="tab" open />);
    await settle();

    expect(latest.count).toBe(1);
    expect(latest.current?.tabId).toBe(front);
  });
});
