import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FindWindow } from './FindWindow';
import { appStore } from '../../../store/useAppStore';
import type { ArticleData, NormaVisitata } from '../../../types';
import { buildItemKey } from '../../../utils/normaKeys';
import { versionKey } from '../../../utils/versionDisplay';
import { registerFindRoot } from '../../../utils/findTargets';
import { closeFindWindow, openFindWindow } from '../../../utils/findWindowControl';
import { useFindWindowScopedTo } from '../../../hooks/useFindWindowScopedTo';
import { FakeHighlight } from '../../../utils/__fixtures__/openFind';

const g = globalThis as unknown as Record<string, unknown>;
let registry: Map<string, FakeHighlight>;
let saved: { css: unknown; highlight: unknown; matchMedia: typeof window.matchMedia; scrollIntoView: unknown };
const cleanups: Array<() => void> = [];

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
const N1 = norma('1');
const N2 = norma('2');
const keyOf = (n: NormaVisitata) => `${buildItemKey(n)}|${versionKey(n)}`;
const article = (n: NormaVisitata, text: string): ArticleData => ({ article_text: text, norma_data: n });

/** A tab with one article drawn on screen: its text root in the document, registered. */
function addDrawnTab(label: string, n: NormaVisitata, text: string): string {
  const id = appStore.getState().addWorkspaceTab(label, n, [article(n, text)]);
  const element = document.createElement('div');
  element.textContent = text;
  document.body.appendChild(element);
  cleanups.push(registerFindRoot({ tabId: id, targetKey: keyOf(n), label: 'art.', element }));
  return id;
}

async function settle(ms = 200) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const field = () => screen.getByRole('searchbox', { name: 'Cerca nel testo' }) as HTMLInputElement;
const typeQuery = (value: string) => fireEvent.change(field(), { target: { value } });
const counter = () => screen.getByRole('status');
const win = () => screen.getByTestId('find-window');
const handle = () => screen.getByRole('button', { name: 'Sposta la finestra di ricerca' });

function ScopedProbe({ tabId }: { tabId: string }) {
  return <span data-testid="probe">{String(useFindWindowScopedTo(tabId))}</span>;
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  window.innerWidth = 1024;
  appStore.setState({ workspaceTabs: [], highestZIndex: 0, mobileActiveTabId: null });
  saved = {
    css: g.CSS,
    highlight: g.Highlight,
    matchMedia: window.matchMedia,
    scrollIntoView: (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView,
  };
  registry = new Map();
  g.CSS = { highlights: registry };
  g.Highlight = FakeHighlight;
  (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView = vi.fn();
  viewport(true);
});

afterEach(() => {
  act(() => closeFindWindow());
  while (cleanups.length) cleanups.pop()?.();
  vi.useRealTimers();
  g.CSS = saved.css;
  g.Highlight = saved.highlight;
  window.matchMedia = saved.matchMedia;
  (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView = saved.scrollIntoView;
  document.body.innerHTML = '';
  appStore.setState({ workspaceTabs: [], mobileActiveTabId: null });
});

describe('FindWindow — opening', () => {
  it('draws nothing until it is opened, then opens with the field focused', () => {
    render(<FindWindow />);
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    act(() => openFindWindow());
    expect(screen.getByRole('search', { name: 'Cerca nel testo' })).toBeInTheDocument();
    expect(field()).toHaveFocus();
  });

  it('a second request while it is open focuses the field and selects the query', () => {
    render(<FindWindow />);
    act(() => openFindWindow());
    typeQuery('fatto');
    screen.getByRole('button', { name: 'Chiudi la ricerca' }).focus();
    act(() => openFindWindow());
    expect(field()).toHaveFocus();
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe('fatto'.length);
  });

  it('a bare second request leaves the scope alone', () => {
    render(<FindWindow />);
    act(() => openFindWindow());
    fireEvent.click(screen.getByRole('button', { name: 'Tutte le schede' }));
    act(() => openFindWindow());
    expect(screen.getByRole('button', { name: 'Tutte le schede' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('the magnifier opens it scoped to its tab and takes the first match in that text', async () => {
    const a = addDrawnTab('A', N1, 'un fatto in A');
    const b = addDrawnTab('B', N2, 'fatto uno, fatto due');
    render(<FindWindow />);
    act(() => openFindWindow());
    fireEvent.click(screen.getByRole('button', { name: 'Tutte le schede' }));
    typeQuery('fatto');
    await settle();
    expect(counter()).toHaveTextContent('di 3');

    // B was raised last; the magnifier of A asks for A.
    act(() => openFindWindow({ tabId: a, targetKey: keyOf(N1) }));
    await settle();
    expect(screen.getByRole('button', { name: 'Questa scheda' })).toHaveAttribute('aria-pressed', 'true');
    expect(counter()).toHaveTextContent('1 di 1');
    expect(registry.get('vlx-find-current')?.ranges[0].toString().toLowerCase()).toBe('fatto');
    expect(registry.get('vlx-find-current')?.ranges[0].startContainer.parentElement?.textContent).toBe('un fatto in A');
    expect(appStore.getState().workspaceTabs.find((t) => t.id === a)!.zIndex).toBeGreaterThan(
      appStore.getState().workspaceTabs.find((t) => t.id === b)!.zIndex,
    );
  });

  it('typing after a magnifier opening starts in that text', async () => {
    const a = addDrawnTab('A', N1, 'un fatto in A');
    addDrawnTab('B', N2, 'fatto uno, fatto due');
    render(<FindWindow />);
    act(() => openFindWindow({ tabId: a, targetKey: keyOf(N1) }));
    typeQuery('fatto');
    await settle();
    expect(counter()).toHaveTextContent('1 di 1');
  });

  it('the scope switch changes the counter and names where the match is under «Tutte le schede»', async () => {
    const a = addDrawnTab('Tab A', N1, 'un fatto in A');
    addDrawnTab('Tab B', N2, 'fatto uno, fatto due');
    render(<FindWindow />);
    act(() => openFindWindow({ tabId: a }));
    typeQuery('fatto');
    await settle();
    expect(counter()).toHaveTextContent('1 di 1');
    expect(screen.queryByTestId('find-where')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tutte le schede' }));
    await settle();
    expect(screen.getByRole('button', { name: 'Tutte le schede' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Questa scheda' })).toHaveAttribute('aria-pressed', 'false');
    expect(counter()).toHaveTextContent(/^\d di 3$/);
    expect(screen.getByTestId('find-where')).toHaveTextContent('Tab A');
    act(() => screen.getByRole('button', { name: 'Risultato successivo' }).click());
    expect(screen.getByTestId('find-where')).toHaveTextContent('Tab B');
  });

  it('remembers the scope for the session', () => {
    const { unmount } = render(<FindWindow />);
    act(() => openFindWindow());
    fireEvent.click(screen.getByRole('button', { name: 'Tutte le schede' }));
    act(() => closeFindWindow());
    act(() => openFindWindow());
    expect(screen.getByRole('button', { name: 'Tutte le schede' })).toHaveAttribute('aria-pressed', 'true');
    unmount();
  });

  it('reports «open and scoped to this tab» for the magnifier\'s aria-pressed', async () => {
    const a = addDrawnTab('A', N1, 'un fatto');
    const b = addDrawnTab('B', N2, 'un fatto');
    render(<><FindWindow /><ScopedProbe tabId={a} /></>);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
    act(() => openFindWindow({ tabId: a }));
    await settle();
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
    act(() => openFindWindow({ tabId: b }));
    await settle();
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
    act(() => openFindWindow({ tabId: a }));
    fireEvent.click(screen.getByRole('button', { name: 'Tutte le schede' }));
    await settle();
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
    act(() => closeFindWindow());
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });
});

describe('FindWindow — Esc', () => {
  it('closes, clears the highlights, returns the focus and does not reach the document', async () => {
    const a = addDrawnTab('A', N1, 'un fatto');
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    const onDocKey = vi.fn();
    render(<FindWindow />);
    act(() => openFindWindow({ tabId: a, returnFocus: opener }));
    typeQuery('fatto');
    await settle();
    expect(registry.get('vlx-find-current')?.ranges).toHaveLength(1);

    document.addEventListener('keydown', onDocKey);
    fireEvent.keyDown(field(), { key: 'Escape' });
    document.removeEventListener('keydown', onDocKey);

    expect(onDocKey).not.toHaveBeenCalled();
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    expect(registry.has('vlx-find-current')).toBe(false);
    expect(registry.has('vlx-find')).toBe(false);
    expect(opener).toHaveFocus();
  });

  it('returns the focus to what held it when it was opened from the keyboard', () => {
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    render(<FindWindow />);
    act(() => openFindWindow());
    fireEvent.keyDown(screen.getByRole('button', { name: 'Chiudi la ricerca' }), { key: 'Escape' });
    expect(before).toHaveFocus();
  });

  it('Enter goes to the next match and Shift+Enter to the previous, both wrapping', async () => {
    const a = addDrawnTab('A', N1, 'fatto uno, fatto due');
    render(<FindWindow />);
    act(() => openFindWindow({ tabId: a }));
    typeQuery('fatto');
    await settle();
    expect(counter()).toHaveTextContent('1 di 2');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(counter()).toHaveTextContent('2 di 2');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(counter()).toHaveTextContent('1 di 2');
    fireEvent.keyDown(field(), { key: 'Enter', shiftKey: true });
    expect(counter()).toHaveTextContent('2 di 2');
  });

  it('announces the counter in a polite live region', () => {
    render(<FindWindow />);
    act(() => openFindWindow());
    expect(counter()).toHaveAttribute('aria-live', 'polite');
  });
});

describe('FindWindow — its place', () => {
  it('opens at the top right of the results area, 16 px in', () => {
    const area = document.createElement('div');
    area.id = 'tour-results-area';
    area.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 600, right: 900, bottom: 650, x: 100, y: 50, toJSON: () => ({}) });
    document.body.appendChild(area);
    render(<FindWindow />);
    act(() => openFindWindow());
    expect(win().style.left).toBe(`${100 + 800 - 420 - 16}px`);
    expect(win().style.top).toBe('66px');
  });

  it('is dragged by its handle with the keys, and the place survives a reopen', () => {
    render(<FindWindow />);
    act(() => openFindWindow());
    const startLeft = parseFloat(win().style.left);
    const startTop = parseFloat(win().style.top);
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
    fireEvent.keyDown(handle(), { key: 'ArrowDown', shiftKey: true });
    expect(parseFloat(win().style.left)).toBe(startLeft - 16);
    expect(parseFloat(win().style.top)).toBe(startTop + 64);
    const left = win().style.left;
    const top = win().style.top;

    act(() => closeFindWindow());
    act(() => openFindWindow());
    expect(win().style.left).toBe(left);
    expect(win().style.top).toBe(top);
    expect(JSON.parse(sessionStorage.getItem('visualex:find-window-place')!)).toEqual({ x: parseFloat(left), y: parseFloat(top) });
  });

  it('never leaves the viewport: a stored place outside it is clamped, and so is a resize', () => {
    sessionStorage.setItem('visualex:find-window-place', JSON.stringify({ x: 99999, y: -500 }));
    render(<FindWindow />);
    act(() => openFindWindow());
    expect(parseFloat(win().style.left)).toBeLessThanOrEqual(window.innerWidth - 96);
    expect(parseFloat(win().style.top)).toBe(0);

    act(() => {
      window.innerWidth = 500;
      window.dispatchEvent(new Event('resize'));
    });
    expect(parseFloat(win().style.left)).toBeLessThanOrEqual(500 - 96);
  });

  it('ignores a stored place that is not two numbers', () => {
    sessionStorage.setItem('visualex:find-window-place', '{"x":"a"}');
    render(<FindWindow />);
    act(() => openFindWindow());
    expect(parseFloat(win().style.top)).toBe(16);
  });

  it('is above the search panel and below the overlay band', () => {
    render(<FindWindow />);
    act(() => openFindWindow());
    expect(win()).toHaveClass('z-[110]');
  });
});

describe('FindWindow — on a phone', () => {
  beforeEach(() => viewport(false));

  it('takes the full width at the top, the field on a row of its own, not dragged, 44 px targets', () => {
    render(<FindWindow />);
    act(() => openFindWindow());
    expect(win()).toHaveClass('inset-x-0', 'top-0', 'w-full');
    expect(win().style.left).toBe('');
    expect(screen.queryByRole('button', { name: 'Sposta la finestra di ricerca' })).not.toBeInTheDocument();
    expect(field()).toHaveClass('basis-full', 'min-h-[44px]');
    for (const name of ['Risultato precedente', 'Risultato successivo', 'Chiudi la ricerca']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-[44px]', 'min-w-[44px]');
    }
    for (const name of ['Questa scheda', 'Tutte le schede']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-[44px]');
    }
  });
});
