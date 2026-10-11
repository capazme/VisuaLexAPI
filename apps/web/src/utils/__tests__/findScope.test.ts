import { afterEach, describe, expect, it } from 'vitest';
import { findTargetsInScope, frontTabId, type FindScopeState } from '../findScope';
import { clearDecisionCache, rememberDecision } from '../decisionFetchCache';
import type { WorkspaceTab, NormaBlock, LooseArticle, ArticleCollection } from '../../store/useAppStore';
import type { ArticleData, NormaVisitata } from '../../types';
import type { FoundDecision } from '../../types/decisions';

afterEach(() => {
  clearDecisionCache();
});

function norma(numero_articolo: string, extra: Partial<NormaVisitata> = {}): NormaVisitata {
  return { tipo_atto: 'codice civile', data: '', numero_articolo, ...extra };
}

function article(numero_articolo: string, text = `testo art. ${numero_articolo}`, extra: Partial<NormaVisitata> = {}): ArticleData {
  return { article_text: text, norma_data: norma(numero_articolo, extra) };
}

function tab(overrides: Partial<WorkspaceTab> & { id: string }): WorkspaceTab {
  return {
    label: overrides.id,
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    zIndex: 1,
    isMinimized: false,
    isHidden: false,
    content: [],
    labelIsCustom: false,
    ...overrides,
  };
}

function normaBlock(id: string, articles: ArticleData[]): NormaBlock {
  return { type: 'norma', id, norma: { tipo_atto: 'codice civile', data: '' }, articles, isCollapsed: false };
}

function looseArticle(id: string, data: ArticleData): LooseArticle {
  return { type: 'loose-article', id, article: data, sourceNorma: data.norma_data };
}

function collection(id: string, articles: ArticleData[]): ArticleCollection {
  return { type: 'collection', id, label: 'raccolta', isCollapsed: false, articles: articles.map((a) => ({ article: a, sourceNorma: a.norma_data })) };
}

describe('findTargetsInScope', () => {
  it('on a phone leaves out the loose articles and collections its column never draws', () => {
    const front = tab({
      id: 'tab-front',
      content: [
        normaBlock('block-1', [article('1'), article('2')]),
        looseArticle('loose-1', article('5')),
        collection('coll-1', [article('7'), article('8')]),
      ],
    });
    const state: FindScopeState = { workspaceTabs: [front] };

    const phone = findTargetsInScope(state, 'tab', 'tab-front', { phone: true });
    expect(phone.map((t) => t.label)).toEqual(findTargetsInScope(state, 'tab', 'tab-front').slice(0, 2).map((t) => t.label));
    expect(phone).toHaveLength(2);
    expect(findTargetsInScope(state, 'all', null, { phone: true })).toHaveLength(2);
    expect(findTargetsInScope(state, 'tab', 'tab-front')).toHaveLength(5);
  });

  it('lists the front tab\'s articles in display order, loose articles and collections included', () => {
    const front = tab({
      id: 'tab-front',
      content: [
        normaBlock('block-1', [article('1'), article('2')]),
        looseArticle('loose-1', article('5')),
        collection('coll-1', [article('7'), article('8')]),
      ],
    });
    const other = tab({ id: 'tab-other', content: [normaBlock('block-2', [article('9')])] });
    const state: FindScopeState = { workspaceTabs: [other, front] };

    const targets = findTargetsInScope(state, 'tab', 'tab-front');

    expect(targets.map((t) => t.label)).toEqual(['art. 1 c.c.', 'art. 2 c.c.', 'art. 5 c.c.', 'art. 7 c.c.', 'art. 8 c.c.']);
    expect(targets.every((t) => t.tabId === 'tab-front')).toBe(true);
    expect(targets[0].storedText).toBe('testo art. 1');
    expect(targets[0].articleId).toBe('1');
  });

  it('lists every tab in dock order under «Tutte le schede», minimised tabs included', () => {
    const a = tab({ id: 'a', content: [normaBlock('b', [article('1')])] });
    const b = tab({ id: 'b', isMinimized: true, content: [normaBlock('c', [article('2')])] });
    const state: FindScopeState = { workspaceTabs: [b, a] }; // dock order: b then a

    const targets = findTargetsInScope(state, 'all', null);

    expect(targets.map((t) => t.tabId)).toEqual(['b', 'a']);
  });

  it('counts the same article once in a tab that holds it twice (a block and a collection)', () => {
    const t = tab({ id: 'a', content: [normaBlock('b', [article('1'), article('2')]), collection('c', [article('1')])] });
    const targets = findTargetsInScope({ workspaceTabs: [t] }, 'all', null);
    expect(targets.map((x) => x.label)).toEqual(['art. 1 c.c.', 'art. 2 c.c.']);
  });

  it('keeps the same article in two tabs as two targets', () => {
    const a = tab({ id: 'a', content: [normaBlock('b', [article('1')])] });
    const b = tab({ id: 'b', content: [normaBlock('c', [article('1')])] });
    expect(findTargetsInScope({ workspaceTabs: [a, b] }, 'all', null)).toHaveLength(2);
  });

  it('gives no stored text for an article whose text is not shown (not yet in force)', () => {
    const notYet = article('1');
    notYet.validity = { state: 'not_yet', valid_from: null, valid_to: null, version_number: null, act_updated: null, request_in_window: true };
    const t = tab({ id: 'a', content: [normaBlock('b', [notYet, article('2')])] });
    const targets = findTargetsInScope({ workspaceTabs: [t] }, 'all', null);
    expect(targets[0].storedText).toBeUndefined();
    expect(targets[1].storedText).toBe('testo art. 2');
  });

  it('returns nothing for «Questa scheda» when there is no front tab', () => {
    const state: FindScopeState = { workspaceTabs: [tab({ id: 'a' })] };
    expect(findTargetsInScope(state, 'tab', null)).toEqual([]);
  });

  it('skips a decision-search tab: a list of decisions, no text of its own', () => {
    const t = tab({ id: 'a', view: { kind: 'decision-search', query: {} } });
    const state: FindScopeState = { workspaceTabs: [t] };
    expect(findTargetsInScope(state, 'all', null)).toEqual([]);
  });

  it('keys a decision tab by its decision key and labels it with formatDecisionShort', () => {
    const t = tab({ id: 'a', view: { kind: 'decision', reference: { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 } } });
    const state: FindScopeState = { workspaceTabs: [t] };

    const targets = findTargetsInScope(state, 'all', null);

    expect(targets).toEqual([{ tabId: 'a', targetKey: 'cassazione:civile:10787:2024', label: 'Cass. civ., n. 10787/2024', storedText: undefined }]);
  });

  it('skips a Cassazione decision tab whose archive is not resolved yet', () => {
    const t = tab({ id: 'a', view: { kind: 'decision', reference: { corte: 'cassazione', numero: 1, anno: 2020 } } });
    const state: FindScopeState = { workspaceTabs: [t] };
    expect(findTargetsInScope(state, 'all', null)).toEqual([]);
  });

  it('reads a cached decision\'s projection as its stored text', () => {
    const identity = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 10787, anno: 2024 };
    const answer: FoundDecision = {
      esito: 'trovata',
      identita: identity,
      attributi: {},
      testo: { motivazione: 'il fatto\nè certo' },
      fonte: { nome: 'italgiure' },
      avvisi: [],
    };
    rememberDecision(identity, answer);
    const t = tab({ id: 'a', view: { kind: 'decision', reference: identity } });
    const state: FindScopeState = { workspaceTabs: [t] };

    const targets = findTargetsInScope(state, 'all', null);

    expect(targets[0].storedText).toBe('il fattoè certo');
  });
});

describe('frontTabId', () => {
  it('is the highest zIndex among visible tabs on a desktop, ignoring a hidden or minimised one above it', () => {
    const state: FindScopeState = {
      workspaceTabs: [
        tab({ id: 'low', zIndex: 1 }),
        tab({ id: 'hidden-high', zIndex: 10, isHidden: true }),
        tab({ id: 'minimised-higher', zIndex: 20, isMinimized: true }),
        tab({ id: 'visible-top', zIndex: 5 }),
      ],
    };
    expect(frontTabId(state, true)).toBe('visible-top');
  });

  it('is null with no open tab', () => {
    expect(frontTabId({ workspaceTabs: [] }, true)).toBeNull();
    expect(frontTabId({ workspaceTabs: [], mobileActiveTabId: 'gone' }, false)).toBeNull();
  });

  it('is the tab the carousel shows on a phone, whatever its zIndex or flags', () => {
    const state: FindScopeState = {
      workspaceTabs: [tab({ id: 'first', zIndex: 1 }), tab({ id: 'shown', zIndex: 2, isMinimized: true }), tab({ id: 'top', zIndex: 30 })],
      mobileActiveTabId: 'shown',
    };
    expect(frontTabId(state, false)).toBe('shown');
  });

  it('is the first tab on a phone when the carousel names none that is open, as the carousel reads it', () => {
    const tabs = [tab({ id: 'first', zIndex: 1 }), tab({ id: 'top', zIndex: 30 })];
    expect(frontTabId({ workspaceTabs: tabs }, false)).toBe('first');
    expect(frontTabId({ workspaceTabs: tabs, mobileActiveTabId: 'closed' }, false)).toBe('first');
  });
});
