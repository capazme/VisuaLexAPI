import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('../../../services/articleDiscussionService', () => ({
  articleDiscussionService: {
    list: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 } }),
    listPassages: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    comment: vi.fn(),
    report: vi.fn(),
    voteThread: vi.fn(),
    voteComment: vi.fn(),
    setPassageReleased: vi.fn(),
  },
}));

import { FindWindow } from './FindWindow';
import { ArticleDiscussionPanel } from './ArticleDiscussionPanel';
import { appStore } from '../../../store/useAppStore';
import type { ArticleData, NormaVisitata } from '../../../types';
import { buildItemKey } from '../../../utils/normaKeys';
import { versionKey } from '../../../utils/versionDisplay';
import { registerFindRoot } from '../../../utils/findTargets';
import { closeFindWindow, openFindWindow, setFindWindowDefaultPlace } from '../../../utils/findWindowControl';
import { useFindWindowScopedTo } from '../../../hooks/useFindWindowScopedTo';
import { FakeHighlight } from '../../../utils/__fixtures__/openFind';
import { shortNorm } from '../../../utils/sources';
import { decisionKey } from '../../../utils/decisionLinks';
import type { DecisionIdentity } from '../../../types/decisions';

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

/** A practice with one article drawn on screen: its text root in the document, registered. */
function addDrawnTab(label: string, n: NormaVisitata, text: string): string {
  const id = appStore.getState().createPractice(label, { custom: true });
  appStore.getState().addArticlesToPractice(id, n, [article(n, text)]);
  const element = document.createElement('div');
  element.textContent = text;
  document.body.appendChild(element);
  cleanups.push(registerFindRoot({ tabId: id, targetKey: keyOf(n), label: shortNorm(n), element }));
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

/** jsdom's pointer events carry no coordinates: a mouse event under the pointer event's name does. */
const pointer = (type: string, clientX: number, clientY: number) =>
  act(() => {
    handle().dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true }));
  });

function ScopedProbe({ tabId }: { tabId: string }) {
  return <span data-testid="probe">{String(useFindWindowScopedTo(tabId))}</span>;
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  window.innerWidth = 1024;
  appStore.setState({ practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null });
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
  setFindWindowDefaultPlace(null);
  while (cleanups.length) cleanups.pop()?.();
  vi.useRealTimers();
  g.CSS = saved.css;
  g.Highlight = saved.highlight;
  window.matchMedia = saved.matchMedia;
  (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView = saved.scrollIntoView;
  document.body.innerHTML = '';
  appStore.setState({ practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null });
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
    fireEvent.click(screen.getByRole('button', { name: 'Tutte le pratiche' }));
    act(() => openFindWindow());
    expect(screen.getByRole('button', { name: 'Tutte le pratiche' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('the magnifier opens it scoped to its tab and takes the first match in that text', async () => {
    const a = addDrawnTab('A', N1, 'un fatto in A');
    const b = addDrawnTab('B', N2, 'fatto uno, fatto due');
    render(<FindWindow />);
    act(() => openFindWindow());
    fireEvent.click(screen.getByRole('button', { name: 'Tutte le pratiche' }));
    typeQuery('fatto');
    await settle();
    expect(counter()).toHaveTextContent('di 3');

    // B was raised last; the magnifier of A asks for A.
    act(() => openFindWindow({ tabId: a, targetKey: keyOf(N1) }));
    await settle();
    expect(screen.getByRole('button', { name: 'Questa pratica' })).toHaveAttribute('aria-pressed', 'true');
    expect(counter()).toHaveTextContent('1 di 1');
    expect(registry.get('vlx-find-current')?.ranges[0].toString().toLowerCase()).toBe('fatto');
    expect(registry.get('vlx-find-current')?.ranges[0].startContainer.parentElement?.textContent).toBe('un fatto in A');
    expect(appStore.getState().activePracticeId).toBe(a);
    expect(b).not.toBe(a);
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

  it('the scope switch changes the counter and names where the match is under «Tutte le pratiche»', async () => {
    const a = addDrawnTab('Tab A', N1, 'un fatto in A');
    addDrawnTab('Tab B', N2, 'fatto uno, fatto due');
    render(<FindWindow />);
    act(() => openFindWindow({ tabId: a }));
    typeQuery('fatto');
    await settle();
    expect(counter()).toHaveTextContent('1 di 1');
    expect(screen.queryByTestId('find-where')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tutte le pratiche' }));
    await settle();
    expect(screen.getByRole('button', { name: 'Tutte le pratiche' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Questa pratica' })).toHaveAttribute('aria-pressed', 'false');
    expect(counter()).toHaveTextContent(/^\d di 3/);
    // One label for an article: its `shortNorm`, and the practice that holds it.
    expect(screen.getByTestId('find-where')).toHaveTextContent(new RegExp(`^${shortNorm(N1)} · Tab A$`));
    // The place is in the polite live region with the counter.
    expect(counter()).toHaveTextContent(`${shortNorm(N1)} · Tab A`);
    act(() => screen.getByRole('button', { name: 'Risultato successivo' }).click());
    expect(screen.getByTestId('find-where')).toHaveTextContent(new RegExp(`^${shortNorm(N2)} · Tab B$`));
    expect(counter()).toHaveTextContent(`${shortNorm(N2)} · Tab B`);
  });

  it('names a decision by its entry\'s label, the one with the section, and its practice', async () => {
    const practiceId = addDrawnTab('Tab A', N1, 'nessuna corrispondenza');
    const identity: DecisionIdentity = { corte: 'cassazione', archivio: 'civile', numero: 1234, anno: 2020 };
    const { decisionId: id } = appStore.getState().openDecision(identity, { practiceId, open: false });
    act(() => appStore.getState().setDecisionEntryIdentity(practiceId, id, identity, { sezione: 'III' }, 'Cass. civ., sez. III, n. 1234/2020'));
    const element = document.createElement('div');
    element.textContent = 'il fatto non sussiste';
    document.body.appendChild(element);
    // The surface registers the shorter label when it has no section of its own.
    cleanups.push(registerFindRoot({ tabId: practiceId, targetKey: decisionKey(identity), label: 'Cass. civ., n. 1234/2020', element }));
    render(<FindWindow />);
    act(() => openFindWindow());
    fireEvent.click(screen.getByRole('button', { name: 'Tutte le pratiche' }));
    typeQuery('fatto');
    await settle();
    expect(counter()).toHaveTextContent('1 di 1');
    expect(screen.getByTestId('find-where')).toHaveTextContent(/^Cass\. civ\., sez\. III, n\. 1234\/2020 · Tab A$/);
  });

  it('spends the magnifier\'s preference on the first query: later ones start in the active practice', async () => {
    const a = addDrawnTab('A', N1, 'un fatto in A');
    const b = addDrawnTab('B', N2, 'fatto uno, fatto due');
    render(<FindWindow />);
    act(() => openFindWindow({ tabId: a, targetKey: keyOf(N1) }));
    typeQuery('fatto');
    await settle();
    expect(counter()).toHaveTextContent('1 di 1');

    // The reader moves on to B and widens the search; a new query starts where the reader is.
    act(() => appStore.getState().setActivePractice(b));
    fireEvent.click(screen.getByRole('button', { name: 'Tutte le pratiche' }));
    await settle();
    typeQuery('fatt');
    await settle();
    expect(counter()).toHaveTextContent('2 di 3');
    expect(screen.getByTestId('find-where')).toHaveTextContent(shortNorm(N2));
  });

  it('a magnifier on another text of the same tab is not pressed while the window is pointed elsewhere', async () => {
    const a = addDrawnTab('A', N1, 'un fatto');
    function Probe({ k }: { k: string }) {
      return <span data-testid={`probe-${k}`}>{String(useFindWindowScopedTo(a, k))}</span>;
    }
    render(<><FindWindow /><Probe k={keyOf(N1)} /><Probe k="altro" /></>);
    act(() => openFindWindow({ tabId: a, targetKey: keyOf(N1) }));
    await settle();
    expect(screen.getByTestId(`probe-${keyOf(N1)}`)).toHaveTextContent('true');
    expect(screen.getByTestId('probe-altro')).toHaveTextContent('false');
  });

  it('with two texts in one tab, the magnifier\'s targetKey picks the first match, not just the tab', async () => {
    const a = appStore.getState().createPractice('A', { custom: true });
    appStore.getState().addArticlesToPractice(a, N1, [article(N1, 'un fatto uno'), article(N2, 'un fatto due')]);
    for (const [n, text] of [[N1, 'un fatto uno'], [N2, 'un fatto due']] as const) {
      const element = document.createElement('div');
      element.textContent = text;
      document.body.appendChild(element);
      cleanups.push(registerFindRoot({ tabId: a, targetKey: keyOf(n), label: 'art.', element }));
    }
    render(<FindWindow />);
    act(() => openFindWindow({ tabId: a, targetKey: keyOf(N2) }));
    typeQuery('fatto');
    await settle();
    expect(counter()).toHaveTextContent('2 di 2');
    expect(registry.get('vlx-find-current')?.ranges[0].startContainer.parentElement?.textContent).toBe('un fatto due');
  });

  it('remembers the scope for the session', () => {
    const { unmount } = render(<FindWindow />);
    act(() => openFindWindow());
    fireEvent.click(screen.getByRole('button', { name: 'Tutte le pratiche' }));
    act(() => closeFindWindow());
    act(() => openFindWindow());
    expect(screen.getByRole('button', { name: 'Tutte le pratiche' })).toHaveAttribute('aria-pressed', 'true');
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
    fireEvent.click(screen.getByRole('button', { name: 'Tutte le pratiche' }));
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

  it('with a real discussion panel open, Esc closes the window and leaves the panel open', async () => {
    const onPanelClose = vi.fn();
    const { unmount } = render(
      <>
        <FindWindow />
        <ArticleDiscussionPanel anchor={{ normaKey: 'k1', articleId: '1', articleLabel: '1' }} isOpen onClose={onPanelClose} />
      </>,
    );
    await settle();
    act(() => openFindWindow());
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    expect(onPanelClose).not.toHaveBeenCalled();
    // The panel still answers its own Esc.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onPanelClose).toHaveBeenCalledTimes(1);
    unmount();
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
    expect(parseFloat(win().style.left)).toBe(window.innerWidth - 420);
    expect(parseFloat(win().style.top)).toBe(0);

    act(() => {
      window.innerWidth = 500;
      window.dispatchEvent(new Event('resize'));
    });
    expect(parseFloat(win().style.left)).toBe(500 - 420);
  });

  it('keeps the whole window inside the viewport: the handle stays reachable on every side', () => {
    sessionStorage.setItem('visualex:find-window-place', JSON.stringify({ x: -300, y: 99999 }));
    render(<FindWindow />);
    act(() => openFindWindow());
    expect(parseFloat(win().style.left)).toBe(0);
    expect(parseFloat(win().style.top)).toBeLessThan(window.innerHeight);
    expect(parseFloat(win().style.top)).toBeGreaterThan(window.innerHeight - 200);
    for (let i = 0; i < 80; i += 1) fireEvent.keyDown(handle(), { key: 'ArrowLeft', shiftKey: true });
    expect(parseFloat(win().style.left)).toBe(0);
    for (let i = 0; i < 80; i += 1) fireEvent.keyDown(handle(), { key: 'ArrowRight', shiftKey: true });
    expect(parseFloat(win().style.left)).toBe(window.innerWidth - 420);
  });

  it('is dragged by the pointer, kept inside the viewport, and the place is saved on release', () => {
    render(<FindWindow />);
    act(() => openFindWindow());
    const startLeft = parseFloat(win().style.left);
    const startTop = parseFloat(win().style.top);
    pointer('pointerdown', 500, 100);
    pointer('pointermove', 450, 130);
    expect(parseFloat(win().style.left)).toBe(startLeft - 50);
    expect(parseFloat(win().style.top)).toBe(startTop + 30);
    expect(sessionStorage.getItem('visualex:find-window-place')).toBeNull();
    pointer('pointermove', -5000, -5000);
    expect(parseFloat(win().style.left)).toBe(0);
    expect(parseFloat(win().style.top)).toBe(0);
    pointer('pointerup', 0, 0);
    expect(JSON.parse(sessionStorage.getItem('visualex:find-window-place')!)).toEqual({ x: 0, y: 0 });
    // Released: further movement does not drag.
    pointer('pointermove', 300, 300);
    expect(parseFloat(win().style.left)).toBe(0);
  });

  it('ignores a stored place that is not two numbers', () => {
    sessionStorage.setItem('visualex:find-window-place', '{"x":"a"}');
    render(<FindWindow />);
    act(() => openFindWindow());
    expect(parseFloat(win().style.top)).toBe(16);
  });

  describe('a default place a layout sets (spec §4.4)', () => {
    it('opens there instead of at the top right of the results area', () => {
      setFindWindowDefaultPlace({ x: 120, y: 90 });
      render(<FindWindow />);
      act(() => openFindWindow());
      expect(win().style.left).toBe('120px');
      expect(win().style.top).toBe('90px');
    });

    it('asks a function each time the window opens, so the place follows the layout', () => {
      let y = 90;
      setFindWindowDefaultPlace(() => ({ x: 120, y }));
      render(<FindWindow />);
      act(() => openFindWindow());
      expect(win().style.top).toBe('90px');
      act(() => closeFindWindow());
      y = 140;
      act(() => openFindWindow());
      expect(win().style.top).toBe('140px');
    });

    it('falls back to the top right of the results area when the function has nothing to say, and on null', () => {
      setFindWindowDefaultPlace(() => null);
      render(<FindWindow />);
      act(() => openFindWindow());
      expect(win().style.top).toBe('16px');
      act(() => closeFindWindow());
      setFindWindowDefaultPlace({ x: 10, y: 10 });
      setFindWindowDefaultPlace(null);
      act(() => openFindWindow());
      expect(win().style.top).toBe('16px');
    });

    it('is clamped into the viewport like any other place', () => {
      setFindWindowDefaultPlace({ x: 99999, y: -50 });
      render(<FindWindow />);
      act(() => openFindWindow());
      expect(parseFloat(win().style.left)).toBe(window.innerWidth - 420);
      expect(win().style.top).toBe('0px');
    });

    it('a place the user dragged it to wins, and is kept for the session', () => {
      setFindWindowDefaultPlace({ x: 120, y: 90 });
      render(<FindWindow />);
      act(() => openFindWindow());
      fireEvent.keyDown(handle(), { key: 'ArrowRight' });
      expect(win().style.left).toBe('136px');
      act(() => closeFindWindow());
      setFindWindowDefaultPlace({ x: 300, y: 300 });
      act(() => openFindWindow());
      expect(win().style.left).toBe('136px');
      expect(win().style.top).toBe('90px');
    });
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
    for (const name of ['Questa pratica', 'Tutte le pratiche']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-[44px]');
    }
  });
});

describe('FindWindow over the practices (spec §6.6)', () => {
  const s = () => appStore.getState();
  it('names its scopes «Questa pratica» and «Tutte le pratiche», and names the practice of a match in another', async () => {
    const other = s().createPractice('Appalti');
    s().addArticlesToPractice(other, { tipo_atto: 'codice civile', data: '' }, [article(N2, 'un fatto altrove')]);
    const here = s().createPractice('Responsabilità');
    s().addArticlesToPractice(here, { tipo_atto: 'codice civile', data: '' }, [article(N1, 'un fatto qui')]);
    render(<FindWindow />);
    act(() => openFindWindow());
    expect(screen.getByRole('button', { name: 'Questa pratica' })).toHaveAttribute('aria-pressed', 'true');
    typeQuery('fatto');
    await settle();
    expect(counter()).toHaveTextContent('1 di 1');
    fireEvent.click(screen.getByRole('button', { name: 'Tutte le pratiche' }));
    await settle();
    expect(counter()).toHaveTextContent(/di 2/);
    act(() => screen.getByRole('button', { name: 'Risultato successivo' }).click());
    expect(screen.getByTestId('find-where')).toHaveTextContent(/· (Appalti|Responsabilità)$/);
  });

  it('the magnifier of a row asks for its practice: that practice becomes the one searched', async () => {
    const here = s().createPractice('Responsabilità');
    s().addArticlesToPractice(here, { tipo_atto: 'codice civile', data: '' }, [article(N1, 'un fatto qui')]);
    s().createPractice('Altra');
    render(<FindWindow />);
    act(() => openFindWindow({ tabId: here, targetKey: keyOf(N1) }));
    expect(s().activePracticeId).toBe(here);
    typeQuery('fatto');
    await settle();
    expect(counter()).toHaveTextContent('1 di 1');
  });
});
