import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appStore } from '../useAppStore';
import { decisionRowKey, articleRowKey, practiceArticleKey, type Practice } from '../../utils/practice';
import type { DecisionReference } from '../../types/decisions';
import { CC_RD, FOUND, L24, article } from '../../utils/__fixtures__/savedWorkspaces';

type AppState = ReturnType<typeof appStore.getState>;
const s = (): AppState => appStore.getState();
const practice = (id: string): Practice => {
  const found = s().practices.find((p) => p.id === id);
  if (!found) throw new Error(`no practice ${id}`);
  return found;
};
const flagOn = () => vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
const flagOff = () => vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', '');

const REF: DecisionReference = { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 };

beforeEach(() => {
  appStore.setState({
    practices: [], activePracticeId: null, practicesSeeded: true, practiceRows: {}, pendingReveal: null,
    practiceNotice: null, structureWindow: { blockId: null, position: { x: 0, y: 0 } }, readingBackStack: [],
    workspaceTabs: [], decisionFocusRequest: null, pendingDecision: null,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('the ways in route to the practice, flag on (spec §5, §6.1-§6.2)', () => {
  it('openDecisionTab: the decision enters the active practice once and its row is opened in place', () => {
    flagOn();
    const p = s().createPractice('Responsabilità');
    const id = s().openDecisionTab(REF);
    s().openDecisionTab(REF);
    expect(practice(p).decisions.map((d) => d.id)).toEqual([id]);
    expect(practice(p).beside).toEqual([]);
    expect(s().practiceRows[decisionRowKey(p, id)]).toBe(true);
    expect(s().pendingReveal).toEqual({ practiceId: p, rowKey: decisionRowKey(p, id) });
    expect(s().workspaceTabs).toEqual([]);
  });

  it('openDecisionTab with no practice creates «Sentenze»', () => {
    flagOn();
    s().openDecisionTab(REF);
    expect(s().practices.map((p) => p.label)).toEqual(['Sentenze']);
  });

  it('openDecisionTab beside a practice or a window lands in that practice, not the active one', () => {
    flagOn();
    const first = s().createPractice('Prima');
    const topic = s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno');
    s().createPractice('Seconda');
    s().openDecisionTab(REF, { besideTabId: topic });
    expect(practice(first).decisions).toHaveLength(1);
    s().openDecisionTab({ ...REF, numero: 1 }, { besideTabId: first });
    expect(practice(first).decisions).toHaveLength(2);
    expect(s().activePracticeId).toBe(first);
  });

  it('a decision asked for by its address is drained once into the active practice', () => {
    flagOn();
    const p = s().createPractice('P');
    s().requestOpenDecision(REF);
    s().drainPendingDecision();
    expect(s().drainPendingDecision()).toBeNull();
    expect(practice(p).decisions).toHaveLength(1);
    expect(s().pendingDecision).toBeNull();
  });

  it('openDecisionSearchTab: a topic search in the active practice\'s windows, once per query', () => {
    flagOn();
    const p = s().createPractice('P');
    const id = s().openDecisionSearchTab({ tema: 'perdita di chance' }, 'Tema: perdita di chance');
    const again = s().openDecisionSearchTab({ tema: '  Perdita di  chance ' }, 'Tema: perdita di chance');
    expect(again).toBe(id);
    expect(practice(p).beside).toEqual([
      { id, kind: 'decision-search', query: { tema: 'perdita di chance' }, label: 'Tema: perdita di chance' },
    ]);
    expect(s().workspaceTabs).toEqual([]);
  });

  it('openDecisionSearchTab with no practice creates one, active', () => {
    flagOn();
    s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno');
    expect(s().practices).toHaveLength(1);
    expect(s().activePracticeId).toBe(s().practices[0].id);
  });

  it('focusArticleInTab on a practice reveals the row holding the article', () => {
    flagOn();
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5'), article(L24, '7')]);
    s().createPractice('Altra');
    s().focusArticleInTab(practiceId, '7');
    const rowKey = articleRowKey(practiceId, actId, practiceArticleKey(article(L24, '7')));
    expect(s().activePracticeId).toBe(practiceId);
    expect(s().practiceRows[rowKey]).toBe(true);
    expect(s().pendingReveal).toEqual({ practiceId, rowKey });
  });

  it('addNormaIndexToTab drops the act on the practice it names, else the active one', () => {
    flagOn();
    const p = s().createPractice('P');
    const actId = s().addNormaIndexToTab('not-a-practice', CC_RD);
    expect(practice(p).acts.map((a) => a.id)).toEqual([actId]);
    expect(s().structureWindow.blockId).toBe(actId);
    expect(s().workspaceTabs).toEqual([]);
  });

  it('revealPracticeDecision opens the decision\'s row and makes its practice active, in one write', () => {
    flagOn();
    const { practiceId, decisionId } = s().openDecision(FOUND, { open: false });
    s().createPractice('Altra');
    const writes: Array<string | null> = [];
    const unsubscribe = appStore.subscribe((state) => writes.push(state.activePracticeId));
    expect(s().revealPracticeDecision(practiceId, decisionId)).toBe(true);
    unsubscribe();
    expect(writes).toEqual([practiceId]);
    expect(s().takeReveal(practiceId)).toEqual({ rowKey: decisionRowKey(practiceId, decisionId) });
    expect(s().revealPracticeDecision(practiceId, 'gone')).toBe(false);
  });
});

describe('the ways in are unchanged with the flag off', () => {
  it('openDecisionTab and openDecisionSearchTab open tabs; no practice is written', () => {
    flagOff();
    s().openDecisionTab(REF);
    s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno');
    expect(s().workspaceTabs.map((t) => t.view?.kind)).toEqual(['decision', 'decision-search']);
    expect(s().practices).toEqual([]);
  });
});

describe('the live-tab rule is gone (carry-over rulings 10, 14)', () => {
  it('moving an act leaves a tab-shaped entry as it was', () => {
    flagOn();
    const from = s().createPractice('Da');
    const { actId } = s().addArticlesToPractice(from, L24, [article(L24, '5')]);
    const to = s().createPractice('A', { activate: false });
    const tabEntry = { tabId: from, blockId: actId, articleId: '5', label: 'art. 5' };
    // forged as given: the store keeps a tab entry only when it names no practice's subject
    appStore.setState({ readingBackStack: [tabEntry] });
    s().moveActToPractice(actId, from, to);
    expect(s().readingBackStack).toEqual([tabEntry]);
  });
});
