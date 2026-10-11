import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appStore, type WorkspaceTab } from '../useAppStore';
import {
  articleRowKey, articleWindowId, decisionRowKey, decisionWindowId, practiceArticleKey, type BesideRef, type Practice,
} from '../../utils/practice';
import type { DecisionReference } from '../../types/decisions';
import { formatDecisionShort } from '../../utils/decisionLinks';
import { FOUND, L24, article } from '../../utils/__fixtures__/savedWorkspaces';

type AppState = ReturnType<typeof appStore.getState>;
const s = (): AppState => appStore.getState();
const practice = (id: string): Practice => {
  const found = s().practices.find((p) => p.id === id);
  if (!found) throw new Error(`no practice ${id}`);
  return found;
};
const flagOn = () => vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
const flagOff = () => vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', '');

const PLAIN: DecisionReference = { corte: 'cassazione', numero: 28994, anno: 2019 };
const WITH_SECTION: DecisionReference = { ...PLAIN, sezione: '3' };
const PENAL: DecisionReference = { ...FOUND, archivio: 'penale' };
/** A citation without the archive: the court's answer lists the civil and the penal decision. */
const HOMONYMS: DecisionReference = { ...PLAIN, sezione: 'U' };
const OTHER: DecisionReference = { corte: 'cassazione', numero: 577, anno: 2008, archivio: 'civile' };
const ATTRS = { sezione: '3', tipo: 'Ordinanza', data_deposito: '2019-11-11' };
const TOPIC: BesideRef = { id: 'search:tema', kind: 'decision-search', query: { tema: 'danno' }, label: 'Tema: danno' };

/** A practice holding L24 art. 5 and art. 7, with nothing open. */
function withArticles(): { practiceId: string; actId: string; key5: string; key7: string } {
  const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5'), article(L24, '7')]);
  return { practiceId, actId, key5: practiceArticleKey(article(L24, '5')), key7: practiceArticleKey(article(L24, '7')) };
}

beforeEach(() => {
  appStore.setState({
    practices: [], activePracticeId: null, practicesSeeded: true, practiceRows: {}, pendingReveal: null,
    practiceNotice: null, structureWindow: { blockId: null, position: { x: 0, y: 0 } }, readingBackStack: [],
    workspaceTabs: [], decisionFocusRequest: null,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('openDecision: one entry per decision per practice (§6.1)', () => {
  it('the same decision opened three ways is one entry and one window', () => {
    const first = s().openDecision(PLAIN);
    const again = s().openDecision(PLAIN);
    const sectioned = s().openDecision(WITH_SECTION);
    expect(again).toEqual(first);
    expect(sectioned).toEqual(first);
    const p = practice(first.practiceId);
    expect(p.decisions).toHaveLength(1);
    expect(p.beside).toEqual([{ id: decisionWindowId(first.decisionId), kind: 'decision', decisionId: first.decisionId }]);
    expect(s().activePracticeId).toBe(first.practiceId);
  });

  it('a new entry is not identified, labelled from the citation, in a practice created when there is none', () => {
    const { practiceId, decisionId } = s().openDecision(PLAIN);
    expect(practice(practiceId).label).toBe('Sentenze');
    expect(practice(practiceId).decisions).toEqual([
      { id: decisionId, reference: PLAIN, label: formatDecisionShort(PLAIN), identified: false },
    ]);
  });

  it('an unresolved entry learns the section a later citation adds (today\'s rule)', () => {
    const { practiceId } = s().openDecision(PLAIN);
    s().openDecision(WITH_SECTION);
    const [entry] = practice(practiceId).decisions;
    expect(entry.reference).toEqual(WITH_SECTION);
    expect(entry.label).toContain('sez. III');
  });

  it('a citation with an archive does not match an entry of the other archive', () => {
    const civil = s().openDecision(FOUND, { beside: false });
    const penal = s().openDecision(PENAL, { beside: false });
    expect(penal.decisionId).not.toBe(civil.decisionId);
    expect(practice(civil.practiceId).decisions).toHaveLength(2);
    // one without an archive matches an entry of either
    expect(s().openDecision(PLAIN, { beside: false }).decisionId).toBe(civil.decisionId);
  });

  it('lands in the practice named, and makes it active to read the decision', () => {
    const target = s().createPractice('Dossier', { activate: false });
    const active = s().createPractice('Altra');
    expect(s().activePracticeId).toBe(active);
    const { practiceId } = s().openDecision(FOUND, { practiceId: target });
    expect(practiceId).toBe(target);
    expect(practice(target).decisions).toHaveLength(1);
    expect(practice(active).decisions).toHaveLength(0);
    expect(s().activePracticeId).toBe(target);
  });

  it('beside: false adds the entry, opens no window and reveals its row', () => {
    const { practiceId, decisionId } = s().openDecision(FOUND, { beside: false });
    const rowKey = decisionRowKey(practiceId, decisionId);
    expect(practice(practiceId).beside).toEqual([]);
    expect(s().practiceRows).toEqual({ [rowKey]: true });
    expect(s().takeReveal(practiceId)).toEqual({ rowKey });
    expect(s().takeReveal(practiceId)).toBeNull();
  });

  it('open: false adds the entry closed: no window, the reveal untouched, no row; three in a row stay closed', () => {
    const target = s().createPractice('Dossier', { custom: true });
    const { actId, key5 } = (() => {
      const added = s().addArticlesToPractice(target, L24, [article(L24, '5')], { reveal: 'first' });
      return { ...added, key5: practiceArticleKey(article(L24, '5')) };
    })();
    const reveal = s().pendingReveal;
    const rows = s().practiceRows;
    for (const reference of [FOUND, OTHER, PENAL]) {
      s().openDecision(reference, { practiceId: target, open: false, beside: true });
    }
    const p = practice(target);
    expect(p.decisions).toHaveLength(3);
    expect(p.beside).toEqual([]);
    expect(s().pendingReveal).toEqual(reveal);
    expect(s().practiceRows).toEqual(rows);
    expect(s().practiceRows).toEqual({ [articleRowKey(target, actId, key5)]: true });
  });

  it('with an asker, the window the link was clicked in stays; the oldest other goes (T16)', () => {
    const { practiceId, actId, key5, key7 } = withArticles();
    s().openBeside(practiceId, { id: articleWindowId(actId, key5), kind: 'article', actId, articleKey: key5 });
    s().openBeside(practiceId, { id: articleWindowId(actId, key7), kind: 'article', actId, articleKey: key7 });
    const { decisionId } = s().openDecision(FOUND, { askerId: articleWindowId(actId, key5) });
    expect(practice(practiceId).beside.map((b) => b.id)).toEqual([articleWindowId(actId, key5), decisionWindowId(decisionId)]);
    // the replaced subject stays in the table
    expect(practice(practiceId).acts[0].articles).toHaveLength(2);
  });

  it('a topic opens a window and no entry (T8)', () => {
    const id = s().createPractice('P');
    s().openBeside(id, TOPIC);
    expect(practice(id).beside).toEqual([TOPIC]);
    expect(practice(id).decisions).toEqual([]);
    // the same topic again moves nothing
    s().openBeside(id, { ...TOPIC, id: 'search:other-id' });
    expect(practice(id).beside).toEqual([TOPIC]);
  });
});

describe('setDecisionEntryIdentity', () => {
  it('records the identity, the label, the date of deposit, the type and the section', () => {
    const { practiceId, decisionId } = s().openDecision(PLAIN);
    s().setDecisionEntryIdentity(practiceId, decisionId, FOUND, ATTRS, 'Cass. civ., sez. III, n. 28994/2019');
    expect(practice(practiceId).decisions).toEqual([{
      id: decisionId, reference: FOUND, label: 'Cass. civ., sez. III, n. 28994/2019', identified: true,
      depositDate: '2019-11-11', tipo: 'Ordinanza', sezione: '3',
    }]);
  });

  it('a found identity another entry holds merges into it: its window, its row, the way back follow, and it asks for focus', () => {
    flagOn();
    // a citation without the archive, read in a window; then the decision cited with its archive
    const chosen = s().openDecision(HOMONYMS);
    const held = s().openDecision(FOUND, { beside: false });
    expect(chosen.decisionId).not.toBe(held.decisionId);
    s().setDecisionEntryIdentity(held.practiceId, held.decisionId, FOUND, { tipo: 'Sentenza' }, 'Cass. civ., n. 28994/2019');
    // the first one read as a row too, the way back naming it; then its candidate is chosen
    s().setRowOpen(decisionRowKey(held.practiceId, chosen.decisionId), true);
    s().pushReadingBack({ tabId: held.practiceId, blockId: chosen.decisionId, articleId: '', label: 'Cass. civ., n. 28994/2019' });
    s().setDecisionEntryIdentity(held.practiceId, chosen.decisionId, FOUND, ATTRS, 'Cass. civ., sez. III, n. 28994/2019');

    const p = practice(held.practiceId);
    expect(p.decisions).toEqual([{
      id: held.decisionId, reference: FOUND, label: 'Cass. civ., n. 28994/2019', identified: true,
      depositDate: '2019-11-11', tipo: 'Sentenza', sezione: '3',
    }]);
    expect(p.beside).toEqual([{ id: decisionWindowId(held.decisionId), kind: 'decision', decisionId: held.decisionId }]);
    expect(s().practiceRows[decisionRowKey(held.practiceId, held.decisionId)]).toBe(true);
    expect(s().practiceRows[decisionRowKey(held.practiceId, chosen.decisionId)]).toBeUndefined();
    expect(s().readingBackStack).toEqual([{
      practiceId: held.practiceId, subject: { kind: 'decision', decisionId: held.decisionId }, place: 'table',
      label: 'Cass. civ., n. 28994/2019',
    }]);
    expect(s().decisionFocusRequest).toBe(held.decisionId);
  });

  it('a pending reveal of the absorbed entry names the survivor', () => {
    const chosen = s().openDecision(HOMONYMS, { beside: false });
    const held = s().openDecision(FOUND, { open: false });
    s().setDecisionEntryIdentity(held.practiceId, chosen.decisionId, FOUND, {}, 'Cass. civ., n. 28994/2019');
    expect(s().takeReveal(held.practiceId)).toEqual({ rowKey: decisionRowKey(held.practiceId, held.decisionId) });
  });

  it('two windows on the decisions that merge become one window on the survivor', () => {
    const chosen = s().openDecision(HOMONYMS);
    const held = s().openDecision(FOUND);
    expect(practice(held.practiceId).beside).toHaveLength(2);
    s().setDecisionEntryIdentity(held.practiceId, chosen.decisionId, FOUND, {}, 'Cass. civ., n. 28994/2019');
    expect(practice(held.practiceId).beside).toEqual([{ id: decisionWindowId(held.decisionId), kind: 'decision', decisionId: held.decisionId }]);
  });

  it('ignores an unknown practice or entry', () => {
    const { practiceId } = s().openDecision(PLAIN);
    const before = s().practices;
    s().setDecisionEntryIdentity('gone', 'x', FOUND, {}, 'x');
    s().setDecisionEntryIdentity(practiceId, 'gone', FOUND, {}, 'x');
    expect(s().practices).toBe(before);
  });
});

describe('removePracticeDecision, openBeside, closeBeside', () => {
  it('removes the entry with its window, its row and its reveal', () => {
    const { practiceId, decisionId } = s().openDecision(FOUND, { beside: false });
    s().openBeside(practiceId, { id: decisionWindowId(decisionId), kind: 'decision', decisionId });
    s().removePracticeDecision(practiceId, decisionId);
    const p = practice(practiceId);
    expect(p.decisions).toEqual([]);
    expect(p.beside).toEqual([]);
    expect(s().practiceRows).toEqual({});
    expect(s().pendingReveal).toBeNull();
  });

  it('a third window takes the place of the oldest; the subject stays in the table; closing one leaves it there', () => {
    const { practiceId, actId, key5, key7 } = withArticles();
    const w5: BesideRef = { id: articleWindowId(actId, key5), kind: 'article', actId, articleKey: key5 };
    const w7: BesideRef = { id: articleWindowId(actId, key7), kind: 'article', actId, articleKey: key7 };
    s().openBeside(practiceId, w5);
    s().openBeside(practiceId, w7);
    s().openBeside(practiceId, TOPIC);
    expect(practice(practiceId).beside).toEqual([w7, TOPIC]);
    s().closeBeside(practiceId, w7.id);
    expect(practice(practiceId).beside).toEqual([TOPIC]);
    expect(practice(practiceId).acts[0].articles).toHaveLength(2);
  });

  it('opens nothing for a subject the practice does not hold, or a practice that is not open', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { practiceId, actId } = withArticles();
    s().openBeside(practiceId, { id: 'x', kind: 'article', actId, articleKey: 'nope' });
    s().openBeside(practiceId, { id: 'y', kind: 'decision', decisionId: 'nope' });
    s().openBeside('gone', TOPIC);
    expect(practice(practiceId).beside).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('a window opened beside makes its practice active', () => {
    const a = s().createPractice('A');
    s().createPractice('B');
    s().openBeside(a, TOPIC);
    expect(s().activePracticeId).toBe(a);
  });
});

describe('the way back over practices (§6.3)', () => {
  it('flag on: an entry naming a practice is stored as a table entry, one naming a window as a beside entry', () => {
    flagOn();
    const { practiceId, actId, key5, key7 } = withArticles();
    s().openBeside(practiceId, { id: articleWindowId(actId, key7), kind: 'article', actId, articleKey: key7 });
    s().pushReadingBack({ tabId: practiceId, blockId: actId, articleId: '5', label: 'art. 5' });
    s().pushReadingBack({ tabId: articleWindowId(actId, key7), blockId: actId, articleId: '7', label: 'art. 7' });
    expect(s().readingBackStack).toEqual([
      { practiceId, subject: { kind: 'article', actId, articleKey: key5 }, place: 'table', label: 'art. 5' },
      { practiceId, subject: { kind: 'article', actId, articleKey: key7 }, place: 'beside', label: 'art. 7' },
    ]);
  });

  it('flag off: every entry is kept as given', () => {
    flagOff();
    const { practiceId, actId } = withArticles();
    const entry = { tabId: practiceId, blockId: actId, articleId: '5', label: 'art. 5' };
    s().pushReadingBack(entry);
    expect(s().readingBackStack).toEqual([entry]);
  });

  it('flag on: an entry live in a tab stays a tab entry (a seeded practice shares its tab\'s id)', () => {
    flagOn();
    const { practiceId, actId } = withArticles();
    const tab = {
      id: practiceId, label: 'Tab', position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, zIndex: 1,
      isMinimized: false, isHidden: false, labelIsCustom: false,
      content: [{ type: 'norma', id: actId, norma: L24, articles: [article(L24, '5')], isCollapsed: false }],
    } as WorkspaceTab;
    appStore.setState({ workspaceTabs: [tab] });
    const entry = { tabId: practiceId, blockId: actId, articleId: '5', label: 'art. 5' };
    s().pushReadingBack(entry);
    expect(s().readingBackStack).toEqual([entry]);
  });

  it('a table entry makes its practice active and reveals the row', () => {
    flagOn();
    const { practiceId, actId, key5 } = withArticles();
    s().pushReadingBack({ tabId: practiceId, blockId: actId, articleId: '5', label: 'art. 5' });
    const other = s().createPractice('Altra');
    expect(s().activePracticeId).toBe(other);
    const popped = s().popReadingBack();
    expect(popped).toEqual(expect.objectContaining({ practiceId, place: 'table' }));
    expect(s().activePracticeId).toBe(practiceId);
    const rowKey = articleRowKey(practiceId, actId, key5);
    expect(s().practiceRows[rowKey]).toBe(true);
    expect(s().takeReveal(practiceId)).toEqual({ rowKey });
    expect(s().readingBackStack).toEqual([]);
  });

  it('a table entry of a decision reveals its row', () => {
    flagOn();
    const { practiceId, decisionId } = s().openDecision(FOUND);
    s().pushReadingBack({ tabId: practiceId, blockId: decisionId, articleId: '', label: 'Cass.' });
    s().popReadingBack();
    expect(s().takeReveal(practiceId)).toEqual({ rowKey: decisionRowKey(practiceId, decisionId) });
  });

  it('a beside entry reopens the window, after it was closed', () => {
    flagOn();
    const { practiceId, actId, key7 } = withArticles();
    const w7: BesideRef = { id: articleWindowId(actId, key7), kind: 'article', actId, articleKey: key7 };
    s().openBeside(practiceId, w7);
    s().pushReadingBack({ tabId: w7.id, blockId: actId, articleId: '7', label: 'art. 7' });
    s().closeBeside(practiceId, w7.id);
    s().createPractice('Altra');
    s().popReadingBack();
    expect(s().activePracticeId).toBe(practiceId);
    expect(practice(practiceId).beside).toEqual([w7]);
  });

  it('an entry whose practice was closed or whose subject was removed is skipped', () => {
    flagOn();
    const kept = withArticles();
    s().pushReadingBack({ tabId: kept.practiceId, blockId: kept.actId, articleId: '5', label: 'art. 5' });
    s().pushReadingBack({ tabId: kept.practiceId, blockId: kept.actId, articleId: '7', label: 'art. 7' });
    const closed = s().createPractice('Chiusa');
    const decision = s().openDecision(FOUND, { practiceId: closed, beside: false });
    s().pushReadingBack({ tabId: closed, blockId: decision.decisionId, articleId: '', label: 'Cass.' });
    s().closePractice(closed);
    s().removePracticeArticle(kept.practiceId, kept.actId, kept.key7);
    const popped = s().popReadingBack();
    expect(popped && popped.label).toBe('art. 5');
    expect(s().readingBackStack).toEqual([]);
  });

  it('the old tab entries still work while both shapes exist', () => {
    flagOn();
    withArticles();
    const tab = {
      id: 'tab-a', label: 'Tab', position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, zIndex: 1,
      isMinimized: false, isHidden: false, labelIsCustom: false,
      content: [{ type: 'norma', id: 'block-a', norma: L24, articles: [], isCollapsed: false }],
    } as WorkspaceTab;
    appStore.setState({ workspaceTabs: [tab] });
    const old = { tabId: 'tab-a', blockId: 'block-a', articleId: '2043', label: 'art. 2043' };
    s().pushReadingBack(old);
    expect(s().popReadingBack()).toEqual(old);
  });

  it('moving an act carries its table entries to the other practice, under the act\'s new id', () => {
    flagOn();
    const from = s().createPractice('Da');
    const { actId } = s().addArticlesToPractice(from, L24, [article(L24, '5')]);
    const to = s().createPractice('A', { activate: false });
    const { actId: heldId } = s().addArticlesToPractice(to, L24, [article(L24, '7')]);
    s().pushReadingBack({ tabId: from, blockId: actId, articleId: '5', label: 'art. 5' });
    s().moveActToPractice(actId, from, to);
    expect(s().readingBackStack).toEqual([{
      practiceId: to, subject: { kind: 'article', actId: heldId, articleKey: practiceArticleKey(article(L24, '5')) },
      place: 'table', label: 'art. 5',
    }]);
    s().popReadingBack();
    expect(s().activePracticeId).toBe(to);
  });

  it('revealPracticeArticle makes its practice active in the same step (ruling 9)', () => {
    const { practiceId, actId } = withArticles();
    s().createPractice('Altra');
    const writes: Array<string | null> = [];
    const unsubscribe = appStore.subscribe((state) => writes.push(state.activePracticeId));
    expect(s().revealPracticeArticle(practiceId, actId, '7')).toBe(true);
    unsubscribe();
    expect(writes).toEqual([practiceId]);
  });
});
