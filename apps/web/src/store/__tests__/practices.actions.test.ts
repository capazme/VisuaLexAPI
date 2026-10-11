import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appStore } from '../useAppStore';
import { articleRowKey, decisionRowKey, practiceArticleKey, MAX_PRACTICE_LABEL, type Practice } from '../../utils/practice';
import { shortAct } from '../../utils/sources';
import { CC_BARE, CC_RD, L24, L241, article } from '../../utils/__fixtures__/savedWorkspaces';

type AppState = ReturnType<typeof appStore.getState>;
const s = (): AppState => appStore.getState();
const PAST = { data_versione: '2007-12-29' };
const practice = (id: string): Practice => {
  const found = s().practices.find((p) => p.id === id);
  if (!found) throw new Error(`no practice ${id}`);
  return found;
};

beforeEach(() => {
  appStore.setState({
    practices: [], activePracticeId: null, practicesSeeded: true, practiceRows: {}, pendingReveal: null,
    practiceNotice: null, structureWindow: { blockId: null, position: { x: 0, y: 0 } }, readingBackStack: [],
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('a search lands in a practice (T11, §5.1)', () => {
  it('into no practice: creates one named after the act and makes it active', () => {
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    expect(s().practices).toHaveLength(1);
    expect(s().activePracticeId).toBe(practiceId);
    const created = practice(practiceId);
    expect(created.label).toBe(shortAct(L24));
    expect(created.labelIsCustom).toBe(false);
    expect(created.acts.map((a) => a.id)).toEqual([actId]);
  });

  it('a label asked for names the practice created', () => {
    const { practiceId } = s().addArticlesToPractice(null, L24, [article(L24, '5')], { label: '  Responsabilità medica ' });
    expect(practice(practiceId).label).toBe('Responsabilità medica');
  });

  it('a second act enters the same practice; an article of the first act joins its act', () => {
    const first = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    const second = s().addArticlesToPractice(null, CC_RD, [article(CC_RD, '2043', { allegato: '2' })]);
    const third = s().addArticlesToPractice(null, L24, [article(L24, '7')]);
    expect(second.practiceId).toBe(first.practiceId);
    expect(third.actId).toBe(first.actId);
    expect(s().practices).toHaveLength(1);
    expect(practice(first.practiceId).acts.map((a) => a.articles.length)).toEqual([2, 1]);
  });

  it('an unknown practice id lands in the active practice and warns naming it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const active = s().createPractice('Pratica attiva');
    const { practiceId } = s().addArticlesToPractice('closed-meanwhile', L24, [article(L24, '5')]);
    expect(practiceId).toBe(active);
    expect(s().practices).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('closed-meanwhile');
  });

  it('an unknown practice id with no practice at all creates one and makes it active', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { practiceId } = s().addArticlesToPractice('gone', L24, [article(L24, '5')]);
    expect(s().activePracticeId).toBe(practiceId);
    expect(practice(practiceId).label).toBe(shortAct(L24));
  });

  it('a named practice receives the articles without becoming active', () => {
    const target = s().createPractice('Dossier', { custom: true, activate: false });
    const active = s().createPractice('Altra');
    s().addArticlesToPractice(target, L24, [article(L24, '5')]);
    expect(practice(target).acts).toHaveLength(1);
    expect(practice(active).acts).toHaveLength(0);
    expect(s().activePracticeId).toBe(active);
  });
});

describe('the reveal (pendingReveal, gotcha 14)', () => {
  it('opens the asked row and is taken once: a double invocation gets null the second time', () => {
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5'), article(L24, '7')], { reveal: '7' });
    const rowKey = articleRowKey(practiceId, actId, practiceArticleKey(article(L24, '7')));
    expect(s().practiceRows[rowKey]).toBe(true);
    expect(s().takeReveal(practiceId)).toEqual({ rowKey });
    expect(s().takeReveal(practiceId)).toBeNull();
    expect(s().practiceRows[rowKey]).toBe(true);
  });

  it("'first' reveals the first article given", () => {
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '7'), article(L24, '5')], { reveal: 'first' });
    expect(s().takeReveal(practiceId)).toEqual({ rowKey: articleRowKey(practiceId, actId, practiceArticleKey(article(L24, '7'))) });
  });

  it('is not taken by another practice', () => {
    const { practiceId } = s().addArticlesToPractice(null, L24, [article(L24, '5')], { reveal: 'first' });
    expect(s().takeReveal('another')).toBeNull();
    expect(s().takeReveal(practiceId)).not.toBeNull();
  });

  it('a past text search into an act holding the text in force reveals the past-text row (D15)', () => {
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    s().addArticlesToPractice(practiceId, L24, [article(L24, '5', PAST)], { reveal: '5' });
    const act = practice(practiceId).acts[0];
    expect(act.articles).toHaveLength(2);
    const pastKey = articleRowKey(practiceId, actId, practiceArticleKey(article(L24, '5', PAST)));
    expect(s().takeReveal(practiceId)).toEqual({ rowKey: pastKey });
    expect(s().practiceRows).toEqual({ [pastKey]: true });
  });

  it('a reveal that matches nothing this call brought in falls back to the act\'s row', () => {
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    s().addArticlesToPractice(practiceId, L24, [article(L24, '7')], { reveal: '5' });
    expect(s().takeReveal(practiceId)).toEqual({ rowKey: articleRowKey(practiceId, actId, practiceArticleKey(article(L24, '5'))) });
  });

  it('adds raise one notification, a new practice included', () => {
    const listener = vi.fn();
    const unsubscribe = appStore.subscribe(listener);
    s().addArticlesToPractice(null, L24, [article(L24, '5')], { reveal: 'first' });
    expect(listener).toHaveBeenCalledTimes(1);
    s().addArticlesToPractice(null, L24, [article(L24, '7')]);
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('without reveal, nothing opens', () => {
    s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    expect(s().practiceRows).toEqual({});
    expect(s().pendingReveal).toBeNull();
  });
});

describe('revealPracticeArticle (T2, gotcha 9)', () => {
  it('finds «1 bis» as 1-bis and reveals its row', () => {
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '1-bis')]);
    expect(s().revealPracticeArticle(practiceId, actId, '1 bis')).toBe(true);
    const rowKey = articleRowKey(practiceId, actId, practiceArticleKey(article(L24, '1-bis')));
    expect(s().practiceRows[rowKey]).toBe(true);
    expect(s().takeReveal(practiceId)).toEqual({ rowKey });
  });

  it('unfolds a folded act to show the row', () => {
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    s().toggleActCollapse(practiceId, actId);
    expect(s().revealPracticeArticle(practiceId, actId, '5')).toBe(true);
    expect(practice(practiceId).acts[0].isCollapsed).toBe(false);
  });

  it('finds a code article with or without all2:', () => {
    const { practiceId, actId } = s().addArticlesToPractice(null, CC_RD, [article(CC_RD, '2043', { allegato: '2' })]);
    expect(s().revealPracticeArticle(practiceId, actId, '2043')).toBe(true);
    s().takeReveal(practiceId);
    expect(s().revealPracticeArticle(practiceId, actId, 'all2:2043')).toBe(true);
    expect(s().takeReveal(practiceId)).toEqual({
      rowKey: articleRowKey(practiceId, actId, practiceArticleKey(article(CC_RD, '2043', { allegato: '2' }))),
    });
  });

  it('returns false, and opens nothing, for an article not on the table or an unknown act', () => {
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    expect(s().revealPracticeArticle(practiceId, actId, '6')).toBe(false);
    expect(s().revealPracticeArticle(practiceId, 'no-act', '5')).toBe(false);
    expect(s().revealPracticeArticle('no-practice', actId, '5')).toBe(false);
    expect(s().practiceRows).toEqual({});
    expect(s().pendingReveal).toBeNull();
  });
});

describe('addActIndexToPractice («Apri l\'indice e sfoglia»)', () => {
  it('drops an article-less act and points the structure window at it, in one step', () => {
    const listener = vi.fn();
    const unsubscribe = appStore.subscribe(listener);
    const actId = s().addActIndexToPractice(null, L241);
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(s().structureWindow.blockId).toBe(actId);
    const [only] = s().practices;
    expect(only.acts).toEqual([expect.objectContaining({ id: actId, articles: [] })]);
    expect(s().activePracticeId).toBe(only.id);
  });

  it('reuses an act already there, backfills its URN, and the window points at it', () => {
    const { practiceId, actId } = s().addArticlesToPractice(null, CC_BARE, [article(CC_BARE, '2043')]);
    const indexed = s().addActIndexToPractice(practiceId, CC_RD);
    expect(indexed).toBe(actId);
    expect(practice(practiceId).acts).toHaveLength(1);
    expect(practice(practiceId).acts[0].norma.urn).toBe(CC_RD.urn);
    expect(practice(practiceId).acts[0].articles).toHaveLength(1);
    expect(s().structureWindow.blockId).toBe(actId);
  });

  it('activates a named practice that is not active', () => {
    const active = s().createPractice('Attiva');
    const named = s().createPractice('Nominata', { activate: false });
    expect(s().activePracticeId).toBe(active);
    const actId = s().addActIndexToPractice(named, L241);
    expect(s().activePracticeId).toBe(named);
    expect(practice(named).acts.map((a) => a.id)).toEqual([actId]);
  });

  it('an unknown practice id warns naming it and lands in the active practice', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const active = s().createPractice('Attiva');
    s().addActIndexToPractice('gone', L241);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('gone');
    expect(practice(active).acts).toHaveLength(1);
  });
});

describe('acts and articles', () => {
  it('removes an article: its row closes, its act stays, a window on it goes', () => {
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5'), article(L24, '7')], { reveal: '5' });
    const key = practiceArticleKey(article(L24, '5'));
    appStore.setState((st) => ({
      practices: st.practices.map((p) => ({ ...p, beside: [{ id: 'w1', kind: 'article' as const, actId, articleKey: key }] })),
    }));
    s().removePracticeArticle(practiceId, actId, key);
    const act = practice(practiceId).acts[0];
    expect(act.articles.map(practiceArticleKey)).toEqual([practiceArticleKey(article(L24, '7'))]);
    expect(s().practiceRows).toEqual({});
    expect(s().pendingReveal).toBeNull();
    expect(practice(practiceId).beside).toEqual([]);
  });

  it('removes an act with its rows, its windows and the structure window it owned', () => {
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')], { reveal: 'first' });
    s().openStructureWindow(actId);
    s().removePracticeAct(practiceId, actId);
    expect(practice(practiceId).acts).toEqual([]);
    expect(s().practiceRows).toEqual({});
    expect(s().pendingReveal).toBeNull();
    expect(s().structureWindow.blockId).toBeNull();
  });

  it('moves an act to another practice keeping its id and its articles; its open row follows', () => {
    const from = s().createPractice('Da');
    const to = s().createPractice('A', { activate: false });
    const { actId } = s().addArticlesToPractice(from, L24, [article(L24, '5'), article(L24, '7')], { reveal: '5' });
    s().addArticlesToPractice(from, CC_RD, [article(CC_RD, '2043', { allegato: '2' })]);
    s().moveActToPractice(actId, from, to);
    expect(practice(from).acts.map((a) => a.key)).not.toContain(practice(to).acts[0].key);
    expect(practice(from).acts).toHaveLength(1);
    expect(practice(to).acts).toEqual([expect.objectContaining({ id: actId })]);
    expect(practice(to).acts[0].articles).toHaveLength(2);
    expect(s().practiceRows).toEqual({ [articleRowKey(to, actId, practiceArticleKey(article(L24, '5')))]: true });
    expect(s().activePracticeId).toBe(from);
  });

  it('a pending reveal follows the act it points at', () => {
    const from = s().createPractice('Da');
    const to = s().createPractice('A', { activate: false });
    const { actId } = s().addArticlesToPractice(from, L24, [article(L24, '5')], { reveal: 'first' });
    s().moveActToPractice(actId, from, to);
    const rowKey = articleRowKey(to, actId, practiceArticleKey(article(L24, '5')));
    expect(s().takeReveal(from)).toBeNull();
    expect(s().takeReveal(to)).toEqual({ rowKey });
  });

  it('a past-text row moves with its act, beside the text in force', () => {
    const from = s().createPractice('Da');
    const to = s().createPractice('A', { activate: false });
    const { actId } = s().addArticlesToPractice(from, L24, [article(L24, '5'), article(L24, '5', PAST)], { reveal: '5' });
    s().addArticlesToPractice(to, L24, [article(L24, '5', PAST)]);
    s().moveActToPractice(actId, from, to);
    expect(practice(to).acts).toHaveLength(1);
    expect(practice(to).acts[0].articles.map(practiceArticleKey).sort()).toEqual(
      [practiceArticleKey(article(L24, '5')), practiceArticleKey(article(L24, '5', PAST))].sort(),
    );
  });

  it('the way back follows an act moved to a practice with no same act', () => {
    const from = s().createPractice('Da');
    const to = s().createPractice('A', { activate: false });
    const { actId } = s().addArticlesToPractice(from, L24, [article(L24, '5')]);
    s().pushReadingBack({ tabId: from, blockId: actId, articleId: '5', label: 'art. 5' });
    s().moveActToPractice(actId, from, to);
    expect(s().readingBackStack.at(-1)).toMatchObject({ tabId: to, blockId: actId });
  });

  it('a move raises one notification', () => {
    const from = s().createPractice('Da');
    const to = s().createPractice('A', { activate: false });
    const { actId } = s().addArticlesToPractice(from, L24, [article(L24, '5')]);
    const listener = vi.fn();
    const unsubscribe = appStore.subscribe(listener);
    s().moveActToPractice(actId, from, to);
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('the structure window is cleared when its act moves to a practice that is not active', () => {
    const from = s().createPractice('Da');
    const to = s().createPractice('A', { activate: false });
    const { actId } = s().addArticlesToPractice(from, L24, [article(L24, '5')]);
    s().openStructureWindow(actId);
    s().moveActToPractice(actId, from, to);
    expect(s().structureWindow.blockId).toBeNull();
  });

  it('the structure window follows its act into the active practice', () => {
    const from = s().createPractice('Da', { activate: false });
    const to = s().createPractice('A');
    const { actId } = s().addArticlesToPractice(from, L24, [article(L24, '5')]);
    s().openStructureWindow(actId);
    s().moveActToPractice(actId, from, to);
    expect(s().structureWindow.blockId).toBe(actId);
  });

  it('moves an act into a practice that holds the same act: one act, the target\'s id, the structure window following', () => {
    const from = s().createPractice('Da', { activate: false });
    const to = s().createPractice('A');
    const moved = s().addArticlesToPractice(from, L24, [article(L24, '5')]).actId;
    const kept = s().addArticlesToPractice(to, L24, [article(L24, '7')]).actId;
    s().openStructureWindow(moved);
    s().pushReadingBack({ tabId: from, blockId: moved, articleId: '5', label: 'art. 5' });
    s().moveActToPractice(moved, from, to);
    expect(s().readingBackStack.at(-1)).toMatchObject({ tabId: to, blockId: kept });
    expect(practice(from).acts).toEqual([]);
    expect(practice(to).acts).toHaveLength(1);
    expect(practice(to).acts[0].id).toBe(kept);
    expect(practice(to).acts[0].articles).toHaveLength(2);
    expect(s().structureWindow.blockId).toBe(kept);
  });

  it('reorders acts and folds one', () => {
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    const other = s().addArticlesToPractice(null, L241, [article(L241, '2')]).actId;
    s().reorderActs(practiceId, 1, 0);
    expect(practice(practiceId).acts.map((a) => a.id)).toEqual([other, actId]);
    s().reorderActs(practiceId, 0, 5);
    expect(practice(practiceId).acts.map((a) => a.id)).toEqual([other, actId]);
    s().toggleActCollapse(practiceId, actId);
    expect(practice(practiceId).acts[1].isCollapsed).toBe(true);
  });

  it('setRowOpen opens and closes a row', () => {
    s().setRowOpen('p/a/k', true);
    expect(s().practiceRows).toEqual({ 'p/a/k': true });
    s().setRowOpen('p/a/k', false);
    expect(s().practiceRows).toEqual({});
  });
});

describe('a call that changes nothing writes nothing', () => {
  it('takeReveal with nothing pending, an unknown or active practice id, and a row already in its state never touch the storage', () => {
    const setItem = vi.spyOn(localStorage, 'setItem');
    const { practiceId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    s().setRowOpen('p/a/k', true);
    setItem.mockClear();
    s().takeReveal(practiceId);
    s().takeReveal('another');
    s().setActivePractice('nope');
    s().setActivePractice(practiceId);
    s().setRowOpen('p/a/k', true);
    s().setRowOpen('p/other', false);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('a call that does change something does write', () => {
    const setItem = vi.spyOn(localStorage, 'setItem');
    s().setRowOpen('p/a/k', true);
    expect(setItem).toHaveBeenCalled();
  });
});

describe('row keys', () => {
  it('a decision row key is practice id then decision id', () => {
    expect(decisionRowKey('p1', 'd1')).toBe('p1/d1');
  });
});

describe('the practices themselves', () => {
  it('closing the active practice activates its neighbour: the next, else the previous', () => {
    const a = s().createPractice('A');
    const b = s().createPractice('B');
    const c = s().createPractice('C');
    s().setActivePractice(b);
    s().closePractice(b);
    expect(s().activePracticeId).toBe(c);
    s().closePractice(c);
    expect(s().activePracticeId).toBe(a);
    s().closePractice(a);
    expect(s().activePracticeId).toBeNull();
  });

  it('closing a practice that is not active keeps the active one, and drops its rows and reveal', () => {
    const a = s().createPractice('A');
    const { actId } = s().addArticlesToPractice(a, L24, [article(L24, '5')], { reveal: 'first' });
    s().openStructureWindow(actId);
    const b = s().createPractice('B');
    s().closePractice(a);
    expect(s().activePracticeId).toBe(b);
    expect(s().practiceRows).toEqual({});
    expect(s().pendingReveal).toBeNull();
    expect(s().structureWindow.blockId).toBeNull();
  });

  it('closeAllPractices empties the table and leaves the seeding marker set', () => {
    s().addArticlesToPractice(null, L24, [article(L24, '5')], { reveal: 'first' });
    s().createPractice('B');
    s().closeAllPractices();
    expect(s().practices).toEqual([]);
    expect(s().activePracticeId).toBeNull();
    expect(s().practiceRows).toEqual({});
    expect(s().pendingReveal).toBeNull();
    expect(s().practicesSeeded).toBe(true);
  });

  it('createPractice trims and caps the label, marks a custom one, activates by default', () => {
    const id = s().createPractice(`  ${'x'.repeat(200)}  `, { custom: true });
    expect(practice(id).label).toHaveLength(MAX_PRACTICE_LABEL);
    expect(practice(id).labelIsCustom).toBe(true);
    expect(s().activePracticeId).toBe(id);
    const blank = s().createPractice('   ');
    expect(practice(blank).label).toBe('Pratica');
  });

  it('createPractice with activate: false still activates when there was no active practice', () => {
    const id = s().createPractice('Sola', { activate: false });
    expect(s().activePracticeId).toBe(id);
  });

  it('renaming trims, caps at 120 characters and sets labelIsCustom; an empty name is ignored', () => {
    const id = s().createPractice('Nuova pratica');
    s().renamePractice(id, `  ${'y'.repeat(300)} `);
    expect(practice(id).label).toBe('y'.repeat(MAX_PRACTICE_LABEL));
    expect(practice(id).labelIsCustom).toBe(true);
    s().renamePractice(id, '   ');
    expect(practice(id).label).toBe('y'.repeat(MAX_PRACTICE_LABEL));
  });

  it('setActivePractice ignores an id that names no practice; reorderPractices moves one', () => {
    const a = s().createPractice('A');
    const b = s().createPractice('B');
    s().setActivePractice('nope');
    expect(s().activePracticeId).toBe(b);
    s().setActivePractice(a);
    expect(s().activePracticeId).toBe(a);
    s().reorderPractices(0, 1);
    expect(s().practices.map((p) => p.id)).toEqual([b, a]);
    s().reorderPractices(0, 9);
    expect(s().practices.map((p) => p.id)).toEqual([b, a]);
  });
});
