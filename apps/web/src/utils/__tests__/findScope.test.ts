import { afterEach, describe, expect, it } from 'vitest';
import { findTargetsInScope, frontTabId, type FindScopeState } from '../findScope';
import { clearDecisionCache, rememberDecision } from '../decisionFetchCache';
import { practiceArticleKey, type Practice, type PracticeDecision } from '../practice';
import { decisionKey } from '../decisionLinks';
import { L24, L241, article } from '../__fixtures__/savedWorkspaces';
import type { FoundDecision } from '../../types/decisions';

afterEach(() => {
  clearDecisionCache();
});

const READ = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 28994, anno: 2019 };
const UNREAD = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 577, anno: 2008 };
const entry = (id: string, reference: PracticeDecision['reference'], depositDate?: string): PracticeDecision =>
  ({ id, reference, label: `Cass. civ., n. ${reference.numero}/${reference.anno}`, identified: true, ...(depositDate ? { depositDate } : {}) });

const PAST = article(L24, '5', { data_versione: '2007-12-29' });
const first: Practice = {
  id: 'p1', label: 'Responsabilità', labelIsCustom: true,
  acts: [
    { id: 'a-l24', key: 'legge|24|2017-03-08', norma: L24, articles: [article(L24, '5'), PAST, article(L24, '7')], isCollapsed: true },
    { id: 'a-l241', key: 'legge|241|1990-08-07', norma: L241, articles: [article(L241, '2')], isCollapsed: false },
  ],
  decisions: [entry('d-old', UNREAD), entry('d-new', READ, '2019-11-11')],
  beside: [{ id: 'search:x', kind: 'decision-search', query: { tema: 'danno' }, label: 'Tema: danno' }],
};
const second: Practice = {
  id: 'p2', label: 'Appalti', labelIsCustom: false,
  acts: [{ id: 'b-l241', key: 'legge|241|1990-08-07', norma: L241, articles: [article(L241, '3')], isCollapsed: false }],
  decisions: [], beside: [],
};
const state = (activePracticeId: string): FindScopeState => ({ practices: [second, first], activePracticeId });

function remember() {
  const answer: FoundDecision = {
    esito: 'trovata', identita: READ, attributi: {}, testo: { motivazione: 'il danno\nè certo' }, fonte: { nome: 'italgiure' }, avvisi: [],
  };
  rememberDecision(READ, answer);
}

describe('findTargetsInScope over the practices (spec §6.6)', () => {
  it('«Questa pratica»: every article of every act, closed rows and past texts included, then the decisions newest first', () => {
    remember();
    const targets = findTargetsInScope(state('p1'), 'tab', frontTabId(state('p1')));
    expect(targets.map((t) => t.tabId)).toEqual(['p1', 'p1', 'p1', 'p1', 'p1', 'p1']);
    expect(targets.map((t) => t.targetKey)).toEqual([
      practiceArticleKey(article(L24, '5')), practiceArticleKey(PAST), practiceArticleKey(article(L24, '7')),
      practiceArticleKey(article(L241, '2')), decisionKey(READ), decisionKey(UNREAD),
    ]);
    expect(targets[0].storedText).toBe('Art. 5Testo dell\'articolo 5.');
    expect(targets[0].reveal).toEqual({ kind: 'article', actId: 'a-l24', articleKey: practiceArticleKey(article(L24, '5')) });
    expect(targets[4]).toEqual(expect.objectContaining({ storedText: 'il dannoè certo', reveal: { kind: 'decision', decisionId: 'd-new' } }));
  });

  it('a decision never read counts nothing: it has no stored text', () => {
    const targets = findTargetsInScope(state('p1'), 'tab', 'p1');
    expect(targets.find((t) => t.targetKey === decisionKey(UNREAD))?.storedText).toBeUndefined();
  });

  it('«Tutte le pratiche»: the practices in the bar\'s order, each place named with its practice', () => {
    const targets = findTargetsInScope(state('p1'), 'all', 'p1');
    expect(targets.map((t) => t.tabId)).toEqual(['p2', 'p1', 'p1', 'p1', 'p1', 'p1', 'p1']);
    expect(targets[0].label).toBe('art. 3 l. 241/1990 · Appalti');
  });

  it('the front is the active practice, on the desktop and on a phone', () => {
    expect(frontTabId(state('p2'))).toBe('p2');
    expect(frontTabId({ practices: [], activePracticeId: null })).toBeNull();
  });

  it('«Questa pratica» with no front practice, and a front that names none, is empty', () => {
    expect(findTargetsInScope(state('p1'), 'tab', null)).toEqual([]);
    expect(frontTabId(state('gone'))).toBeNull();
  });

  it('keys an administrative decision by its whole identity, and skips one whose kind or seat is not known yet', () => {
    const tar = { corte: 'tar' as const, sede: 'roma', provvedimento: 'ocau', numero: 1234, anno: 2020 };
    const only = (references: PracticeDecision['reference'][]): FindScopeState => ({
      practices: [{ ...second, acts: [], decisions: references.map((r, i) => entry(`d${i}`, r)) }], activePracticeId: 'p2',
    });
    const targets = findTargetsInScope(only([tar]), 'all', null);
    expect(targets.map((t) => t.targetKey)).toEqual(['tar:roma:ocau:1234:2020']);
    for (const reference of [
      { corte: 'tar' as const, regione: 'Lazio', numero: 1234, anno: 2020 },
      { corte: 'tar' as const, sede: 'roma', numero: 1234, anno: 2020 },
      { corte: 'consiglio_di_stato' as const, numero: 2270, anno: 2019 },
      { corte: 'cassazione' as const, numero: 1, anno: 2020 },
    ]) {
      expect(findTargetsInScope(only([reference]), 'all', null)).toEqual([]);
    }
  });

  it('gives no stored text for an article whose text is not shown (not yet in force)', () => {
    const notYet = article(L241, '9');
    notYet.validity = { state: 'not_yet', valid_from: null, valid_to: null, version_number: null, act_updated: null, request_in_window: true };
    const holder: FindScopeState = {
      practices: [{ ...second, acts: [{ ...second.acts[0], articles: [notYet, article(L241, '3')] }] }], activePracticeId: 'p2',
    };
    const targets = findTargetsInScope(holder, 'all', null);
    expect(targets[0].storedText).toBeUndefined();
    expect(targets[1].storedText).toBeDefined();
  });
});
