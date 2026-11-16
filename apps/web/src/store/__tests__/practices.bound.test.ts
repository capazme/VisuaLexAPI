import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appStore } from '../useAppStore';
import {
  articleRowKey, besideRefFor, corpusPractices, decisionRowKey, isBoundPractice, practiceArticleKey, sanitizePractices,
  type Practice,
} from '../../utils/practice';
import { findTargetsInScope } from '../../utils/findScope';
import { forgetUserData, parkedKey, OWNER_KEY } from '../../services/sessionEnd';
import * as articleFetchCache from '../../utils/articleFetchCache';
import { CC_RD, L24, article } from '../../utils/__fixtures__/savedWorkspaces';
import { memoryStorage } from '../../test/memoryStorage';
import type { Dossier, DossierItem } from '../../types';
import type { DecisionReference } from '../../types/decisions';

/**
 * LC51, c1: a reading table bound to a dossier (a practice with `dossierId`), session only, never the Corpus's
 * active practice, left out of every place the Corpus lists or saves its practices.
 */

type AppState = ReturnType<typeof appStore.getState>;
const s = (): AppState => appStore.getState();
const options = () => appStore.persist.getOptions() as unknown as {
  name: string;
  partialize: (state: AppState) => Record<string, unknown>;
  merge: (persisted: unknown, current: AppState) => AppState;
};
const practice = (id: string): Practice => {
  const found = s().practices.find((p) => p.id === id);
  if (!found) throw new Error(`no practice ${id}`);
  return found;
};

const norma = (numero: string, more: Record<string, string> = {}): DossierItem => ({
  id: `n-${numero}-${more.data_versione ?? ''}`, addedAt: '', type: 'norma',
  data: { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08', numero_articolo: numero, versione: 'vigente', ...more },
});
const SENT: DecisionReference = { corte: 'cassazione', archivio: 'civile', numero: 31310, anno: 2024 };
const sentenza: DossierItem = {
  id: 's-1', addedAt: '', type: 'sentenza',
  data: { ...SENT, sezione: '3', tipo: 'sentenza', data_deposito: '2024-12-05', etichetta: 'Cass. civ. 31310/2024' },
};
const dossier = (items: DossierItem[], more: Partial<Dossier> = {}): Dossier => ({
  id: 'dos-1', title: 'Responsabilità medica', createdAt: '', items, ...more,
});

let savedMatchMedia: typeof window.matchMedia;
function viewport(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  savedMatchMedia = window.matchMedia;
  viewport(true);
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, phoneReader: null,
    practiceNotice: null, structureWindow: { blockId: null, position: { x: 0, y: 0 } }, readingBackStack: [],
  });
});
afterEach(() => {
  window.matchMedia = savedMatchMedia;
  appStore.setState({ corpusPracticesPending: false });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a dossier builds a bound table (LC51 c1)', () => {
  it('one practice carrying the dossier id, named after it, the articles in their acts without text, the decisions closed', () => {
    const withText = norma('7');
    (withText.data as { article_text?: string }).article_text = 'Testo salvato nella pratica';
    const id = s().openDossierPractice(dossier([norma('5'), withText, sentenza, { id: 'x', addedAt: '', type: 'note', data: 'nota' }]));
    const bound = practice(id);
    expect(isBoundPractice(bound)).toBe(true);
    expect(bound.dossierId).toBe('dos-1');
    expect(bound.label).toBe('Responsabilità medica');
    expect(bound.acts).toHaveLength(1);
    expect(bound.acts[0].articles.map((a) => a.norma_data.numero_articolo)).toEqual(['5', '7']);
    for (const a of bound.acts[0].articles) {
      expect(a.article_text).toBeUndefined();
      expect(a.norma_data).not.toHaveProperty('article_text');
    }
    expect(bound.decisions).toHaveLength(1);
    expect(bound.decisions[0]).toMatchObject({ identified: true, sezione: '3', depositDate: '2024-12-05' });
    // closed and unread: no row, no window, no reveal
    expect(s().practiceRows).toEqual({});
    expect(bound.beside).toEqual([]);
    expect(s().pendingReveal).toBeNull();
  });

  it('a dossier of 46 articles builds with no request for any text', () => {
    const fetch = vi.spyOn(articleFetchCache, 'fetchArticleForNorma');
    const items = Array.from({ length: 46 }, (_, i) => norma(String(i + 1)));
    const id = s().openDossierPractice(dossier(items));
    expect(practice(id).acts[0].articles).toHaveLength(46);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('opening the same dossier again finds its table: one per pratica', () => {
    const first = s().openDossierPractice(dossier([norma('5')]));
    const again = s().openDossierPractice(dossier([norma('5')]));
    expect(again).toBe(first);
    expect(s().practices.filter(isBoundPractice)).toHaveLength(1);
  });

  it('a past text of a dossier sits as its own row of the same act', () => {
    const id = s().openDossierPractice(dossier([norma('5'), norma('5', { versione: 'data', data_versione: '2018-01-01' })]));
    expect(practice(id).acts).toHaveLength(1);
    expect(practice(id).acts[0].articles).toHaveLength(2);
  });

  it('a row opened later takes its text, keeping its key, its open row and its window', () => {
    const id = s().openDossierPractice(dossier([norma('5')]));
    const { id: actId, articles: [row] } = practice(id).acts[0];
    const key = practiceArticleKey(row);
    s().setRowOpen(articleRowKey(id, actId, key), true);
    s().openBeside(id, besideRefFor({ kind: 'article', actId, articleKey: key }));
    const fetched = article(L24, '5', { urn: 'urn:art5' }, { url: 'https://example/5', validity: { state: 'current' } as never });
    s().setPracticeArticleText(id, actId, key, fetched);
    const filled = practice(id).acts[0].articles[0];
    expect(filled.article_text).toBe(fetched.article_text);
    expect(filled.url).toBe('https://example/5');
    expect(practiceArticleKey(filled)).toBe(key);
    expect(s().practiceRows[articleRowKey(id, actId, key)]).toBe(true);
    expect(practice(id).beside).toHaveLength(1);
  });

  it('a failed load then a good one leaves no error on the row', () => {
    const id = s().openDossierPractice(dossier([norma('5')]));
    const { id: actId, articles: [row] } = practice(id).acts[0];
    const key = practiceArticleKey(row);
    s().setPracticeArticleText(id, actId, key, { norma_data: row.norma_data, error: 'Fonte non raggiungibile' });
    expect(practice(id).acts[0].articles[0].error).toBe('Fonte non raggiungibile');
    s().setPracticeArticleText(id, actId, key, article(L24, '5'));
    expect(practice(id).acts[0].articles[0]).not.toHaveProperty('error');
    expect(practice(id).acts[0].articles[0].article_text).toBeTruthy();
  });

  it('filling a row that is not there writes nothing', () => {
    const id = s().openDossierPractice(dossier([norma('5')]));
    const before = s().practices;
    s().setPracticeArticleText(id, 'no-act', 'no-key', article(L24, '5'));
    expect(s().practices).toBe(before);
  });
});

describe('re-sync from a refreshed dossier', () => {
  it('adds what the dossier gained, keeps what is on the table only, the open rows and the windows', () => {
    const id = s().openDossierPractice(dossier([norma('5'), sentenza]));
    // read on the table: an article browsed (not in the dossier) and a window beside
    const { actId } = s().addArticlesToPractice(id, L24, [article(L24, '9')]);
    s().addArticlesToPractice(id, CC_RD, [article(CC_RD, '2043')]);
    const key5 = practiceArticleKey(practice(id).acts[0].articles[0]);
    s().setRowOpen(articleRowKey(id, actId, key5), true);
    const decisionId = practice(id).decisions[0].id;
    s().openBeside(id, besideRefFor({ kind: 'decision', decisionId }));

    const other: DossierItem = { ...sentenza, id: 's-2', data: { ...sentenza.data, numero: 1, etichetta: 'x' } as never };
    s().resyncDossierPractice(dossier([norma('5'), norma('6'), sentenza, other], { title: 'Responsabilità sanitaria' }));

    const synced = practice(id);
    expect(synced.acts[0].id).toBe(actId);
    expect(synced.acts[0].articles.map((a) => a.norma_data.numero_articolo)).toEqual(['5', '6', '9']);
    expect(synced.acts[0].articles.find((a) => a.norma_data.numero_articolo === '6')?.article_text).toBeUndefined();
    expect(synced.acts[1].articles.map((a) => a.norma_data.numero_articolo)).toEqual(['2043']);
    expect(synced.decisions.map((d) => d.id)).toContain(decisionId);
    expect(synced.decisions).toHaveLength(2);
    expect(synced.beside.map((b) => b.id)).toEqual([besideRefFor({ kind: 'decision', decisionId }).id]);
    expect(s().practiceRows[articleRowKey(id, actId, key5)]).toBe(true);
    expect(synced.label).toBe('Responsabilità sanitaria');
  });

  it('keeps the text a row already loaded', () => {
    const id = s().openDossierPractice(dossier([norma('5')]));
    const { id: actId, articles: [row] } = practice(id).acts[0];
    s().setPracticeArticleText(id, actId, practiceArticleKey(row), article(L24, '5'));
    s().resyncDossierPractice(dossier([norma('5')]));
    expect(practice(id).acts[0].articles[0].article_text).toBeTruthy();
  });

  it('a dossier whose table is not open builds nothing', () => {
    s().resyncDossierPractice(dossier([norma('5')]));
    expect(s().practices).toEqual([]);
  });
});

describe('a bound table never becomes the Corpus active practice', () => {
  const cases: Array<[string, (id: string, actId: string, key: string, decisionId: string) => void]> = [
    ['openDossierPractice', () => { s().openDossierPractice(dossier([norma('5')])); }],
    ['resyncDossierPractice', () => s().resyncDossierPractice(dossier([norma('6')]))],
    ['setActivePractice', (id) => s().setActivePractice(id)],
    ['renamePractice', (id) => s().renamePractice(id, 'Altro')],
    ['addArticlesToPractice', (id) => { s().addArticlesToPractice(id, L24, [article(L24, '9')], { reveal: 'first' }); }],
    ['addActIndexToPractice', (id) => { s().addActIndexToPractice(id, CC_RD); }],
    ['revealPracticeArticle', (id, actId) => { s().revealPracticeArticle(id, actId, '5'); }],
    ['revealPracticeRow', (id, actId, key) => { s().revealPracticeRow(id, actId, key); }],
    ['revealPracticeDecision', (id, _a, _k, decisionId) => { s().revealPracticeDecision(id, decisionId); }],
    ['setRowOpen', (id, actId, key) => s().setRowOpen(articleRowKey(id, actId, key), true)],
    ['toggleActCollapse', (id, actId) => s().toggleActCollapse(id, actId)],
    ['setPracticeArticleText', (id, actId, key) => s().setPracticeArticleText(id, actId, key, article(L24, '5'))],
    ['openDecision beside', (id) => { s().openDecision({ ...SENT, numero: 2 }, { practiceId: id }); }],
    ['openDecision in place', (id) => { s().openDecision({ ...SENT, numero: 3 }, { practiceId: id, beside: false }); }],
    ['openDecision closed', (id) => { s().openDecision({ ...SENT, numero: 4 }, { practiceId: id, open: false }); }],
    ['addKnownDecisions', (id) => s().addKnownDecisions(id, [{ ...SENT, numero: 5 }])],
    ['setDecisionEntryIdentity', (id, _a, _k, decisionId) => s().setDecisionEntryIdentity(id, decisionId, { ...SENT, numero: 6 }, {}, 'x')],
    ['markDecisionEntryRecorded', (id, _a, _k, decisionId) => s().markDecisionEntryRecorded(id, decisionId, 'k')],
    ['openBeside', (id, actId, key) => s().openBeside(id, besideRefFor({ kind: 'article', actId, articleKey: key }))],
    ['closeBeside', (id, actId, key) => s().closeBeside(id, besideRefFor({ kind: 'article', actId, articleKey: key }).id)],
    ['openTopicSearch', (id, _a, _k, decisionId) => {
      s().openBeside(id, besideRefFor({ kind: 'decision', decisionId }));
      s().openTopicSearch({ tema: 'colpa medica' }, 'colpa', { besideId: besideRefFor({ kind: 'decision', decisionId }).id });
    }],
    ['openPhoneReader', (id, actId, key) => s().openPhoneReader(id, besideRefFor({ kind: 'article', actId, articleKey: key }))],
    ['reorderActs', (id) => { s().addArticlesToPractice(id, CC_RD, [article(CC_RD, '2043')]); s().reorderActs(id, 0, 1); }],
    ['removePracticeArticle', (id, actId, key) => s().removePracticeArticle(id, actId, key)],
    ['removePracticeAct / restorePracticeAct', (id, actId) => {
      const act = practice(id).acts[0];
      s().removePracticeAct(id, actId);
      s().restorePracticeAct(id, act, 0, [], {});
    }],
    ['removePracticeDecision', (id, _a, _k, decisionId) => s().removePracticeDecision(id, decisionId)],
    ['popReadingBack', (id, actId, key) => {
      s().pushReadingBack({ tabId: id, blockId: actId, articleId: '5', articleKey: key, label: 'art. 5' });
      expect(s().popReadingBack()).not.toBeNull();
    }],
    ['closePractice', (id) => s().closePractice(id)],
  ];

  for (const start of ['a Corpus practice active', 'no practice active'] as const) {
    describe(`starting with ${start}`, () => {
      for (const [name, run] of cases) {
        it(name, () => {
          const corpusId = start === 'a Corpus practice active' ? s().createPractice('Corpus') : null;
          const id = s().openDossierPractice(dossier([norma('5'), sentenza]));
          const { id: actId, articles: [row] } = practice(id).acts[0];
          const decisionId = practice(id).decisions[0].id;
          expect(s().activePracticeId).toBe(corpusId);
          run(id, actId, practiceArticleKey(row), decisionId);
          expect(s().activePracticeId).toBe(corpusId);
        });
      }
    });
  }

  it('on a phone too: the reader of a bound table leaves the Corpus on screen', () => {
    viewport(false);
    const corpusId = s().createPractice('Corpus');
    const id = s().openDossierPractice(dossier([norma('5'), sentenza]));
    s().openDecision({ ...SENT, numero: 2 }, { practiceId: id, reader: true });
    const { id: actId, articles: [row] } = practice(id).acts[0];
    s().openPhoneReader(id, besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(row) }));
    expect(s().activePracticeId).toBe(corpusId);
  });
});

describe('a bound table is never saved in the browser', () => {
  // LC60: the Corpus practices are saved only while they wait for the riquadro (`corpusPracticesPending`).
  it('partialize leaves it out; the Corpus practices waiting for the riquadro and the active one stay', () => {
    appStore.setState({ corpusPracticesPending: true });
    const corpusId = s().createPractice('Corpus');
    s().openDossierPractice(dossier([norma('5'), sentenza]));
    const saved = options().partialize(s());
    expect((saved.practices as Practice[]).map((p) => p.id)).toEqual([corpusId]);
    expect(saved.activePracticeId).toBe(corpusId);
    expect(JSON.stringify(saved)).not.toContain('dos-1');
    expect(JSON.stringify(saved)).not.toContain('Responsabilità medica');
  });

  it('with only a bound table, nothing is saved and a reload finds no practice', () => {
    s().openDossierPractice(dossier([norma('5')]));
    const saved = JSON.parse(JSON.stringify(options().partialize(s())));
    expect(saved.practices).toEqual([]);
    expect(saved.activePracticeId).toBeNull();
    const reloaded = options().merge(saved, s());
    expect(reloaded.practices).toEqual([]);
    expect(reloaded.activePracticeId).toBeNull();
  });

  it('the store as written to the browser holds nothing of it, and a reload brings none back', async () => {
    appStore.setState({ corpusPracticesPending: true });
    const corpusId = s().createPractice('Corpus');
    s().openDossierPractice(dossier([norma('5'), sentenza]));
    const raw = localStorage.getItem(options().name);
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('dos-1');
    await appStore.persist.rehydrate();
    expect(s().practices.map((p) => p.id)).toEqual([corpusId]);
    expect(s().practices.some(isBoundPractice)).toBe(false);
    localStorage.removeItem(options().name);
  });

  it('a saved practice carrying a dossier id is dropped on load, never read as a Corpus practice', () => {
    const { practices, dropped } = sanitizePractices([
      { id: 'p1', label: 'Corpus', labelIsCustom: false, acts: [], decisions: [], beside: [] },
      { id: 'p2', label: 'Legata', labelIsCustom: true, acts: [], decisions: [], beside: [], dossierId: 'dos-1' },
    ]);
    expect(practices.map((p) => p.id)).toEqual(['p1']);
    expect(dropped.join('\n')).toContain('dossier');
  });

  it('a session end parks the Corpus practices only', () => {
    appStore.setState({ corpusPracticesPending: true });
    const corpusId = s().createPractice('Corpus');
    s().openDossierPractice(dossier([norma('5')]));
    // the browser as the store leaves it: its saved value is what `partialize` gives
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
    localStorage.setItem(OWNER_KEY, 'user-1');
    localStorage.setItem(options().name, JSON.stringify({ state: JSON.parse(JSON.stringify(options().partialize(s()))), version: 1 }));
    forgetUserData();
    const parked = JSON.parse(localStorage.getItem(parkedKey('user-1')) ?? '{}');
    expect((parked.store.practices as Practice[]).map((p) => p.id)).toEqual([corpusId]);
    expect(JSON.stringify(parked)).not.toContain('dos-1');
  });
});

describe('every exclusion ignores the bound table', () => {
  function corpusAndBound() {
    const a = s().createPractice('A');
    const id = s().openDossierPractice(dossier([norma('5')]));
    const b = s().createPractice('B');
    return { a, b, id };
  }

  it('corpusPractices: the same list when nothing is bound, the Corpus ones otherwise', () => {
    const a = s().createPractice('A');
    const list = s().practices;
    expect(corpusPractices(list)).toBe(list);
    const id = s().openDossierPractice(dossier([norma('5')]));
    expect(corpusPractices(s().practices).map((p) => p.id)).toEqual([a]);
    expect(s().practices.map((p) => p.id)).toContain(id);
  });

  it('closing the active practice hands over to a Corpus neighbour, past the bound table', () => {
    const { a, b } = corpusAndBound();
    expect(s().activePracticeId).toBe(b);
    s().closePractice(b);
    expect(s().activePracticeId).toBe(a);
    s().closePractice(a);
    expect(s().activePracticeId).toBeNull();
  });

  it('«Chiudi tutte» closes the Corpus practices and keeps the bound table with its rows and its reader', () => {
    const { id } = corpusAndBound();
    const { id: actId, articles: [row] } = practice(id).acts[0];
    const key = articleRowKey(id, actId, practiceArticleKey(row));
    s().setRowOpen(key, true);
    s().closeAllPractices();
    expect(s().practices.map((p) => p.id)).toEqual([id]);
    expect(s().activePracticeId).toBeNull();
    expect(s().practiceRows[key]).toBe(true);
  });

  it('«Annulla» of a closing never puts a bound table back nor makes it active', () => {
    const { a, b, id } = corpusAndBound();
    const closed = s().practices.map((practice, index) => ({ practice, index }));
    s().closePractice(id);
    s().closeAllPractices();
    expect(s().reopenPractices(closed, {}, id)).toBe(true);
    expect(s().practices.map((p) => p.id)).toEqual([a, b]);
    expect(s().activePracticeId).toBe(a);
    // only a bound table to put back: nothing to do
    s().closeAllPractices();
    expect(s().reopenPractices([closed[1]], {}, id)).toBe(false);
  });

  it('reordering the bar moves Corpus practices by their place in the bar, the bound table not counted', () => {
    const { a, b, id } = corpusAndBound();
    const c = s().createPractice('C');
    // the bar shows a, b, c: dragging c onto a
    s().reorderPractices(2, 0);
    expect(corpusPractices(s().practices).map((p) => p.id)).toEqual([c, a, b]);
    expect(s().practices.map((p) => p.id)).toContain(id);
  });

  it('«Sposta in un\'altra pratica» neither moves an act into nor out of a bound table', () => {
    const { a, id } = corpusAndBound();
    const { actId } = s().addArticlesToPractice(a, L24, [article(L24, '1')]);
    const before = s().practices;
    s().moveActToPractice(actId, a, id);
    s().moveActToPractice(practice(id).acts[0].id, id, a);
    expect(s().practices).toBe(before);
  });

  it('«Tutte le pratiche» of the find window searches the Corpus practices only', () => {
    const { a, id } = corpusAndBound();
    s().addArticlesToPractice(a, CC_RD, [article(CC_RD, '2043')]);
    const all = findTargetsInScope({ practices: s().practices, activePracticeId: s().activePracticeId }, 'all', null);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((t) => !JSON.stringify(t).includes(id))).toBe(true);
  });

  it('a sign-out takes the bound table too', () => {
    corpusAndBound();
    s().clearUserData();
    expect(s().practices).toEqual([]);
  });

  it('a decision row of the bound table keys under its own practice', () => {
    const id = s().openDossierPractice(dossier([sentenza]));
    const decisionId = practice(id).decisions[0].id;
    s().revealPracticeDecision(id, decisionId);
    expect(s().practiceRows[decisionRowKey(id, decisionId)]).toBe(true);
  });
});
