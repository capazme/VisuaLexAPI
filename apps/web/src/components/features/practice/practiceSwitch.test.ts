import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appStore } from '../../../store/useAppStore';
import { besideRefFor, practiceArticleKey } from '../../../utils/practice';
import { L24, article } from '../../../utils/__fixtures__/savedWorkspaces';
import {
  PRACTICE_SWITCHING, closePracticeWindow, openPracticeWindow, practiceTransitionName, switchPracticeView,
} from './practiceSwitch';

const s = () => appStore.getState();
const root = () => document.documentElement;

/** A View Transition whose end the test decides: the update runs at once, as the browser runs it after its picture. */
function fakeTransitions() {
  const ends: Array<() => void> = [];
  const start = vi.fn((update: () => void) => {
    update();
    let end = () => {};
    const finished = new Promise<void>((resolve) => { end = resolve; });
    ends.push(end);
    return { finished, ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), skipTransition: vi.fn() };
  });
  Object.defineProperty(document, 'startViewTransition', { configurable: true, writable: true, value: start });
  return { start, end: async (i: number) => { ends[i](); await Promise.resolve(); await Promise.resolve(); } };
}

/** The motion preference; every other query (the store's desktop width) matches: a desktop. */
function reducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') ? reduce : true, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  reducedMotion(false);
  appStore.setState({ practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, readingBackStack: [], windowFocusRequest: null });
});

afterEach(async () => {
  // Let any transition a test left playing end, so the next starts from rest.
  await new Promise((resolve) => setTimeout(resolve, 0));
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  root().classList.remove(PRACTICE_SWITCHING);
  vi.unstubAllGlobals();
});

describe('switchPracticeView (L-62)', () => {
  it('without View Transitions the view changes at once, then `after` runs on the new page', () => {
    const calls: string[] = [];
    switchPracticeView(() => calls.push('update'), () => calls.push('after'));
    expect(calls).toEqual(['update', 'after']);
    expect(root()).not.toHaveClass(PRACTICE_SWITCHING);
  });

  it('under reduced motion no transition is started', () => {
    const { start } = fakeTransitions();
    reducedMotion(true);
    const update = vi.fn();
    switchPracticeView(update);
    expect(update).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
  });

  it('names the pieces only while it plays: the class on the root, taken away when it ends', async () => {
    const { start, end } = fakeTransitions();
    const update = vi.fn();
    switchPracticeView(update);
    expect(start).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(root()).toHaveClass(PRACTICE_SWITCHING);
    await end(0);
    expect(root()).not.toHaveClass(PRACTICE_SWITCHING);
  });

  it('a change asked while one plays waits for its end, then plays its own: neither jumps', async () => {
    const { start, end } = fakeTransitions();
    const first = vi.fn();
    const second = vi.fn();
    switchPracticeView(first);
    switchPracticeView(second);
    expect(start).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    await end(0);
    expect(start).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledOnce();
    expect(root()).toHaveClass(PRACTICE_SWITCHING);
    await end(1);
    expect(root()).not.toHaveClass(PRACTICE_SWITCHING);
  });

  it('a piece\'s name is a CSS identifier, whatever the saved id', () => {
    expect(practiceTransitionName('practice-head')).toBe('vlx-practice-head');
    expect(practiceTransitionName('practice-act', '3f1c-9a')).toBe('vlx-practice-act-3f1c-9a');
    expect(practiceTransitionName('practice-act', 'a b:"c"')).toBe('vlx-practice-act-a_b__c_');
  });
});

describe('opening and closing a window through the passage', () => {
  function practice() {
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5'), article(L24, '7')]);
    const ref = (n: string) => besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(article(L24, n)) });
    return { practiceId, five: ref('5'), seven: ref('7') };
  }

  it('plays only when the view changes: the first window opened, the last closed', async () => {
    const { start, end } = fakeTransitions();
    const { practiceId, five, seven } = practice();
    openPracticeWindow(practiceId, five);
    expect(start).toHaveBeenCalledTimes(1);
    expect(s().windowFocusRequest).toBe(five.id);
    await end(0);
    openPracticeWindow(practiceId, seven);
    expect(start).toHaveBeenCalledTimes(1);
    expect(s().practices[0].beside.map((b) => b.id)).toEqual([five.id, seven.id]);
    closePracticeWindow(practiceId, seven);
    expect(start).toHaveBeenCalledTimes(1);
    // The window left open takes the focus.
    expect(s().windowFocusRequest).toBe(five.id);
    closePracticeWindow(practiceId, five);
    expect(start).toHaveBeenCalledTimes(2);
    expect(s().practices[0].beside).toEqual([]);
    await end(1);
  });

  it('a change that waited decides again when it runs: a «Chiudi» no longer the last plays nothing', async () => {
    const { start, end } = fakeTransitions();
    const { practiceId, five, seven } = practice();
    openPracticeWindow(practiceId, five);
    // Meanwhile an entry of the index opens a second window (no passage), and the first window's «Chiudi» is pressed.
    s().openBeside(practiceId, seven);
    closePracticeWindow(practiceId, five);
    expect(s().practices[0].beside.map((b) => b.id)).toEqual([five.id, seven.id]);
    await end(0);
    expect(start).toHaveBeenCalledTimes(1);
    expect(s().practices[0].beside.map((b) => b.id)).toEqual([seven.id]);
    expect(s().windowFocusRequest).toBe(seven.id);
  });

  it('a transition that fails to start changes the view at once and leaves nothing named', () => {
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true, writable: true, value: () => { throw new Error('InvalidStateError'); },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const update = vi.fn();
    switchPracticeView(update);
    expect(update).toHaveBeenCalledOnce();
    expect(root()).not.toHaveClass(PRACTICE_SWITCHING);
    expect(warn).toHaveBeenCalled();
  });
});
