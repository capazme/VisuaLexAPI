import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appStore } from '../useAppStore';
import { articleWindowId, besideRefFor, decisionWindowId, practiceArticleKey, type Practice } from '../../utils/practice';
import { peekReadingBack } from '../../utils/readingBackStack';
import type { DecisionReference } from '../../types/decisions';
import { L24, article } from '../../utils/__fixtures__/savedWorkspaces';

const s = () => appStore.getState();
const practice = (id: string): Practice => s().practices.find((p) => p.id === id) as Practice;
let savedMatchMedia: typeof window.matchMedia;

/** The viewport the store's actions read once (`isDesktopViewport`). */
function viewport(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const REF_A: DecisionReference = { corte: 'cassazione', archivio: 'civile', numero: 11111, anno: 2020 };
const REF_B: DecisionReference = { corte: 'cassazione', archivio: 'civile', numero: 22222, anno: 2021 };

beforeEach(() => {
  vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
  savedMatchMedia = window.matchMedia;
  appStore.setState({
    practices: [], activePracticeId: null, practicesSeeded: true, practiceRows: {}, pendingReveal: null,
    practiceNotice: null, readingBackStack: [], workspaceTabs: [], windowFocusRequest: null,
  });
});
afterEach(() => {
  window.matchMedia = savedMatchMedia;
  vi.unstubAllEnvs();
});

describe('a decision opened from a link: beside on the desktop, in place on a phone (spec §6.1)', () => {
  it('desktop: the entry joins «Giurisprudenza» and its window opens; its row is not opened', () => {
    viewport(true);
    const p = s().createPractice('P');
    const id = s().openDecisionTab(REF_A);
    expect(practice(p).decisions.map((d) => d.id)).toEqual([id]);
    expect(practice(p).beside.map((b) => b.id)).toEqual([decisionWindowId(id)]);
    expect(s().pendingReveal).toBeNull();
    expect(Object.keys(s().practiceRows)).toEqual([]);
  });

  it('phone: opened in place in the table, no window', () => {
    viewport(false);
    const p = s().createPractice('P');
    s().openDecisionTab(REF_A);
    expect(practice(p).beside).toEqual([]);
    expect(s().pendingReveal?.practiceId).toBe(p);
  });

  it('from an article read in a window, that window is kept; a third window replaces the oldest other (T16)', () => {
    viewport(true);
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    const asker = besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(article(L24, '5')) });
    s().openBeside(practiceId, asker);
    const a = s().openDecisionTab(REF_A, { besideTabId: asker.id });
    expect(practice(practiceId).beside.map((b) => b.id)).toEqual([asker.id, decisionWindowId(a)]);
    // The asker is the oldest window, and the one that asks: the other goes.
    const b = s().openDecisionTab(REF_B, { besideTabId: asker.id });
    expect(practice(practiceId).beside.map((w) => w.id)).toEqual([asker.id, decisionWindowId(b)]);
    // Asked from a row of the table, the oldest goes.
    const c = s().openDecisionTab(REF_A, { besideTabId: practiceId });
    expect(practice(practiceId).beside.map((w) => w.id)).toEqual([decisionWindowId(b), decisionWindowId(c)]);
    // The replaced subjects stay in the table.
    expect(practice(practiceId).acts[0].articles).toHaveLength(1);
    expect(practice(practiceId).decisions).toHaveLength(2);
  });

  it('the same decision again keeps one entry and one window, and asks that window to take focus', () => {
    viewport(true);
    const p = s().createPractice('P');
    const id = s().openDecisionTab(REF_A);
    expect(s().windowFocusRequest).toBeNull();
    s().openDecisionTab(REF_A);
    expect(practice(p).decisions).toHaveLength(1);
    expect(practice(p).beside).toHaveLength(1);
    expect(s().windowFocusRequest).toBe(decisionWindowId(id));
  });
});

describe('a window asked for again takes focus, once (carry-over 11, gotcha 14)', () => {
  it('openBeside on a subject already beside; a new window asks nothing', () => {
    viewport(true);
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    const ref = besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(article(L24, '5')) });
    s().openBeside(practiceId, ref);
    expect(s().windowFocusRequest).toBeNull();
    s().openBeside(practiceId, ref);
    expect(s().windowFocusRequest).toBe(articleWindowId(actId, practiceArticleKey(article(L24, '5'))));
    expect(s().takeWindowFocusRequest('another')).toBe(false);
    expect(s().takeWindowFocusRequest(ref.id)).toBe(true);
    expect(s().takeWindowFocusRequest(ref.id)).toBe(false);
  });

  it('a topic search asked again', () => {
    viewport(true);
    s().createPractice('P');
    const id = s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno');
    expect(s().windowFocusRequest).toBeNull();
    expect(s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno')).toBe(id);
    expect(s().windowFocusRequest).toBe(id);
  });
});

describe('the way back to a window (spec §6.3, carry-over 11)', () => {
  function articleWindow() {
    const a = article(L24, '5');
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [a]);
    const ref = besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(a) });
    s().openBeside(practiceId, ref);
    return { practiceId, actId, ref };
  }

  it('after a jump from a window whose window was since closed: the practice active and the window reopened', () => {
    const { practiceId, ref } = articleWindow();
    const other = s().createPractice('Altra');
    s().pushReadingBack({ tabId: ref.id, blockId: 'act', articleId: '5', label: 'art. 5 l. 24/2017' });
    s().closeBeside(practiceId, ref.id);
    expect(s().activePracticeId).toBe(other);
    const entry = s().popReadingBack();
    expect(entry).toMatchObject({ practiceId, place: 'beside' });
    expect(s().activePracticeId).toBe(practiceId);
    expect(practice(practiceId).beside.map((b) => b.id)).toEqual([ref.id]);
  });

  it('a window still open is not duplicated and takes focus', () => {
    const { practiceId, ref } = articleWindow();
    s().pushReadingBack({ tabId: ref.id, blockId: 'act', articleId: '5', label: 'art. 5 l. 24/2017' });
    s().popReadingBack();
    expect(practice(practiceId).beside).toHaveLength(1);
    expect(s().windowFocusRequest).toBe(ref.id);
  });

  it('a topic-search window is never a target', () => {
    viewport(true);
    const p = s().createPractice('P');
    const id = s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno');
    s().pushReadingBack({ tabId: id, blockId: id, articleId: '', label: 'Tema: danno' });
    expect(peekReadingBack(s().readingBackStack, s().workspaceTabs, s().practices)).toBeNull();
    expect(practice(p).beside).toHaveLength(1);
  });
});

describe('a reveal that targets a row folded by its window focuses the window (spec §4.2)', () => {
  function foldedRow() {
    const a = article(L24, '5');
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [a]);
    const key = practiceArticleKey(a);
    const ref = besideRefFor({ kind: 'article', actId, articleKey: key });
    s().openBeside(practiceId, ref);
    appStore.setState({ pendingReveal: null, windowFocusRequest: null });
    return { practiceId, actId, key, ref };
  }

  it('desktop: revealPracticeRow asks the window to take focus and scrolls to nothing', () => {
    viewport(true);
    const { practiceId, actId, key, ref } = foldedRow();
    expect(s().revealPracticeRow(practiceId, actId, key)).toBe(true);
    expect(s().windowFocusRequest).toBe(ref.id);
    expect(s().pendingReveal).toBeNull();
  });

  it('desktop: the way back to a row (`table`) whose article is beside focuses the window too', () => {
    viewport(true);
    const { practiceId, actId, ref } = foldedRow();
    s().pushReadingBack({ tabId: practiceId, blockId: actId, articleId: '5', label: 'art. 5 l. 24/2017' });
    s().popReadingBack();
    expect(s().windowFocusRequest).toBe(ref.id);
    expect(s().pendingReveal).toBeNull();
  });

  it('desktop: a row nothing shows beside is revealed as before', () => {
    viewport(true);
    const { practiceId, actId, key, ref } = foldedRow();
    s().closeBeside(practiceId, ref.id);
    s().revealPracticeRow(practiceId, actId, key);
    expect(s().windowFocusRequest).toBeNull();
    expect(s().pendingReveal?.practiceId).toBe(practiceId);
  });

  it('phone: no window folds a row, so the row is revealed', () => {
    viewport(false);
    const { practiceId, actId, key } = foldedRow();
    s().revealPracticeRow(practiceId, actId, key);
    expect(s().windowFocusRequest).toBeNull();
    expect(s().pendingReveal?.practiceId).toBe(practiceId);
  });

  it('phone: a topic search asked again writes no focus request (there is no window)', () => {
    viewport(false);
    s().createPractice('P');
    s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno');
    s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno');
    expect(s().windowFocusRequest).toBeNull();
  });
});
