import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appStore } from '../store/useAppStore';
import { registerFindRoot } from '../utils/findTargets';
import { FakeHighlight } from '../utils/__fixtures__/openFind';
import { articleRowKey, besideRefFor, decisionRowKey, practiceArticleKey } from '../utils/practice';
import { decisionKey } from '../utils/decisionLinks';
import { clearDecisionCache, rememberDecision } from '../utils/decisionFetchCache';
import { L24, L241, article } from '../utils/__fixtures__/savedWorkspaces';
import type { ArticleData } from '../types';
import type { FoundDecision } from '../types/decisions';
import { useFindWindow, type UseFindWindow } from './useFindWindow';

const g = globalThis as unknown as Record<string, unknown>;
const s = () => appStore.getState();
let registry: Map<string, FakeHighlight>;
let saved: { css: unknown; highlight: unknown; matchMedia: typeof window.matchMedia; scrollIntoView: unknown };
let latest: UseFindWindow;
const cleanups: Array<() => void> = [];

function Harness({ query, scope }: { query: string; scope: 'tab' | 'all' }) {
  const result = useFindWindow({ query, scope, open: true });
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

/** What a row's `ArticleTabContent` does when it opens: its text root registers under the practice's id. */
function mountRow(practiceId: string, a: ArticleData, html: string): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.appendChild(element);
  cleanups.push(registerFindRoot({ tabId: practiceId, targetKey: practiceArticleKey(a), label: 'art.', element }));
  return element;
}

const withText = (a: ArticleData, text: string): ArticleData => ({ ...a, article_text: text });
const A5 = withText(article(L24, '5'), 'il danno ingiusto');
const A7 = withText(article(L24, '7'), 'nessuna corrispondenza');
const B2 = withText(article(L241, '2'), 'un danno altrove');
const READ = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 28994, anno: 2019 };
const UNREAD = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 577, anno: 2008 };

beforeEach(() => {
  vi.useFakeTimers();
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, workspaceTabs: [], readingBackStack: [], phoneReader: null,
    structureWindow: { blockId: null, position: { x: 0, y: 0 } },
  });
  saved = {
    css: g.CSS, highlight: g.Highlight, matchMedia: window.matchMedia,
    scrollIntoView: (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView,
  };
  registry = new Map();
  g.CSS = { highlights: registry };
  g.Highlight = FakeHighlight;
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView = vi.fn();
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  clearDecisionCache();
  g.CSS = saved.css;
  g.Highlight = saved.highlight;
  window.matchMedia = saved.matchMedia;
  (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView = saved.scrollIntoView;
  document.body.innerHTML = '';
});

/** Two practices: «Responsabilità» (active) with art. 5 and 7 of l. 24/2017; «Appalti» with art. 2 l. 241/1990. */
function twoPractices() {
  const other = s().createPractice('Appalti');
  const { actId: otherAct } = s().addArticlesToPractice(other, L241, [B2]);
  const here = s().createPractice('Responsabilità');
  const { actId } = s().addArticlesToPractice(here, L24, [A5, A7]);
  return { here, actId, other, otherAct };
}

describe('useFindWindow over the practices (spec §6.6-§6.7)', () => {
  it('«Questa pratica» finds a word in a closed row, counted from its stored text, not drawn', async () => {
    twoPractices();
    render(<Harness query="danno" scope="tab" />);
    await settle();
    expect(latest.count).toBe(1);
    expect(latest.current).toMatchObject({ targetKey: practiceArticleKey(A5), onScreen: false });
    expect(registry.get('vlx-find-current')).toBeUndefined();
  });

  it('a match in an open row is drawn from its root (registered under the practice), not counted twice', async () => {
    const { here } = twoPractices();
    mountRow(here, A5, '<p>il danno ingiusto</p>');
    render(<Harness query="danno" scope="tab" />);
    await settle();
    expect(latest.count).toBe(1);
    expect(latest.current).toMatchObject({ tabId: here, onScreen: true });
    expect(registry.get('vlx-find-current')?.ranges).toHaveLength(1);
  });

  it('«Tutte le pratiche» finds it in another practice; going there makes that practice active and opens the row', async () => {
    const { here, other, otherAct } = twoPractices();
    mountRow(here, A5, '<p>il danno ingiusto</p>');
    render(<Harness query="danno" scope="all" />);
    await settle();
    expect(latest.count).toBe(2);
    expect(latest.current?.tabId).toBe(here);

    act(() => latest.next());
    expect(latest.current).toMatchObject({ tabId: other, onScreen: false });
    expect(s().activePracticeId).toBe(other);
    const rowKey = articleRowKey(other, otherAct, practiceArticleKey(B2));
    expect(s().practiceRows[rowKey]).toBe(true);
    expect(s().pendingReveal).toEqual({ practiceId: other, rowKey });

    act(() => { mountRow(other, B2, 'un danno altrove'); });
    await settle(50);
    expect(latest.current).toMatchObject({ tabId: other, onScreen: true });
  });

  it('a decision read in the session is searched in its cached text and reached by opening its row; one never read counts nothing', async () => {
    const { here } = twoPractices();
    const read = s().openDecision(READ, { practiceId: here, open: false });
    s().openDecision(UNREAD, { practiceId: here, open: false });
    const answer: FoundDecision = {
      esito: 'trovata', identita: READ, attributi: {}, testo: { motivazione: 'il danno da perdita' }, fonte: { nome: 'italgiure' }, avvisi: [],
    };
    rememberDecision(READ, answer);
    s().setActivePractice(here);
    render(<Harness query="danno" scope="tab" />);
    await settle();
    expect(latest.count).toBe(2);
    act(() => latest.next());
    expect(latest.current).toMatchObject({ targetKey: decisionKey(READ), onScreen: false });
    expect(s().practiceRows[decisionRowKey(here, read.decisionId)]).toBe(true);
  });

  describe('on a phone, with the full-screen reader open (spec §6.7)', () => {
    /** The reader on a read decision of the practice «Responsabilità», its text root registered under the practice. */
    function readerOnDecision() {
      const { here, actId } = twoPractices();
      const read = s().openDecision(READ, { practiceId: here, open: false });
      s().openPhoneReader(here, besideRefFor({ kind: 'decision', decisionId: read.decisionId }));
      const element = document.createElement('div');
      element.textContent = 'il danno da perdita';
      document.body.appendChild(element);
      cleanups.push(registerFindRoot({ tabId: here, targetKey: decisionKey(READ), label: 'Cass.', element }));
      return { here, actId };
    }
    const phone = () => {
      window.matchMedia = ((query: string) => ({
        matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    };

    it('going to a match in a closed article row closes the reader first, then reveals the row; the match is drawn once the row mounts', async () => {
      phone();
      const { here, actId } = readerOnDecision();
      render(<Harness query="danno" scope="tab" />);
      await settle();
      expect(latest.count).toBe(2);
      expect(latest.current).toMatchObject({ targetKey: decisionKey(READ), onScreen: true });
      expect(s().phoneReader).not.toBeNull();

      act(() => latest.next());
      expect(latest.current).toMatchObject({ targetKey: practiceArticleKey(A5), onScreen: false });
      expect(s().phoneReader).toBeNull();
      const rowKey = articleRowKey(here, actId, practiceArticleKey(A5));
      expect(s().practiceRows[rowKey]).toBe(true);
      expect(s().pendingReveal).toEqual({ practiceId: here, rowKey });
      expect(s().activePracticeId).toBe(here);

      act(() => { mountRow(here, A5, '<p>il danno ingiusto</p>'); });
      await settle(50);
      expect(latest.current).toMatchObject({ targetKey: practiceArticleKey(A5), onScreen: true });
    });

    it('a match in the reader\'s own subject is drawn and leaves the reader open', async () => {
      phone();
      const { here } = readerOnDecision();
      // art. 5 and 7 hold no «perdita»: the only match is the reader's own
      render(<Harness query="perdita" scope="tab" />);
      await settle();
      expect(latest.count).toBe(1);
      act(() => latest.next());
      expect(latest.current).toMatchObject({ targetKey: decisionKey(READ), onScreen: true });
      expect(s().phoneReader).toMatchObject({ practiceId: here });
    });
  });

  it('recomputes when the active practice changes, and when a row opens', async () => {
    const { here, other } = twoPractices();
    render(<Harness query="danno" scope="tab" />);
    await settle();
    expect(latest.current?.tabId).toBe(here);
    act(() => { s().setActivePractice(other); });
    await settle(50);
    expect(latest.count).toBe(1);
    expect(latest.current?.tabId).toBe(other);
  });
});
