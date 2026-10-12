import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appStore } from '../useAppStore';
import { besideRefFor, practiceArticleKey, type Practice } from '../../utils/practice';
import { isPracticeBackEntry } from '../../utils/readingBackStack';
import type { DecisionReference } from '../../types/decisions';
import { FOUND, L24, article } from '../../utils/__fixtures__/savedWorkspaces';

// The phone's full-screen reader (spec §8, T19, P5): session state of its own, never the desktop's `beside`.

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
const PLAIN: DecisionReference = { corte: 'cassazione', numero: 28994, anno: 2019 };

/** A practice with art. 5 and 7 of l. 24/2017. */
function withArticles() {
  const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5'), article(L24, '7')]);
  const ref = (n: string) => besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(article(L24, n)) });
  return { practiceId, actId, ref5: ref('5'), ref7: ref('7') };
}

beforeEach(() => {
  vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
  savedMatchMedia = window.matchMedia;
  viewport(false);
  appStore.setState({
    practices: [], activePracticeId: null, practicesSeeded: true, practiceRows: {}, pendingReveal: null,
    practiceNotice: null, readingBackStack: [], workspaceTabs: [], windowFocusRequest: null, decisionFocusRequest: null,
    phoneReader: null, structureWindow: { blockId: null, position: { x: 0, y: 0 } },
  });
});
afterEach(() => {
  window.matchMedia = savedMatchMedia;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('openPhoneReader / closePhoneReader', () => {
  it('opens the reader on a subject the practice holds, its practice made active, in one update', () => {
    const { practiceId, ref5 } = withArticles();
    const other = s().createPractice('Altra');
    expect(s().activePracticeId).toBe(other);
    const seen: Array<[string | null, boolean]> = [];
    const stop = appStore.subscribe((state) => seen.push([state.activePracticeId, state.phoneReader !== null]));
    s().openPhoneReader(practiceId, ref5);
    stop();
    expect(seen).toEqual([[practiceId, true]]); // never the practice without the reader, or the reader without the practice
    expect(s().phoneReader).toEqual({ practiceId, ref: ref5 });
    expect(practice(practiceId).beside).toEqual([]);
  });

  it('asked again for the subject already shown, writes nothing; another subject replaces it', () => {
    const { practiceId, ref5, ref7 } = withArticles();
    s().openPhoneReader(practiceId, ref5);
    const before = s().phoneReader;
    const listener = vi.fn();
    const stop = appStore.subscribe(listener);
    s().openPhoneReader(practiceId, ref5);
    expect(listener).not.toHaveBeenCalled();
    stop();
    expect(s().phoneReader).toBe(before);
    s().openPhoneReader(practiceId, ref7);
    expect(s().phoneReader?.ref).toEqual(ref7);
  });

  it('a subject the practice does not hold, or a practice not open, opens nothing and is warned', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { practiceId, actId } = withArticles();
    s().openPhoneReader(practiceId, besideRefFor({ kind: 'article', actId, articleKey: 'nessuno|nessuno' }));
    s().openPhoneReader('gone', besideRefFor({ kind: 'decision', decisionId: 'x' }));
    expect(s().phoneReader).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('closePhoneReader clears it, and writes nothing when there is none', () => {
    const { practiceId, ref5 } = withArticles();
    s().openPhoneReader(practiceId, ref5);
    s().closePhoneReader();
    expect(s().phoneReader).toBeNull();
    const listener = vi.fn();
    const stop = appStore.subscribe(listener);
    s().closePhoneReader();
    stop();
    expect(listener).not.toHaveBeenCalled();
  });

  it('is session state: never saved with the practices', () => {
    const { practiceId, ref5 } = withArticles();
    s().openPhoneReader(practiceId, ref5);
    expect(appStore.persist.getOptions().partialize?.(s())).not.toHaveProperty('phoneReader');
  });

  it('closing its practice, closing them all and logging out clear it', () => {
    const a = withArticles();
    s().openPhoneReader(a.practiceId, a.ref5);
    s().closePractice(a.practiceId);
    expect(s().phoneReader).toBeNull();

    const b = withArticles();
    s().openPhoneReader(b.practiceId, b.ref5);
    s().closePractice(s().createPractice('Altra')); // another practice: the reader stays
    expect(s().phoneReader).not.toBeNull();
    s().closeAllPractices();
    expect(s().phoneReader).toBeNull();

    const c = withArticles();
    s().openPhoneReader(c.practiceId, c.ref5);
    s().clearUserData();
    expect(s().phoneReader).toBeNull();
  });
});

describe('a decision and a topic search on a phone', () => {
  it('openDecisionTab adds the entry and sets the reader, touching neither `beside` nor the rows', () => {
    const { practiceId, ref5 } = withArticles();
    appStore.setState((st) => ({ practices: st.practices.map((p) => ({ ...p, beside: [ref5] })) }));
    const id = s().openDecisionTab(REF_A);
    expect(practice(practiceId).decisions.map((d) => d.id)).toEqual([id]);
    expect(practice(practiceId).beside).toEqual([ref5]);
    expect(s().practiceRows).toEqual({});
    expect(s().pendingReveal).toBeNull();
    expect(s().phoneReader).toEqual({ practiceId, ref: besideRefFor({ kind: 'decision', decisionId: id }) });
  });

  it('the same decision again writes nothing; another decision replaces it in the reader', () => {
    const { practiceId } = withArticles();
    const first = s().openDecisionTab(REF_A);
    const listener = vi.fn();
    const stop = appStore.subscribe(listener);
    s().openDecisionTab(REF_A);
    stop();
    expect(listener).not.toHaveBeenCalled();
    const second = s().openDecisionTab({ ...REF_A, numero: 22222 });
    expect(second).not.toBe(first);
    expect(practice(practiceId).decisions).toHaveLength(2);
    expect(s().phoneReader?.ref).toEqual(besideRefFor({ kind: 'decision', decisionId: second }));
  });

  it('the decision a topic search\'s list opens lands in the search\'s practice and replaces the search in the reader', () => {
    const first = s().createPractice('Prima');
    const topic = s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno');
    const second = s().createPractice('Seconda');
    expect(s().activePracticeId).toBe(second);
    // the reader's list names the reader's subject as its place: the practice that holds the reader, not the active one
    expect(s().phoneReader).toMatchObject({ practiceId: first, ref: { id: topic } });
    s().openDecisionTab(REF_A, { besideTabId: topic });
    expect(practice(first).decisions).toHaveLength(1);
    expect(practice(second).decisions).toEqual([]);
    expect(s().activePracticeId).toBe(first);
    expect(s().phoneReader?.ref.kind).toBe('decision');
  });

  it('openDecisionSearchTab sets the reader on a topic search, beside nothing, once per query', () => {
    const p = s().createPractice('P');
    const id = s().openDecisionSearchTab({ tema: 'perdita di chance' }, 'Tema: perdita di chance');
    expect(practice(p).beside).toEqual([]);
    expect(s().phoneReader).toEqual({
      practiceId: p, ref: { id, kind: 'decision-search', query: { tema: 'perdita di chance' }, label: 'Tema: perdita di chance' },
    });
    const listener = vi.fn();
    const stop = appStore.subscribe(listener);
    expect(s().openDecisionSearchTab({ tema: '  Perdita di  chance ' }, 'Tema: perdita di chance')).toBe(id);
    stop();
    expect(listener).not.toHaveBeenCalled();
  });

  it('with no practice a topic search creates one, active, with the reader on it', () => {
    s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno');
    expect(s().practices).toHaveLength(1);
    expect(s().phoneReader?.practiceId).toBe(s().practices[0].id);
    expect(s().activePracticeId).toBe(s().practices[0].id);
  });

  it('on the desktop neither touches the reader', () => {
    viewport(true);
    const p = s().createPractice('P');
    s().openDecisionTab(REF_A);
    s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno');
    expect(s().phoneReader).toBeNull();
    expect(practice(p).beside.map((b) => b.kind)).toEqual(['decision', 'decision-search']);
  });

  it('a candidate chosen in the reader that is an entry already there merges into it, and the reader names the survivor', () => {
    const p = s().createPractice('P');
    const survivor = s().openDecision(FOUND, { practiceId: p, open: false }).decisionId;
    const homonym = s().openDecisionTab(PLAIN);
    expect(s().phoneReader?.ref).toEqual(besideRefFor({ kind: 'decision', decisionId: homonym }));
    s().setDecisionEntryIdentity(p, homonym, { ...FOUND }, {}, 'Cass. civ., n. 28994/2019');
    expect(practice(p).decisions.map((d) => d.id)).toEqual([survivor]);
    expect(s().phoneReader).toEqual({ practiceId: p, ref: besideRefFor({ kind: 'decision', decisionId: survivor }) });
  });
});

describe('the way back on a phone (spec §6.3)', () => {
  it('a jump from the reader is kept as a `beside` entry, and going back reopens the reader on its subject', () => {
    const { practiceId, actId, ref5, ref7 } = withArticles();
    s().openPhoneReader(practiceId, ref5);
    s().pushReadingBack({ tabId: ref5.id, blockId: actId, articleId: '5', label: 'art. 5 l. 24/2017' });
    const entry = s().readingBackStack[0];
    expect(isPracticeBackEntry(entry) && entry.place).toBe('beside');
    s().openPhoneReader(practiceId, ref7);
    s().popReadingBack();
    expect(s().phoneReader).toEqual({ practiceId, ref: ref5 });
    expect(practice(practiceId).beside).toEqual([]);
    expect(s().activePracticeId).toBe(practiceId);
  });

  it('a `beside` entry from another practice makes it active and opens the reader on it', () => {
    const a = withArticles();
    s().openPhoneReader(a.practiceId, a.ref5);
    s().pushReadingBack({ tabId: a.ref5.id, blockId: a.actId, articleId: '5', label: 'art. 5 l. 24/2017' });
    s().closePhoneReader();
    const other = s().createPractice('Altra');
    expect(s().activePracticeId).toBe(other);
    s().popReadingBack();
    expect(s().activePracticeId).toBe(a.practiceId);
    expect(s().phoneReader?.practiceId).toBe(a.practiceId);
  });

  it('a `table` entry reveals the row with the reader closed', () => {
    const { practiceId, actId, ref7 } = withArticles();
    s().pushReadingBack({ tabId: practiceId, blockId: actId, articleId: '5', label: 'art. 5 l. 24/2017' });
    s().openPhoneReader(practiceId, ref7);
    s().popReadingBack();
    expect(s().phoneReader).toBeNull();
    expect(s().pendingReveal?.practiceId).toBe(practiceId);
    expect(practice(practiceId).beside).toEqual([]);
  });

  it('a topic search in the reader is never a way-back target', () => {
    const p = s().createPractice('P');
    const id = s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno');
    s().pushReadingBack({ tabId: id, blockId: id, articleId: '', label: 'Tema: danno' });
    expect(s().readingBackStack).toHaveLength(1);
    expect(s().readingBackStack[0]).toMatchObject({ tabId: id }); // kept as given, which no tab or practice holds
    expect(s().popReadingBack()).toBeNull();
    expect(s().activePracticeId).toBe(p);
  });

  it('on the desktop a `beside` entry still opens a window, never the reader', () => {
    viewport(true);
    const { practiceId, actId, ref5 } = withArticles();
    s().openBeside(practiceId, ref5);
    s().pushReadingBack({ tabId: ref5.id, blockId: actId, articleId: '5', label: 'art. 5 l. 24/2017' });
    s().closeBeside(practiceId, ref5.id);
    s().popReadingBack();
    expect(practice(practiceId).beside).toEqual([ref5]);
    expect(s().phoneReader).toBeNull();
  });
});
